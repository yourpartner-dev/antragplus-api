import { streamText } from 'ai';
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
          logger.error(logError, 'Failed to log chat creation activity' );
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
    const { chatId, messages, context, temperature, stream } = options;

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
          include_web_search: true,
          prioritize_compliance: true
        }
      );

      // Build system message for application context
      const systemMessage = this.buildApplicationSystemMessage(ragContext);

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
      const result = await streamText({
        model: selectedModel,
        messages: messagesWithContext,
        temperature: temperature || 0.7,
        tools,
        toolChoice: 'auto', // Let the model decide when to use tools
        onFinish: async (result) => {
          // Store assistant message
          await this.addMessage(
            chatId,
            {
              content: result.text,
              role: 'assistant',
              metadata: {
                usage: result.usage,
                finishReason: result.finishReason,
                toolCalls: result.toolCalls,
                toolResults: result.toolResults,
              },
            },
            this.accountability?.user || null
          );
        },
      });

      // Stream to response
      for await (const chunk of result.textStream) {
        stream.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      // Send done event
      stream.write(`event: done\n`);
      stream.write(`data: [DONE]\n\n`);
      stream.end();

    } catch (error) {
      logger.error(error, 'Error streaming chat response:');
      throw error;
    }
  }

  /**
   * Build system message specifically for application context (NEW - replaces buildSystemMessage)
   */
  private buildApplicationSystemMessage(ragContext: any): string {
    let systemMessage = `You are an AI assistant specializing in grant application creation and editing for AntragPlus.

CONTEXT: You are working within an application workspace where you help create, edit, and manage grant application documents.

Your capabilities:
- Create new application documents (proposals, budgets, timelines, cover letters, etc.)
- Edit existing application documents with precision
- Delete documents when requested
- Regenerate content based on updated context
- Provide grant-specific guidance using exact requirements
- Ensure compliance with all grant guidelines

IMPORTANT: You are working with a specific grant and NGO combination. All documents you create must be tailored to:
- The specific grant requirements and terminology
- The NGO's profile, capabilities, and track record
- The application's current state and existing documents

`;

    // Add grant context
    if (ragContext.grant_details?.info) {
      systemMessage += `CURRENT GRANT:
Name: ${ragContext.grant_details.info.name}
Provider: ${ragContext.grant_details.info.provider}
Deadline: ${ragContext.grant_details.info.deadline}
Amount: €${ragContext.grant_details.info.amount_min} - €${ragContext.grant_details.info.amount_max}
Language: ${ragContext.grant_details.language_requirements}

GRANT REQUIREMENTS:
${ragContext.grant_details.requirements_matrix.join('\n')}

SUBMISSION GUIDELINES:
${ragContext.grant_details.submission_guidelines.join('\n')}

`;
    }

    // Add NGO context
    if (ragContext.ngo_details?.info) {
      systemMessage += `CURRENT NGO:
Organization: ${ragContext.ngo_details.info.organization_name}
Field of Work: ${ragContext.ngo_details.info.field_of_work}
Company Size: ${ragContext.ngo_details.info.company_size}
Location: ${ragContext.ngo_details.info.location}

NGO CAPABILITIES:
${ragContext.ngo_details.capabilities.join('\n')}

TRACK RECORD:
- Total Applications: ${ragContext.ngo_details.financial_track_record.total_applications}
- Success Rate: ${ragContext.ngo_details.financial_track_record.success_rate}%
- Total Funding: €${ragContext.ngo_details.financial_track_record.total_funding_awarded}

`;
    }

    // Add current application documents context
    if (ragContext.application_status?.existing_content?.length > 0) {
      systemMessage += `CURRENT APPLICATION DOCUMENTS:
${ragContext.application_status.existing_content.map((doc: any) =>
  `- ${doc.title} (${doc.kind}) - ${doc.updated_at}`
).join('\n')}

`;
    }

    // Add compliance requirements
    if (ragContext.compliance_matrix?.required_documents?.length > 0) {
      systemMessage += `REQUIRED DOCUMENTS:
${ragContext.compliance_matrix.required_documents.join('\n')}

`;
    }

    // Add historical context
    if (ragContext.historical_examples?.best_practices?.length > 0) {
      systemMessage += `BEST PRACTICES:
${ragContext.historical_examples.best_practices.join('\n')}

`;
    }

    systemMessage += `When users request document operations:
- Use createApplicationDocument to create new documents
- Use updateApplicationDocument to edit existing documents
- Use deleteApplicationDocument to remove documents
- Always specify the correct document kind (proposal, budget, timeline, cover_letter, etc.)
- Include the current application_id, ngo_id, and grant_id in your operations

Remember: Every operation should be informed by the specific grant requirements and NGO capabilities listed above.`;

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
