import { streamText } from 'ai';
import { getOpenAIModel } from '../providers.js';
import { useLogger } from '../../../helpers/logger/index.js';
import { ItemsService } from '../../items.js';
import getDatabase from '../../../database/index.js';
import { ragService } from '../../rag-service.js';
import { enhancedRAGService } from '../enhanced-rag-service.js';
import { getChatTools } from '../tools/chat-tools.js';
import { QueueManager } from '../../queues/queue-manager.js';
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
  model: string;
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
   * Stream chat response using Vercel AI SDK
   */
  async streamChatResponse(options: StreamChatOptions) {
    const { chatId, messages, context, model, temperature, stream } = options;

    try {
      // Build RAG context based on the latest message
      const latestMessage = messages[messages.length - 1];
      if (!latestMessage || typeof latestMessage.content !== 'string') {
        throw new Error('Invalid message format');
      }
      
      const ragContext = await enhancedRAGService.buildGrantApplicationContext(
        latestMessage.content,
        {
          chatId,
          ngo_id: context?.ngo_id,
          grant_id: context?.grant_id,
          application_id: context?.application_id,
          include_web_search: true,
          prioritize_compliance: true
        }
      );

      // Build system message with context
      const systemMessage = this.buildSystemMessage(ragContext, context);

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

      // Get available tools
      const tools = getChatTools({
        accountability: this.accountability,
        schema: this.schema,
        userId: this.accountability?.user || null,
      });

      // Stream the response with tools
      const result = await streamText({
        model: getOpenAIModel(model),
        messages: messagesWithContext,
        ...(temperature !== undefined && { temperature }),
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
                model,
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
   * Build system message with RAG context
   */
  private buildSystemMessage(ragContext: any, chatContext?: ChatContext): string {
    let systemMessage = `You are an AI assistant for AntragPlus, helping NGOs with grant applications and management.

Your role is to:
1. Help NGOs find suitable grants and funding opportunities
2. Assist with grant application writing and document creation
3. Provide current, up-to-date guidance on application requirements
4. Help manage application documents with version control
5. Answer questions about NGOs, grants, and applications
6. Research best practices and current trends in grant writing

You have access to comprehensive tools:
- Web Search: Search the web for current information about grants, funding, best practices
- Document Management: Create, edit, update, and suggest improvements for grant documents
- Grant Search: Find grants matching specific criteria in our database
- NGO Management: Access and update NGO information
- Application Management: Create and manage grant applications
- Grant Matching: Find grants that match NGO profiles with AI analysis

When users ask about current funding opportunities, best practices, or recent changes in grant requirements, use web search to provide up-to-date information. For document creation and editing, use the enhanced document tools that support versioning and AI suggestions.

`;

    // Add specific context based on chat type
    if (chatContext?.context_type === 'application_edit') {
      systemMessage += `\nYou are currently helping edit a grant application. Focus on improving the content, structure, and alignment with grant requirements.`;
    } else if (chatContext?.context_type === 'ngo_onboarding') {
      systemMessage += `\nYou are helping onboard a new NGO. Gather relevant information about their organization, mission, and funding needs.`;
    } else if (chatContext?.context_type === 'grant_discovery') {
      systemMessage += `\nYou are helping discover suitable grants. Focus on matching grants to the NGO's profile and needs.`;
    }

    // Add enhanced RAG context
    if (ragContext) {
      // Add compliance notes first (high priority)
      if (ragContext.compliance_notes && ragContext.compliance_notes.length > 0) {
        systemMessage += '\n\n🚨 COMPLIANCE REQUIREMENTS:\n';
        ragContext.compliance_notes.forEach((note: string, index: number) => {
          systemMessage += `${index + 1}. ${note}\n`;
        });
      }

      // Add grant and NGO context
      if (ragContext.grant_info) {
        systemMessage += `\n\nGRANT CONTEXT:\n`;
        systemMessage += `Name: ${ragContext.grant_info.name}\n`;
        systemMessage += `Provider: ${ragContext.grant_info.provider}\n`;
        systemMessage += `Deadline: ${ragContext.grant_info.deadline}\n`;
        systemMessage += `Amount: €${ragContext.grant_info.amount_min} - €${ragContext.grant_info.amount_max}\n`;
      }

      if (ragContext.ngo_info) {
        systemMessage += `\n\nNGO CONTEXT:\n`;
        systemMessage += `Name: ${ragContext.ngo_info.organization_name}\n`;
        systemMessage += `Field: ${ragContext.ngo_info.field_of_work}\n`;
        systemMessage += `Size: ${ragContext.ngo_info.company_size}\n`;
      }

      // Add relevant internal knowledge
      if (ragContext.chunks && ragContext.chunks.length > 0) {
        systemMessage += '\n\nRELEVANT INTERNAL KNOWLEDGE:\n';
        ragContext.chunks.slice(0, 5).forEach((chunk: any, index: number) => {
          systemMessage += `${index + 1}. [${chunk.source_table}] ${chunk.chunk_text.substring(0, 150)}...\n`;
        });
      }

      // Add external insights if available
      if (ragContext.external_insights && ragContext.external_insights.length > 0) {
        systemMessage += '\n\nCURRENT EXTERNAL INSIGHTS:\n';
        ragContext.external_insights.slice(0, 3).forEach((insight: any, index: number) => {
          systemMessage += `${index + 1}. ${insight.title}\n${insight.content.substring(0, 200)}...\n\n`;
        });
      }
    }

    // Add current entities if available
    if (chatContext?.ngo_id) {
      systemMessage += `\n\nCurrent NGO ID: ${chatContext.ngo_id}`;
    }
    if (chatContext?.grant_id) {
      systemMessage += `\nCurrent Grant ID: ${chatContext.grant_id}`;
    }
    if (chatContext?.application_id) {
      systemMessage += `\nCurrent Application ID: ${chatContext.application_id}`;
    }

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
