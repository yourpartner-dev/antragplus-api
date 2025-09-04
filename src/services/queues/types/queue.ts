import { Accountability, SchemaOverview } from '../../../types/index.js';
/**
 * Enum of all available queue names for type safety
 */
export enum QueueName {
  DEAD_LETTER = 'dead-letter-queue',
}

/**
 * Type for failed items in the dead letter queue
 */
export interface DeadLetterQueueItem {
  queueName: QueueName;
  item: any;
  accountability: Accountability | null;
  schema: SchemaOverview; 
  errorMessage: any;
  errorStack: any;
  timestamp: string;
}