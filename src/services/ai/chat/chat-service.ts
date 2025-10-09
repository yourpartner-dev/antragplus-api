import { stepCountIs, streamText } from 'ai';
import { applicationCreationModel } from '../providers.js';
import { useLogger } from '../../../helpers/logger/index.js';
import { ItemsService } from '../../items.js';
import getDatabase from '../../../database/index.js';
import { enhancedRAGService } from '../enhanced-rag-service.js';
import { getChatTools } from '../tools/chat-tools.js';
import { QueueManager } from '../../queues/queue-manager.js';
import { autoFetchURLsFromText } from '../tools/url-fetch-tool.js';
import type { Accountability, Item, SchemaOverview } from '../../../types/index.js';
import type { Response } from 'express';
import type { ModelMessage } from 'ai';

const logger = useLogger();

export interface ChatContext {
  ngo_id?: string;
  grant_id?: string;
  application_id?: string;
  context_type?: string;
}

export interface CreateChatOptions {
  messages: ModelMessage[];
  userId: string | null;
  context?: ChatContext;
  model?: string;
  temperature?: number;
}

export interface StreamChatOptions {
  chatId: string;
  messages: ModelMessage[];
  context?: ChatContext;
  model?: string; // Optional - determined by context
  temperature?: number;
  stream: Response;
  ephemeralContext?: any; // Ephemeral data not stored in database
}

export class ChatService extends ItemsService {
  override accountability: Accountability | null;
  override schema: SchemaOverview;

  constructor(options: { accountability: Accountability | null; schema: SchemaOverview }) {
    super('chats', options);
    this.accountability = options.accountability;
    this.schema = options.schema;
  }

  /**
   * Create a new chat or get existing one based on context
   */
  async createOrGetChat(options: CreateChatOptions) {
    const { messages, userId, context } = options;
    const knex = getDatabase();

    try {
      // Generate initial title from first message
      const firstMessage = messages[0];
      const title = firstMessage && typeof firstMessage.content === 'string'
        ? firstMessage.content.substring(0, 100)
        : 'New Chat';

      // Check if we should reuse an existing chat based on context
      if (context?.application_id) {
        const existingChat = await knex('chats')
          .where('application_id', context.application_id)
          .where('created_by', userId)
          .where('status', 'active')
          .orderBy('created_at', 'desc')
          .first();

        if (existingChat) {
          return existingChat;
        }
      }

      // Create new chat
      const chat: Item = await knex('chats').insert({
        title,
        ngo_id: context?.ngo_id || null,
        application_id: context?.application_id || null,
        grant_id: context?.grant_id || null,
        context_type: context?.context_type || 'general',
        visibility: 'private',
        status: 'active',
        metadata: {},
        created_at: new Date(),
        created_by: userId,
      }).returning('*');

      // Log activity to ai_activity_logs
      if (userId && chat['id']) {
        try {
          await knex('ai_activity_logs').insert({
            user_id: userId,
            activity_type: 'chat_created',
            entity_type: 'chats',
            entity_id: chat['id'],
            description: `Created new chat: ${title}`,
            metadata: {
              context_type: context?.context_type || 'general',
              ngo_id: context?.ngo_id,
              grant_id: context?.grant_id,
              application_id: context?.application_id,
            },
            ip_address: this.accountability?.ip || null,
            user_agent: this.accountability?.userAgent || null,
            created_at: new Date()
          });
        } catch (logError) {
          // Don't throw - logging should not break operations
          logger.error(logError, 'Failed to log chat creation activity');
        }
      }

      return chat[0];
    } catch (error) {
      logger.error(error, 'Error creating chat');
      throw error;
    }
  }

  /**
   * Create or get the single chat for an application (one chat per application)
   */
  async createOrGetApplicationChat(options: {
    messages: ModelMessage[];
    userId: string;
    context: ChatContext;
    temperature?: number;
  }) {
    const { messages, userId, context } = options;
    const knex = getDatabase();

    try {
      // Ensure we have all required context for application
      if (!context.application_id || !context.ngo_id || !context.grant_id) {
        throw new Error('Application context requires application_id, ngo_id, and grant_id');
      }

      // Check if chat already exists for this application
      const existingChat = await knex('chats')
        .where('application_id', context.application_id)
        .where('status', 'active')
        .first();

      if (existingChat) {
        logger.info(`Using existing chat ${existingChat.id} for application ${context.application_id}`);
        return existingChat;
      }

      // Create new chat for this application
      const firstMessage = messages[0];
      const title = firstMessage && typeof firstMessage.content === 'string'
        ? `Application Chat: ${firstMessage.content.substring(0, 60)}...`
        : 'Application Chat';

      const [chat] = await knex('chats').insert({
        title,
        ngo_id: context.ngo_id,
        application_id: context.application_id,
        grant_id: context.grant_id,
        context_type: 'application',
        visibility: 'private',
        status: 'active',
        metadata: {
          application_context: true,
          created_for_application: context.application_id
        },
        created_at: new Date(),
        created_by: userId,
      }).returning('*');

      // Log activity
      if (userId && chat['id']) {
        try {
          await knex('ai_activity_logs').insert({
            user_id: userId,
            activity_type: 'application_chat_created',
            entity_type: 'chats',
            entity_id: chat['id'],
            description: `Created application chat for application ${context.application_id}`,
            metadata: {
              context_type: 'application',
              ngo_id: context.ngo_id,
              grant_id: context.grant_id,
              application_id: context.application_id,
            },
            ip_address: this.accountability?.ip || null,
            user_agent: this.accountability?.userAgent || null,
            created_at: new Date()
          });
        } catch (logError) {
          logger.error(logError, 'Failed to log application chat creation activity');
        }
      }

      logger.info(`Created new application chat ${chat['id']} for application ${context.application_id}`);
      return chat;

    } catch (error) {
      logger.error(error, 'Error creating application chat');
      throw error;
    }
  }

  /**
   * Get chat by application ID for frontend
   */
  async getChatByApplicationId(applicationId: string) {
    const knex = getDatabase();

    try {
      const chat = await knex('chats')
        .where('application_id', applicationId)
        .where('status', 'active')
        .first();

      if (!chat) {
        return null;
      }

      // Get recent messages for this chat
      const messages = await knex('chat_messages')
        .where('chat_id', chat.id)
        .orderBy('created_at', 'asc')
        .limit(50); // Limit to last 50 messages

      return {
        ...chat,
        messages
      };

    } catch (error) {
      logger.error(error, 'Error getting chat by application ID');
      throw error;
    }
  }

  /**
   * Stream chat response using Vercel AI SDK
   */
  async streamChatResponse(options: StreamChatOptions) {
    const { chatId, messages, context, temperature, stream, ephemeralContext } = options;

    try {
      // Build RAG context based on the latest message
      const latestMessage = messages[messages.length - 1];
      if (!latestMessage || typeof latestMessage.content !== 'string') {
        throw new Error('Invalid message format');
      }

      // Auto-detect and fetch URLs from user message with context
      let enhancedContent = latestMessage.content;

      // Build user context from the actual conversation and message
      const conversationContext = messages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
      const userContext = `User's current question/context: "${latestMessage.content}"\n\nRecent conversation:\n${conversationContext}`;

      const fetchedURLs = await autoFetchURLsFromText(latestMessage.content, userContext);

      if (fetchedURLs.length > 0) {
        logger.info(`✅ Auto-fetched and analyzed ${fetchedURLs.length} URL(s) for context`);

        // Add structured analyzed content to message context
        const urlContexts = fetchedURLs.map(url => {
          return `URL: ${url.url}
Title: ${url.title}
Content Type: ${url.contentType}
Summary: ${url.summary}
Key Insights: ${url.keyInsights.join('; ')}
Relevance: ${url.relevanceToUser}
---
Raw Content: ${url.content.substring(0, 1500)}`;
        }).join('\n\n---\n\n');

        enhancedContent = `${latestMessage.content}\n\n[AI-analyzed URL content for context:]\n${urlContexts}`;
      }

      // Chat is ALWAYS in context of NGO + Grant + Application creation
      // Use comprehensive application context with required IDs
      if (!context?.ngo_id || !context?.grant_id) {
        throw new Error('Chat requires NGO ID and Grant ID context');
      }

      const ragContext = await enhancedRAGService.buildCompleteApplicationContext(
        enhancedContent,
        {
          ngo_id: context.ngo_id,
          grant_id: context.grant_id,
          application_id: context.application_id!,
          include_web_search: false, // Disabled for speed - AI can use searchWeb() tool when needed
          prioritize_compliance: true
        }
      );

      // LOG: Context summary for this chat request
      logger.info({
        chat_id: chatId,
        application_id: context.application_id,
        grant_id: context.grant_id,
        ngo_id: context.ngo_id,
        existing_documents: ragContext.application_status?.existing_content?.length || 0,
        grant_documents: ragContext.grant_details?.documents?.length || 0,
        requirements_count: ragContext.grant_details?.requirements_matrix?.length || 0,
        user_message_length: latestMessage.content.length
      }, '[CHAT STREAM] Starting with context:');

      // Build system message for application context
      const systemMessage = this.buildApplicationSystemMessage(ragContext, ephemeralContext);

      // Add context as the first message
      const messagesWithContext: ModelMessage[] = [
        { role: 'system', content: systemMessage },
        ...messages,
      ];

      // Store user message
      await this.addMessage(
        chatId,
        {
          content: latestMessage.content,
          role: 'user',
          metadata: { context: context || {} },
        },
        this.accountability?.user || null
      );

      // Get application-specific tools
      const tools = getChatTools({
        accountability: this.accountability,
        schema: this.schema,
        userId: this.accountability?.user || null,
        applicationContext: context,
      });

      // Always use applicationCreationModel for grant application context
      const selectedModel = applicationCreationModel();

      // Send initial thinking event
      stream.write(`data: ${JSON.stringify({
        type: 'thinking',
        message: 'Analyzing your request and gathering context...',
        phase: 'initializing'
      })}\n\n`);

      const result = await streamText({
        model: selectedModel,
        messages: messagesWithContext,
        temperature: temperature || 0.7,
        tools,
        toolChoice: 'auto', // Let the model decide when to use tools
        stopWhen: stepCountIs(50), // Allow up to 50 steps for complex multi-tool operations
        onStepFinish: async (step) => {
          // Save each step as a separate message (multi-step responses broken into parts)
          if (step.text && step.text.trim().length > 0) {
            await this.addMessage(
              chatId,
              {
                content: step.text,
                role: 'assistant',
                metadata: {
                  usage: step.usage,
                  finishReason: step.finishReason,
                  toolCalls: step.toolCalls || [],
                  toolResults: step.toolResults || [],
                  multiStep: true, // Flag to indicate this is part of multi-step response
                },
              },
              this.accountability?.user || null
            );
          }
        },
      });

      // Stream to response with enhanced events
      try {
        for await (const chunk of result.fullStream) {
          // Handle different chunk types
          // Support both property naming conventions (textDelta/text for compatibility)
          if (chunk.type === 'tool-input-start') {
            // Tool input is starting - this happens BEFORE tool execution
            // Perfect time to show loading indicator!
            const toolName = (chunk as any).toolName;

            if (toolName === 'createApplicationDocument') {
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: 'Creating document...',
                phase: 'creating_document'
              })}\n\n`);
            } else if (toolName === 'updateApplicationDocument') {
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: 'Updating document...',
                phase: 'updating_document'
              })}\n\n`);
            } else if (toolName === 'deleteApplicationDocument') {
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: 'Deleting document...',
                phase: 'deleting_document'
              })}\n\n`);
            } else if (toolName === 'listApplicationDocuments') {
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: 'Loading documents...',
                phase: 'loading_documents'
              })}\n\n`);
            } else if (toolName === 'searchWeb') {
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: 'Searching the web...',
                phase: 'searching_web'
              })}\n\n`);
            } else if (toolName === 'getCurrentGrantInfo') {
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: 'Fetching grant requirements...',
                phase: 'fetching_grant'
              })}\n\n`);
            } else if (toolName === 'getCurrentNGOInfo') {
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: 'Loading organization details...',
                phase: 'fetching_ngo'
              })}\n\n`);
            } else {
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: `Executing: ${toolName}...`,
                phase: 'executing_tool'
              })}\n\n`);
            }
          } else if (chunk.type === 'text-delta') {
            const textContent = (chunk as any).textDelta || (chunk as any).text || '';
            stream.write(`data: ${JSON.stringify({
              type: 'content',
              content: textContent
            })}\n\n`);
          } else if (chunk.type === 'tool-call') {
            // Tool call with complete arguments (happens AFTER tool-input chunks)
            const toolArgs = (chunk as any).args || (chunk as any).input;

            // LOG 6: Stream - tool called with args
            if (chunk.toolName === 'updateApplicationDocument') {
              logger.info({
                tool: chunk.toolName,
                args_keys: Object.keys(toolArgs || {}),
                document_id: toolArgs?.document_id,
                document_title: toolArgs?.document_title,
                content_length: toolArgs?.content?.length,
                toolCallId: chunk.toolCallId
              },'[STREAM] updateApplicationDocument tool called:');
            }

            // Update the thinking message with the actual document title if available
            if (chunk.toolName === 'createApplicationDocument' && toolArgs?.title) {
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: `Creating: ${toolArgs.title}`,
                phase: 'creating_document'
              })}\n\n`);
            } else if (chunk.toolName === 'updateApplicationDocument' && toolArgs?.title) {
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: `Updating: ${toolArgs.title}`,
                phase: 'updating_document'
              })}\n\n`);
            }

            // Send the tool call event with complete arguments
            stream.write(`data: ${JSON.stringify({
              type: 'tool_call',
              tool: chunk.toolName,
              args: toolArgs,
              status: 'started',
              toolCallId: chunk.toolCallId
            })}\n\n`);
          } else if (chunk.type === 'tool-result') {
            // Support both result and output property names
            const toolResult = (chunk as any).result || (chunk as any).output;
            const toolArgs = (chunk as any).args || (chunk as any).input;

            stream.write(`data: ${JSON.stringify({
              type: 'tool_result',
              tool: chunk.toolName,
              result: toolResult,
              args: toolArgs,
              status: 'completed',
              toolCallId: chunk.toolCallId
            })}\n\n`);

            // If this was a document creation tool, send special event
            if (chunk.toolName === 'createApplicationDocument' && toolResult?.success) {
              const doc = toolResult.document;
              stream.write(`data: ${JSON.stringify({
                type: 'document_created',
                document: doc,
                message: `✓ Created: ${doc?.title || 'Document'}`
              })}\n\n`);

              // Clear thinking state after document creation
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: null,
                phase: 'complete'
              })}\n\n`);
            } else if (chunk.toolName === 'updateApplicationDocument' && toolResult?.success) {
              const doc = toolResult.document;

              // LOG 7: Stream - document update result
              logger.info({
                success: toolResult?.success,
                document_id: doc?.id,
                document_title: doc?.title,
                content_length: doc?.content?.length,
                version_number: toolResult?.version_number,
                toolCallId: chunk.toolCallId
              },'[STREAM] updateApplicationDocument result:');

              stream.write(`data: ${JSON.stringify({
                type: 'document_updated',
                document: doc,
                message: `✓ Updated: ${doc?.title || 'Document'}`
              })}\n\n`);

              // Clear thinking state
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: null,
                phase: 'complete'
              })}\n\n`);
            } else if (chunk.toolName === 'deleteApplicationDocument' && toolResult?.success) {
              stream.write(`data: ${JSON.stringify({
                type: 'document_deleted',
                message: toolResult.message || '✓ Document deleted'
              })}\n\n`);

              // Clear thinking state
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: null,
                phase: 'complete'
              })}\n\n`);
            } else if (chunk.toolName === 'listApplicationDocuments' && toolResult?.success) {
              stream.write(`data: ${JSON.stringify({
                type: 'documents_listed',
                documents: toolResult.documents,
                count: toolResult.count,
                message: toolResult.message
              })}\n\n`);

              // Clear thinking state
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: null,
                phase: 'complete'
              })}\n\n`);
            } else if (chunk.toolName === 'getApplicationProgress' && toolResult?.success) {
              stream.write(`data: ${JSON.stringify({
                type: 'progress_update',
                progress: toolResult.progress,
                message: toolResult.message
              })}\n\n`);
            } else {
              // Clear thinking state for any other tool completion
              stream.write(`data: ${JSON.stringify({
                type: 'thinking',
                message: null,
                phase: 'complete'
              })}\n\n`);
            }
          } else if (chunk.type === 'finish') {
            // Clear any remaining thinking state before completion
            stream.write(`data: ${JSON.stringify({
              type: 'thinking',
              message: null,
              phase: 'complete'
            })}\n\n`);

            // Final completion event
            stream.write(`data: ${JSON.stringify({
              type: 'complete',
              finishReason: chunk.finishReason,
              usage: chunk.totalUsage || (chunk as any).usage
            })}\n\n`);
          } else if (chunk.type === 'error') {
            // Handle streaming errors
            stream.write(`data: ${JSON.stringify({
              type: 'error',
              error: chunk.error,
              message: chunk.error instanceof Error ? chunk.error.message : 'An error occurred during streaming'
            })}\n\n`);
          } else if (chunk.type === 'tool-error') {
            // Tool execution errors
            stream.write(`data: ${JSON.stringify({
              type: 'tool_error',
              tool: chunk.toolName,
              error: chunk.error,
              message: `Failed: ${chunk.error instanceof Error ? chunk.error.message : 'Unknown error'}`
            })}\n\n`);
          } else if (
            chunk.type === 'start' ||
            chunk.type === 'start-step' ||
            chunk.type === 'finish-step' ||
            chunk.type === 'text-start' ||
            chunk.type === 'text-end' ||
            chunk.type === 'tool-input-delta' ||
            chunk.type === 'tool-input-end'
          ) {
            // Internal SDK events - no action needed, handled by other chunk types
            // start: Stream initialization
            // start-step/finish-step: Multi-step reasoning boundaries
            // text-start/text-end: Text generation boundaries
            // tool-input-delta/tool-input-end: Tool argument streaming (handled in tool-input-start and tool-call)
          } else {
            // Log truly unhandled chunk types for debugging
            logger.warn(`Unhandled chunk type: ${chunk.type}`, { chunk });
          }
        }

        // Send done event
        stream.write(`data: ${JSON.stringify({ type: 'done', data: '[DONE]' })}\n\n`);
        stream.end();

      } catch (streamError: any) {
        // Stream error - send error SSE event before ending
        logger.error(streamError, 'Error during SSE stream:');

        // Check if it's a rate limit error
        const isRateLimitError = streamError.message?.includes('rate limit') || streamError.statusCode === 429;
        const errorMessage = isRateLimitError
          ? 'Rate limit exceeded. Please wait a moment and try again.'
          : streamError.message || 'An unexpected error occurred';

        stream.write(`data: ${JSON.stringify({
          type: 'error',
          error: errorMessage,
          isRateLimitError,
          retryAfter: streamError.responseHeaders?.['retry-after']
        })}\n\n`);

        stream.write(`data: ${JSON.stringify({ type: 'done', data: '[ERROR]' })}\n\n`);
        stream.end();
      }

    } catch (error) {
      // Error before streaming started
      logger.error(error, 'Error streaming chat response:');
      throw error;
    }
  }

  /**
   * Build system message specifically for application context (NEW - replaces buildSystemMessage)
   */
  private buildApplicationSystemMessage(ragContext: any, ephemeralContext?: any): string {
    const hasExistingDocuments = ragContext.application_status?.existing_content?.length > 0;

    let systemMessage = `You are an AI assistant for grant application creation in AntragPlus.

COMMUNICATION STYLE:
- Be direct and concise - keep responses under 2-3 sentences unless creating documents
- CRITICAL: After using ANY tool, you MUST respond with a brief summary of what you did or found
- NEVER use tools silently - always tell the user what you're doing and what you found
- NEVER end your response with only tool calls - ALWAYS include text explaining what you did
- If user asks for a summary or information, respond with TEXT ONLY - do not use document tools
- Use a conversational, helpful tone

YOUR ROLE:
- Help create, edit, and manage grant application documents
- Provide grant-specific guidance using exact requirements
- Ensure all content matches grant requirements and NGO capabilities

${!hasExistingDocuments ? `
NEW APPLICATION: Ask the user about their project idea for this grant.
` : ''}

`;

    // Add grant context (essentials only - AI can use tools for details)
    if (ragContext.grant_details?.info) {
      const reqCount = ragContext.grant_details.requirements_matrix?.length || 0;
      systemMessage += `CURRENT GRANT:
- Name: ${ragContext.grant_details.info.name}
- Provider: ${ragContext.grant_details.info.provider}
- Deadline: ${ragContext.grant_details.info.deadline}
- Amount: €${ragContext.grant_details.info.amount_min} - €${ragContext.grant_details.info.amount_max}
- Language: ${ragContext.grant_details.language_requirements}
- Requirements: ${reqCount} documented (use getCurrentGrantInfo() tool for full list)

`;
    }

    // Add NGO context (essentials only - AI can use tools for details)
    if (ragContext.ngo_details?.info) {
      systemMessage += `CURRENT NGO:
- Organization: ${ragContext.ngo_details.info.organization_name}
- Field: ${ragContext.ngo_details.info.field_of_work}
- Location: ${ragContext.ngo_details.info.location}
- Past applications: ${ragContext.ngo_details.past_applications?.length || 0} (use getCurrentNGOInfo() for details)

`;
    }

    // Add current application documents (keep full list - this is relevant)
    if (ragContext.application_status?.existing_content?.length > 0) {
      systemMessage += `EXISTING DOCUMENTS (${ragContext.application_status.existing_content.length}):
${ragContext.application_status.existing_content.map((doc: any) =>
        `- ${doc.title} (${doc.kind})`
      ).join('\n')}

`;
    }

    // Add uploaded attachments (keep - important context)
    if (ragContext.application_status?.attachments?.length > 0) {
      systemMessage += `UPLOADED ATTACHMENTS (${ragContext.application_status.attachments.length}):
${ragContext.application_status.attachments.map((att: any) => {
        const content = att.extracted_content || att.direct_content;
        const hasContent = content && content.length > 100;
        return `- ${att.filename_download} ${hasContent ? '(content available)' : '(processing...)'}`;
      }).join('\n')}

Use getApplicationAttachments() tool to list or read attachment content.
When user references "my file", "previous application", "annual report", etc., use this tool.

`;
    }

    // Add ephemeral context (current document user is viewing/editing)
    if (ephemeralContext?.current_document) {
      const doc = ephemeralContext.current_document;
      systemMessage += `
CURRENT DOCUMENT (user is viewing):
- Title: "${doc.title}"
- Type: ${doc.kind || 'text'}
- ID: ${doc.id}

When user says "this", "here", "current document", they mean ID: ${doc.id}

`;
    }

    systemMessage += `TOOLS AVAILABLE:
- createApplicationDocument / updateApplicationDocument / deleteApplicationDocument / listApplicationDocuments
- getApplicationAttachments() - List/read user-uploaded files (PDFs, previous applications, supporting docs)
- getCurrentGrantInfo() - ALWAYS CHECK THIS FIRST for grant requirements and guidelines
- getCurrentNGOInfo() - ALWAYS CHECK THIS FIRST for NGO capabilities and track record
- searchWeb() - ONLY use if internal info is missing. ALWAYS inform user "I'm searching the web for additional context..." before using

IMPORTANT WORKFLOW:
1. Check getCurrentGrantInfo() and getCurrentNGOInfo() FIRST
2. Use getApplicationAttachments() when user references their uploaded files or attachments
3. Only use searchWeb() if critical information is missing from internal database
4. If using searchWeb(), ALWAYS tell the user first: "Let me search the web for additional information..."
5. If web search fails/times out, continue with internal data and inform user

Use tools proactively when you need detailed information.`;

    return systemMessage;
  }


  /**
   * Get all chats for a user
   */
  async getUserChats(userId: string) {
    const knex = getDatabase();

    try {
      const chats = await knex('chats')
        .select(
          'chats.*',
          knex.raw('COUNT(DISTINCT chat_messages.id) as message_count'),
          knex.raw('MAX(chat_messages.created_at) as last_message_at')
        )
        .leftJoin('chat_messages', 'chats.id', 'chat_messages.chat_id')
        .where('chats.created_by', userId)
        .where('chats.status', '!=', 'deleted')
        .groupBy('chats.id')
        .orderBy('last_message_at', 'desc');

      return chats;
    } catch (error) {
      logger.error(error, 'Error fetching user chats');
      throw error;
    }
  }

  /**
   * Get a specific chat with messages
   */
  async getChat(chatId: string, userId: string) {
    const knex = getDatabase();

    try {
      const chat = await knex('chats')
        .where('id', chatId)
        .where('created_by', userId)
        .where('status', '!=', 'deleted')
        .first();

      if (!chat) {
        return null;
      }

      // Get messages
      const messages = await knex('chat_messages')
        .where('chat_id', chatId)
        .orderBy('created_at', 'asc');

      return {
        ...chat,
        messages,
      };
    } catch (error) {
      logger.error(error, 'Error fetching chat');
      throw error;
    }
  }

  /**
   * Update chat metadata
   */
  async updateChat(chatId: string, updates: any, userId: string) {
    const knex = getDatabase();

    try {
      const updated = await knex('chats')
        .where('id', chatId)
        .where('created_by', userId)
        .update({
          ...updates,
          updated_at: new Date(),
          updated_by: userId,
        })
        .returning('*');

      return updated[0];
    } catch (error) {
      logger.error(error, 'Error updating chat');
      throw error;
    }
  }

  /**
   * Delete a chat (soft delete)
   */
  async deleteChat(chatId: string, userId: string) {
    const knex = getDatabase();

    try {
      await knex('chats')
        .where('id', chatId)
        .where('created_by', userId)
        .update({
          status: 'deleted',
          updated_at: new Date(),
          updated_by: userId,
        });

      return true;
    } catch (error) {
      logger.error(error, 'Error deleting chat');
      throw error;
    }
  }

  /**
   * Get messages for a chat
   */
  async getChatMessages(chatId: string, userId: string) {
    const knex = getDatabase();

    try {
      // Verify chat ownership
      const chat = await knex('chats')
        .where('id', chatId)
        .where('created_by', userId)
        .first();

      if (!chat) {
        throw new Error('Chat not found');
      }

      const messages = await knex('chat_messages')
        .where('chat_id', chatId)
        .orderBy('created_at', 'asc');

      return messages;
    } catch (error) {
      logger.error(error, 'Error fetching messages');
      throw error;
    }
  }

  /**
   * Add a message to a chat
   */
  async addMessage(
    chatId: string,
    message: { content: string; role: string; attachments?: any; metadata?: any },
    userId: string | null
  ) {
    const knex = getDatabase();

    try {
      const inserted: any = await knex('chat_messages').insert({
        chat_id: chatId,
        role: message.role,
        content: message.content,
        attachments: message.attachments || [],
        metadata: message.metadata || {},
        created_at: new Date(),
        created_by: userId,
      }).returning('id');

      // Queue embedding generation for this message using the queue manager
      if (message.content && inserted?.id) {
        const queueManager = new QueueManager(this.schema, this.accountability);
        const embeddingQueue = queueManager.getEmbeddingQueue();
        await embeddingQueue.addEmbeddingJobs([{
          source_table: 'chat_messages',
          source_id: inserted.id,
          operation: 'insert',
          priority: 5
        }]);
      }

      // Log activity to ai_activity_logs
      // For assistant messages, we need to get the chat owner
      let activityUserId = userId;
      if (!activityUserId && message.role === 'assistant') {
        const chat = await knex('chats')
          .where('id', chatId)
          .select('created_by')
          .first();
        activityUserId = chat?.created_by;
      }

      if (activityUserId && inserted?.id) {
        try {
          await knex('ai_activity_logs').insert({
            user_id: activityUserId,
            activity_type: message.role === 'assistant' ? 'ai_response_received' : 'message_sent',
            entity_type: 'chat_messages',
            entity_id: inserted.id,
            description: `${message.role} message ${message.role === 'assistant' ? 'received' : 'sent'} in chat`,
            metadata: {
              chat_id: chatId,
              role: message.role,
              content_length: message.content?.length || 0,
              ...(message.metadata?.model && { model: message.metadata.model }),
              ...(message.metadata?.usage && { usage: message.metadata.usage }),
            },
            ip_address: this.accountability?.ip || null,
            user_agent: this.accountability?.userAgent || null,
            created_at: new Date()
          });
        } catch (logError) {
          // Don't throw - logging should not break operations
          logger.error(logError, 'Failed to log message activity');
        }
      }

      // Update chat's updated_at
      await knex('chats')
        .where('id', chatId)
        .update({
          updated_at: new Date(),
          updated_by: userId,
        });

      return inserted[0];
    } catch (error) {
      logger.error(error, 'Error adding message');
      throw error;
    }
  }
}
