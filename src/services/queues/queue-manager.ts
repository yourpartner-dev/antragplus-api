import { useLogger } from '../../helpers/logger/index.js';
import { SchemaOverview, Accountability } from '../../types/index.js';
import { QueueName } from './types/queue.js';
import { BaseQueue } from './base-queue.js';
import { DeadLetterQueue } from './implementations/dead-letter-queue.js';
import { EmbeddingQueue } from './implementations/embedding-queue.js';
import { DocumentParsingQueue } from './implementations/document-parsing-queue.js';
import { GrantExtractionQueue } from './implementations/grant-extraction-queue.js';

// Import all queue implementations

const logger = useLogger();

/**
 * QueueManager orchestrates all the queue services.
 * It initializes all queue instances and provides methods to access them.
 * It also provides methods to process all queues and monitor queue sizes.
 */
export class QueueManager {
  
  // Queue service instances
  private deadLetterQueue: DeadLetterQueue;
  private embeddingQueue: EmbeddingQueue;
  private documentParsingQueue: DocumentParsingQueue;
  private grantExtractionQueue: GrantExtractionQueue;
  
  /**
   * Initialize all queue services
   */
  constructor(schema: SchemaOverview, accountability: Accountability | null) {
      this.deadLetterQueue = new DeadLetterQueue(schema, accountability ?? null, this);
      this.embeddingQueue = new EmbeddingQueue(schema, accountability);
      this.documentParsingQueue = new DocumentParsingQueue(schema, accountability);
      this.grantExtractionQueue = new GrantExtractionQueue(schema, accountability);
  }
  
  /**
   * Process all queues concurrently
   */
  public async processAllQueues(): Promise<void> {
    try {
      await Promise.all([
        //Add all queues to process here
        this.embeddingQueue.processQueue(),
        this.documentParsingQueue.processQueue(),
        this.grantExtractionQueue.processQueue(),
        // Note: Dead letter queue is processed separately
      ]);
    } catch (error) {
      logger.error(error, 'Error processing queues');
    }
  }
  
  /**
   * Monitor queue sizes and log them
   */
  public async monitorQueueSizes(): Promise<void> {
    try {
      //Add all queues to monitor here
      const queueSizes = {
        //Add all queues to monitor here
        [QueueName.DEAD_LETTER]: await this.deadLetterQueue.getQueueSize(),
        [QueueName.EMBEDDING]: await this.embeddingQueue.getQueueSize(),
        [QueueName.DOCUMENT_PARSING]: await this.documentParsingQueue.getQueueSize(),
        [QueueName.GRANT_EXTRACTION]: await this.grantExtractionQueue.getQueueSize(),
        //Add all queues to monitor here
      };
      
      logger.debug('Current queue sizes:', queueSizes);
      
      // Process dead letter queue if needed
      if (queueSizes[QueueName.DEAD_LETTER] > 0) {
        await this.deadLetterQueue.processDeadLetterQueue();
      }
    } catch (error) {
      logger.error(error, 'Error monitoring queue sizes');
    }
  }
  
  /**
   * Get a queue instance by its name
   * @param name The name of the queue to get
   * @returns The queue instance, or undefined if not found
   */
  public getQueue(name: QueueName | string): BaseQueue | undefined {
    switch (name) {
      case QueueName.DEAD_LETTER:
        return this.deadLetterQueue;
      case QueueName.EMBEDDING:
      case 'embedding-queue':
        return this.embeddingQueue;
      case QueueName.DOCUMENT_PARSING:
      case 'document-parsing-queue':
        return this.documentParsingQueue;
      case QueueName.GRANT_EXTRACTION:
      case 'grant-extraction-queue':
        return this.grantExtractionQueue;
      default:
        logger.warn(`Attempted to get unknown queue instance: ${name}`);
        return undefined;
    }
  }
  
  /**
   * Create getters for all queues
   */

  /**
   * Get the embedding queue service instance
   */
  public getEmbeddingQueue(): EmbeddingQueue {
    return this.embeddingQueue;
  }

  /**
   * Get the dead letter queue service instance
   */
  public getDeadLetterQueue(): DeadLetterQueue {
    return this.deadLetterQueue;
  }

  /**
   * Get the document parsing queue service instance
   */
  public getDocumentParsingQueue(): DocumentParsingQueue {
    return this.documentParsingQueue;
  }

  /**
   * Get the grant extraction queue service instance
   */
  public getGrantExtractionQueue(): GrantExtractionQueue {
    return this.grantExtractionQueue;
  }

} 