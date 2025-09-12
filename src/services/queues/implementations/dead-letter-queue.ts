import { BaseQueue } from '../base-queue.js';
import { Accountability, SchemaOverview } from '../../../types/index.js';
import {
  QueueName,
  DeadLetterQueueItem
} from '../types/queue.js';
import type { QueueManager } from '../queue-manager.js'; // Import type for QueueManager

/**
 * DeadLetterQueue handles failed queue items by storing them and providing
 * functionality to retry or clean them up after a certain time period.
 */
export class DeadLetterQueue extends BaseQueue {
  private queueManagerInstance: QueueManager;

  /**
   * Initialize the dead letter queue
   */
  constructor(schema: SchemaOverview, accountability: Accountability | null, queueManager: QueueManager) {
    super(QueueName.DEAD_LETTER, schema, accountability);
    this.queueManagerInstance = queueManager;
  }

  /**
   * Process the dead letter queue
   * This implementation focuses on cleanup and retry
   */
  public async process(): Promise<void> {
    // The dead letter queue doesn't process items regularly
    // Items are added through the handleFailedItem method in BaseQueue
    // Processing is done through the processDeadLetterQueue method
  }

  /**
   * Process and clean up the dead letter queue
   * - Removes items older than 4 hours
   * - Attempts to requeue newer items for processing
   */
  public async processDeadLetterQueue(): Promise<void> {
    try {
      // Get all items from dead-letter queue
      const deadLetterItems = await this.redis.lrange(QueueName.DEAD_LETTER, 0, -1);
      let removedCount = 0;
      let retriedCount = 0;

      // Define cutoff time (4 hours ago)
      const cutoffDate = new Date();
      cutoffDate.setHours(cutoffDate.getHours() - 4);

      for (const item of deadLetterItems) {
        try {
          const failedItem = JSON.parse(item) as DeadLetterQueueItem;
          const itemDate = new Date(failedItem.timestamp);

          // If older than 4 hours, remove it
          if (itemDate < cutoffDate) {
            await this.redis.lrem(QueueName.DEAD_LETTER, 1, item);
            removedCount++;
            continue;
          }

          // Otherwise, attempt to reprocess based on queue type
          await this.reprocessItem(failedItem);

          // If reprocessing succeeded, remove from dead letter queue
          await this.redis.lrem(QueueName.DEAD_LETTER, 1, item);
          retriedCount++;

        } catch (error) {
          this.logger.error({
            item,
            error: error
          },
            'Failed to process dead letter item:');
        }
      }

      this.logger.info('Dead letter queue cleanup completed', {
        totalProcessed: deadLetterItems.length,
        removed: removedCount,
        retried: retriedCount
      });

      return;
    } catch (error) {
      this.logger.error(error, 'Error cleaning up dead letter queue');
    }
  }

  /**
   * Reprocess a failed item based on its original queue type
   * 
   * @param failedItem The failed item to reprocess
   */
  private async reprocessItem(failedItem: DeadLetterQueueItem): Promise<void> {
    const originalQueueName = failedItem.queueName;
    const originalJobData = failedItem.item; // This is the original item passed to addToQueue

    this.logger.info(`Attempting to reprocess item from DLQ for original queue: ${originalQueueName}`, { originalJobData });

    const originalQueue = this.queueManagerInstance.getQueue(originalQueueName);

    if (originalQueue) {
      try {
        // BaseQueue.addToQueue is protected. We cast to any to call it.
        // A better long-term solution might be a public "requeueRawJob" method on BaseQueue.
        await (originalQueue as any).addToQueue(originalJobData);
        this.logger.info(`Successfully re-queued item to ${originalQueueName} from DLQ.`);
      } catch (requeueError) {
        this.logger.error(
          `Failed to re-queue item from DLQ to ${originalQueueName}. Item will remain in DLQ.`,
          {
            failedItem,
            requeueError
          }
        );
        throw requeueError; // Rethrow to prevent removal from DLQ in the calling loop
      }
    } else {
      this.logger.error(
        `Could not find queue instance for ${originalQueueName} to reprocess item. Item will remain in DLQ.`,
        { failedItem }
      );
      throw new Error(`Queue instance for ${originalQueueName} not found during DLQ reprocessing.`);
    }
  }
}
