import { Accountability, SchemaOverview } from "../../types/index.js";
import { useLogger } from "../../helpers/logger/index.js";
import { useRedis } from "../../redis/index.js";
import { withLock } from "../../redis/utils/distributed-lock.js";
import { QueueName, DeadLetterQueueItem } from './types/queue.js';
import { createHash } from 'crypto';
import { useEnv } from '../../helpers/env/index.js';

/**
 * BaseQueue provides common functionality for all queue implementations
 * Each specific queue will extend this class and implement its own processing logic
 */
export abstract class BaseQueue {
  protected redis = useRedis();
  protected logger = useLogger();
  protected maxRetries = 2;
  protected env = useEnv();

  // Redis Streams support for horizontal scaling
  protected useStreams: boolean;
  protected streamKey: string;
  protected consumerGroup: string;
  protected consumerId: string;
  
  /**
   * Initialize a queue with a name and context
   * 
   * @param queueName The name of the queue in Redis
   * @param schema Schema overview for database operations
   * @param accountability User context for operations
   */
  constructor(
    protected queueName: QueueName,
    protected schema: SchemaOverview,
    protected accountability: Accountability | null
  ) {
    // Configure Redis Streams for horizontal scaling
    this.useStreams = this.env['REDIS_STREAMS_ENABLED'] === 'true';
    this.streamKey = `stream:${this.queueName}`;
    this.consumerGroup = `${this.queueName}-group`;
    // Generate unique consumer ID for this instance
    this.consumerId = `pod-${process.pid}-${Math.random().toString(36).substring(2, 8)}`;

    // Initialize consumer group if using streams
    if (this.useStreams) {
      this.initializeConsumerGroup().catch(error => {
        this.logger.error(error, `Failed to initialize consumer group for ${this.queueName}`);
      });
    }
  }

  /**
   * Initialize consumer group for Redis Streams
   */
  private async initializeConsumerGroup(): Promise<void> {
    try {
      // Try to create consumer group (will error if already exists)
      await this.redis.xgroup('CREATE', this.streamKey, this.consumerGroup, '$', 'MKSTREAM');
      this.logger.debug(`Created consumer group ${this.consumerGroup} for stream ${this.streamKey}`);
    } catch (error: any) {
      // Ignore 'BUSYGROUP' error - group already exists
      if (!error.message?.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  /**
   * Add an item to the queue with deduplication
   *
   * @param item The item to add to the queue
   * @param deduplicationWindow Window in seconds for deduplication (default: 60)
   */
  protected async addToQueue(item: any, deduplicationWindow = 60): Promise<void> {
    // Create hash for deduplication
    const itemString = JSON.stringify(item);
    const hash = createHash('md5').update(itemString).digest('hex');
    const uniqueKey = `uniq:${this.queueName}:${hash}`;

    // Try to set the unique key with expiry to prevent duplicates
    const wasSet = await this.redis.set(uniqueKey, '1', 'EX', deduplicationWindow, 'NX');
    if (!wasSet) {
      this.logger.debug(`Skipping duplicate item for queue ${this.queueName}`);
      return;
    }

    if (this.useStreams) {
      // Add to Redis Stream
      await this.redis.xadd(this.streamKey, '*', 'data', itemString, 'hash', hash);
    } else {
      // Add to Redis List (legacy mode)
      await this.redis.rpush(this.queueName, itemString);
    }
  }
  
  /**
   * Add multiple items to the queue in batches with deduplication
   *
   * @param items Array of items to add to the queue
   * @param batchSize Number of items to process in each batch
   * @param deduplicationWindow Window in seconds for deduplication (default: 60)
   */
  protected async addBatchToQueue(items: any[], batchSize = 100, deduplicationWindow = 60): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const pipeline = this.redis.pipeline();

      // Process items for deduplication
      const validItems: Array<{item: any, itemString: string, hash: string}> = [];

      for (const item of batch) {
        const itemString = JSON.stringify(item);
        const hash = createHash('md5').update(itemString).digest('hex');
        const uniqueKey = `uniq:${this.queueName}:${hash}`;

        // Check if item is duplicate
        pipeline.set(uniqueKey, '1', 'EX', deduplicationWindow, 'NX');
        validItems.push({ item, itemString, hash });
      }

      const results = await pipeline.exec();
      if (!results) return;

      // Filter out duplicates based on SET NX results
      const nonDuplicateItems = validItems.filter((_, index) => {
        const result = results[index];
        return result && result[1] === 'OK'; // SET NX succeeded
      });

      if (nonDuplicateItems.length === 0) {
        this.logger.debug(`All ${batch.length} items were duplicates for queue ${this.queueName}`);
        continue;
      }

      // Add non-duplicate items to queue
      const addPipeline = this.redis.pipeline();
      for (const { itemString, hash } of nonDuplicateItems) {
        if (this.useStreams) {
          addPipeline.xadd(this.streamKey, '*', 'data', itemString, 'hash', hash);
        } else {
          addPipeline.rpush(this.queueName, itemString);
        }
      }

      await addPipeline.exec();

      if (nonDuplicateItems.length < batch.length) {
        const duplicates = batch.length - nonDuplicateItems.length;
        this.logger.debug(`Added ${nonDuplicateItems.length} items, skipped ${duplicates} duplicates for queue ${this.queueName}`);
      }
    }
  }
  
  /**
   * Get and remove an item from the front of the queue
   *
   * @returns The next item in the queue, or null if the queue is empty
   */
  protected async getFromQueue(): Promise<any | null> {
    if (this.useStreams) {
      return await this.getFromStream();
    } else {
      return await this.getFromList();
    }
  }

  /**
   * Get item from Redis Stream using consumer groups
   */
  private async getFromStream(): Promise<any | null> {
    try {
      // First, try to reclaim stuck messages (idle for >60 seconds)
      await this.reclaimStuckMessages();

      // Read from stream using consumer group
      const result = await this.redis.xreadgroup(
        'GROUP', this.consumerGroup, this.consumerId,
        'COUNT', 1,
        'BLOCK', 100, // Block for 100ms if no messages
        'STREAMS', this.streamKey, '>'
      );

      if (!result || result.length === 0) return null;

      const streamData = result[0];
      if (!streamData || !Array.isArray(streamData) || streamData.length < 2) return null;

      const messages = streamData[1];
      if (!messages || messages.length === 0) return null;

      const [messageId, fields] = messages[0];

      // Acknowledge the message immediately
      await this.redis.xack(this.streamKey, this.consumerGroup, messageId);

      // Parse the data field
      const dataIndex = fields.indexOf('data');
      if (dataIndex === -1 || dataIndex + 1 >= fields.length) return null;

      const itemString = fields[dataIndex + 1];
      return JSON.parse(itemString);

    } catch (error) {
      this.logger.error(error, `Failed to read from stream ${this.streamKey}`);
      return null;
    }
  }

  /**
   * Get item from Redis List (legacy mode)
   */
  private async getFromList(): Promise<any | null> {
    const item = await this.redis.lpop(this.queueName);
    if (!item) return null;

    try {
      return JSON.parse(item);
    } catch (error) {
      this.logger.error(error, `Failed to parse queue item from ${this.queueName}`);
      return null;
    }
  }

  /**
   * Reclaim stuck messages (idle for more than 60 seconds)
   */
  private async reclaimStuckMessages(): Promise<void> {
    try {
      const minIdleTime = 60000; // 60 seconds

      // Try to use XAUTOCLAIM (Redis 6.2+) with fallback to XCLAIM
      try {
        await this.redis.xautoclaim(
          this.streamKey,
          this.consumerGroup,
          this.consumerId,
          minIdleTime,
          '0-0',
          'COUNT', 10
        );
      } catch (error: any) {
        // Fallback to XCLAIM for older Redis versions
        if (error.message?.includes('unknown command')) {
          // Get pending messages first, then claim them
          const pending = await this.redis.xpending(
            this.streamKey,
            this.consumerGroup,
            '-', '+', 10
          );

          if (pending && pending.length > 0) {
            const messageIds = pending
              .filter((msg: any) => msg[1] > minIdleTime) // Only messages idle longer than threshold
              .map((msg: any) => msg[0]); // Extract message IDs

            if (messageIds.length > 0) {
              await this.redis.xclaim(
                this.streamKey,
                this.consumerGroup,
                this.consumerId,
                minIdleTime,
                ...messageIds
              );
            }
          }
        }
      }
    } catch (error) {
      this.logger.debug(`Could not reclaim stuck messages: ${error}`);
    }
  }
  
  /**
   * Get the current size of the queue
   *
   * @returns The number of items in the queue
   */
  public async getQueueSize(): Promise<number> {
    if (this.useStreams) {
      try {
        const info = await this.redis.xlen(this.streamKey);
        return info || 0;
      } catch (error) {
        this.logger.debug(`Could not get stream length: ${error}`);
        return 0;
      }
    } else {
      return await this.redis.llen(this.queueName);
    }
  }
  
  /**
   * Handle retry logic for failed operations
   * 
   * @param key Unique key for tracking retry attempts
   * @param currentRetryCount Current retry count
   * @param retryOperation Operation to retry
   * @param error Error that caused the failure
   */
  protected async handleRetry(
    key: string,
    currentRetryCount: number,
    retryOperation: () => Promise<void>,
    error: unknown
  ): Promise<void> {
    // Increment retry count
    await this.redis.incr(key);
    
    // Set expiry on retry count key if not already set
    await this.redis.expire(key, 3600); // 1 hour
    
    this.logger.warn(
      `Operation failed, retrying (${currentRetryCount + 1}/${this.maxRetries}): ${key}`,
      { error }
    );
    
    // If we haven't hit max retries, perform the retry operation
    if (currentRetryCount < this.maxRetries) {
      await retryOperation();
    }
  }
  
  /**
   * Get the current retry count for an operation
   * 
   * @param key Unique key for tracking retry attempts
   * @returns The current retry count
   */
  protected async getRetryCount(key: string): Promise<number> {
    return parseInt(await this.redis.get(key) || '0', 10);
  }
  
  /**
   * Handle failed items by moving them to the dead letter queue
   * 
   * @param item The failed item
   * @param error The error that caused the failure
   */
  protected async handleFailedItem(item: any, error: Error): Promise<void> {
    // Create a sanitized dead letter queue item (remove heavy objects)
    const deadLetterItem: DeadLetterQueueItem = {
      queueName: this.queueName,
      item: item,
      accountability: null, // Remove accountability to save space
      schema: null as any, // Remove schema to save space
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString()
    };

    const deadLetterItemString = JSON.stringify(deadLetterItem);
    const maxDeadLetterItems = 1000; // Reduced from 10000 for better memory usage

    if (this.useStreams) {
      // Handle dead letter queue with streams
      const deadLetterStreamKey = `stream:${QueueName.DEAD_LETTER}`;

      // Add to dead letter stream
      await this.redis.xadd(deadLetterStreamKey, '*', 'data', deadLetterItemString);

      // Trim stream to prevent memory issues
      try {
        await this.redis.xtrim(deadLetterStreamKey, 'MAXLEN', '~', maxDeadLetterItems);
      } catch (trimError) {
        this.logger.debug(`Could not trim dead letter stream: ${trimError}`);
      }
    } else {
      // Handle dead letter queue with lists (legacy)
      const queueLength = await this.redis.llen(QueueName.DEAD_LETTER);

      // Limit dead letter queue size
      if (queueLength > maxDeadLetterItems) {
        await this.redis.ltrim(QueueName.DEAD_LETTER, -maxDeadLetterItems + 1, -1);
      }

      // Add failed item to dead letter queue
      await this.redis.rpush(QueueName.DEAD_LETTER, deadLetterItemString);
    }

    this.logger.error(error, `Item moved to dead letter queue: ${this.queueName}`);
  }
  
  /**
   * Execute an operation with locking to prevent concurrent processing
   * 
   * @param lockKey Unique key for the lock
   * @param operation Operation to execute within the lock
   * @param timeout Lock timeout in milliseconds
   */
  protected async withQueueItemLock<T>(
    lockKey: string, 
    operation: () => Promise<T | null>,
    timeout = 10000
  ): Promise<T | null> {
    return await withLock(lockKey, operation, timeout);
  }
  
  /**
   * Clear the retry counter
   * 
   * @param key Unique key for tracking retry attempts
   */
  protected async clearRetryCount(key: string): Promise<void> {
    await this.redis.del(key);
  }
  
  /**
   * Process items from the queue
   * This method must be implemented by each queue service
   */
  public abstract process(): Promise<void>;
} 