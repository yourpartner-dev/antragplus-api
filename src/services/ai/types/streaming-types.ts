/**
 * Type definitions for AI chat streaming events
 * These types define the SSE (Server-Sent Events) structure sent from backend to frontend
 */

export type ChatStreamEventType =
  | 'thinking'
  | 'content'
  | 'tool_call'
  | 'tool_result'
  | 'document_created'
  | 'document_updated'
  | 'progress_update'
  | 'complete'
  | 'error'
  | 'done';

export interface ThinkingEvent {
  type: 'thinking';
  message: string | null; // null when phase is 'complete' to clear thinking state
  phase: 'initializing' | 'creating_document' | 'updating_document' | 'searching_web' | 'fetching_grant' | 'fetching_ngo' | 'executing_tool' | 'complete' | 'analyzing' | string;
}

export interface ContentEvent {
  type: 'content';
  content: string;
}

export interface ToolCallEvent {
  type: 'tool_call';
  tool: string;
  args: any;
  status: 'started';
  toolCallId: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  tool: string;
  result: any;
  args?: any;
  status: 'completed';
  toolCallId: string;
}

export interface DocumentCreatedEvent {
  type: 'document_created';
  document: {
    id: string;
    title: string;
    kind: string;
    content_format: string;
    created_at: string;
  };
  message: string;
}

export interface DocumentUpdatedEvent {
  type: 'document_updated';
  document: {
    id: string;
    title?: string;
    [key: string]: any;
  };
  message: string;
}

export interface ProgressUpdateEvent {
  type: 'progress_update';
  progress: {
    documents_created: number;
    grant_name?: string;
    grant_deadline?: string;
    [key: string]: any;
  };
  message: string;
}

export interface CompleteEvent {
  type: 'complete';
  finishReason: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown';
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ErrorEvent {
  type: 'error';
  error: any;
  message: string;
  isRateLimitError?: boolean;
  retryAfter?: string;
}

export interface DoneEvent {
  type: 'done';
  data: '[DONE]' | '[ERROR]';
}

export type ChatStreamEvent =
  | ThinkingEvent
  | ContentEvent
  | ToolCallEvent
  | ToolResultEvent
  | DocumentCreatedEvent
  | DocumentUpdatedEvent
  | ProgressUpdateEvent
  | CompleteEvent
  | ErrorEvent
  | DoneEvent;

/**
 * Parse SSE data string into ChatStreamEvent
 */
export function parseSSEEvent(data: string): ChatStreamEvent | null {
  if (data === '[DONE]' || data === '[ERROR]') {
    return { type: 'done', data };
  }

  try {
    return JSON.parse(data) as ChatStreamEvent;
  } catch (error) {
    console.error('Failed to parse SSE event:', error);
    return null;
  }
}

/**
 * Type guard functions for better type safety
 */
export function isThinkingEvent(event: ChatStreamEvent): event is ThinkingEvent {
  return event.type === 'thinking';
}

export function isContentEvent(event: ChatStreamEvent): event is ContentEvent {
  return event.type === 'content';
}

export function isToolCallEvent(event: ChatStreamEvent): event is ToolCallEvent {
  return event.type === 'tool_call';
}

export function isToolResultEvent(event: ChatStreamEvent): event is ToolResultEvent {
  return event.type === 'tool_result';
}

export function isDocumentCreatedEvent(event: ChatStreamEvent): event is DocumentCreatedEvent {
  return event.type === 'document_created';
}

export function isDocumentUpdatedEvent(event: ChatStreamEvent): event is DocumentUpdatedEvent {
  return event.type === 'document_updated';
}

export function isProgressUpdateEvent(event: ChatStreamEvent): event is ProgressUpdateEvent {
  return event.type === 'progress_update';
}

export function isCompleteEvent(event: ChatStreamEvent): event is CompleteEvent {
  return event.type === 'complete';
}

export function isErrorEvent(event: ChatStreamEvent): event is ErrorEvent {
  return event.type === 'error';
}

export function isDoneEvent(event: ChatStreamEvent): event is DoneEvent {
  return event.type === 'done';
}
