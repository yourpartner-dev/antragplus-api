import { Accountability, SchemaOverview } from "../../types/index.js";
import { useLogger } from "../../helpers/logger/index.js";
import { useRedis } from "../../redis/index.js";
import { withLock } from "../../redis/utils/distributed-lock.js";
import { QueueName, DeadLetterQueueItem } from './types/queue.js';

/**
 * BaseQueue provides common functionality for all queue implementations
 * Each specific queue will extend this class and implement its own processing logic
 */
export abstract class BaseQueue {
  protected redis = useRedis();
  protected logger = useLogger();
  protected maxRetries = 2;
  
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
  ) {}
  
  /**
   * Add an item to the queue
   * 
   * @param item The item to add to the queue
   */
  protected async addToQueue(item: any): Promise<void> {
    await this.redis.rpush(this.queueName, JSON.stringify(item));
  }
  
  /**
   * Add multiple items to the queue in batches
   * 
   * @param items Array of items to add to the queue
   * @param batchSize Number of items to process in each batch
   */
  protected async addBatchToQueue(items: any[], batchSize = 100): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const pipeline = this.redis.pipeline();
      
      for (const item of batch) {
        pipeline.rpush(this.queueName, JSON.stringify(item));
      }
      
      await pipeline.exec();
    }
  }
  
  /**
   * Get and remove an item from the front of the queue
   * 
   * @returns The next item in the queue, or null if the queue is empty
   */
  protected async getFromQueue(): Promise<any | null> {
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
   * Get the current size of the queue
   * 
   * @returns The number of items in the queue
   */
  public async getQueueSize(): Promise<number> {
    return await this.redis.llen(this.queueName);
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
    const queueLength = await this.redis.llen(QueueName.DEAD_LETTER);
    
    // Limit dead letter queue size
    if (queueLength > 10000) {
      await this.redis.ltrim(QueueName.DEAD_LETTER, -9999, -1);
    }
    
    // Create a properly typed dead letter queue item
    const deadLetterItem: DeadLetterQueueItem = {
      queueName: this.queueName,
      item: item,
      accountability: this.accountability ?? null,
      schema: this.schema,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString()

    };
    
    // Add failed item to dead letter queue
    await this.redis.rpush(QueueName.DEAD_LETTER, JSON.stringify(deadLetterItem));
    
    this.logger.error(error, `Item moved to dead letter queue: ${this.queueName}`);

    return;
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