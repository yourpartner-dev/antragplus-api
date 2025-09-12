import { useLogger } from '../helpers/logger/index.js';
import getDatabase from '../database/index.js';
import { useRedis } from '../redis/index.js';
import { nanoid } from 'nanoid';
import { embeddingProvider } from './ai/embeddings/openai-embeddings.js';
import type { Knex } from 'knex';
import type { Redis } from 'ioredis';

const logger = useLogger();

export interface RAGContext {
  chunks: Array<{
    id: string;
    source_table: string;
    source_id: string;
    source_field: string;
    chunk_text: string;
    similarity: number;
    metadata: Record<string, any>;
  }>;
  query: string;
  timestamp: Date;
}

export interface RAGSearchOptions {
  limit?: number;
  threshold?: number;
  filter?: {
    ngo_id?: string;
    grant_id?: string;
    application_id?: string;
    language?: string;
    source_tables?: string[];
  };
  includeMetadata?: boolean;
  boostRecent?: boolean;
}

export class RAGService {
  private knex: Knex;
  private redis: Redis | null;

  constructor() {
    this.knex = getDatabase();
    this.redis = useRedis();
  }

  /**
   * Search for similar content using vector similarity
   */
  async searchSimilar(
    query: string,
    options: RAGSearchOptions = {}
  ): Promise<RAGContext> {
    const {
      limit = 10,
      threshold = 0.7,
      filter = {},
      includeMetadata = true,
      boostRecent = true,
    } = options;

    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateQueryEmbedding(query);

      // Build the similarity search query
      let searchQuery = this.knex('embeddings')
        .select(
          'id',
          'source_table',
          'source_id',
          'source_field',
          'chunk_text',
          'metadata',
          this.knex.raw('1 - (embedding <=> ?::vector) as similarity', [
            `[${queryEmbedding.join(',')}]`,
          ])
        );

      // Apply filters
      if (filter.ngo_id) {
        searchQuery = searchQuery.where('metadata->ngo_id', filter.ngo_id);
      }
      if (filter.grant_id) {
        searchQuery = searchQuery.where('metadata->grant_id', filter.grant_id);
      }
      if (filter.application_id) {
        searchQuery = searchQuery.where('metadata->application_id', filter.application_id);
      }
      if (filter.language) {
        searchQuery = searchQuery.where('metadata->language', filter.language);
      }
      if (filter.source_tables?.length) {
        searchQuery = searchQuery.whereIn('source_table', filter.source_tables);
      }

      // Apply similarity threshold
      searchQuery = searchQuery.where(
        this.knex.raw('1 - (embedding <=> ?::vector)', [`[${queryEmbedding.join(',')}]`]),
        '>=',
        threshold
      );

      // Order by similarity (with optional recency boost)
      if (boostRecent) {
        searchQuery = searchQuery.orderByRaw(
          '(1 - (embedding <=> ?::vector)) * (1 + 1.0 / (1 + EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)) DESC',
          [`[${queryEmbedding.join(',')}]`]
        );
      } else {
        searchQuery = searchQuery.orderByRaw('embedding <=> ?::vector', [
          `[${queryEmbedding.join(',')}]`,
        ]);
      }

      searchQuery = searchQuery.limit(limit);

      const results = await searchQuery;

      const context: RAGContext = {
        chunks: results.map((row) => ({
          id: row.id,
          source_table: row.source_table,
          source_id: row.source_id,
          source_field: row.source_field,
          chunk_text: row.chunk_text,
          similarity: row.similarity,
          metadata: includeMetadata ? row.metadata : {},
        })),
        query,
        timestamp: new Date(),
      };

      // Cache the context if Redis is available
      if (this.redis) {
        await this.cacheContext(context);
      }

      return context;
    } catch (error) {
      logger.error(error, 'Error searching similar content:');
      throw error;
    }
  }

  /**
   * Get context for a specific chat
   */
  async getChatContext(
    chatId: string,
    _options: RAGSearchOptions = {}
  ): Promise<RAGContext | null> {
    try {
      // First check Redis cache
      if (this.redis) {
        const cached = await this.redis.get(`rag:chat:${chatId}`);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      // Check database cache
      const dbCache = await this.knex('rag_context_cache')
        .where('chat_id', chatId)
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'desc')
        .first();

      if (dbCache) {
        const context = {
          chunks: dbCache.retrieved_chunks,
          query: dbCache.context_key,
          timestamp: dbCache.created_at,
        };

        // Re-cache in Redis
        if (this.redis) {
          await this.redis.setex(
            `rag:chat:${chatId}`,
            300, // 5 minutes
            JSON.stringify(context)
          );
        }

        return context;
      }

      return null;
    } catch (error) {
      logger.error(error, 'Error getting chat context:');
      return null;
    }
  }

  /**
   * Build context for a new chat or query
   */
  async buildContext(
    query: string,
    chatId?: string,
    options: RAGSearchOptions = {}
  ): Promise<RAGContext> {
    // Get the current chat's metadata if available
    if (chatId) {
      const chat = await this.knex('chats')
        .where('id', chatId)
        .first();

      if (chat) {
        // Auto-apply filters based on chat context
        if (chat.ngo_id && !options.filter?.ngo_id) {
          options.filter = { ...options.filter, ngo_id: chat.ngo_id };
        }
        if (chat.grant_id && !options.filter?.grant_id) {
          options.filter = { ...options.filter, grant_id: chat.grant_id };
        }
        if (chat.application_id && !options.filter?.application_id) {
          options.filter = { ...options.filter, application_id: chat.application_id };
        }
      }
    }

    // Search for similar content
    const context = await this.searchSimilar(query, options);

    // Store in cache if chat ID provided
    if (chatId) {
      await this.storeChatContext(chatId, context);
    }

    return context;
  }

  /**
   * Generate embedding for a query
   */
  private async generateQueryEmbedding(query: string): Promise<number[]> {
    try {
      return await embeddingProvider.generateEmbedding(query);
    } catch (error) {
      logger.error(error, 'Error generating query embedding');
      throw new Error(`Failed to generate query embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Cache context in Redis and database
   */
  private async cacheContext(context: RAGContext): Promise<void> {
    const contextKey = `rag:context:${nanoid()}`;
    const ttl = 3600; // 1 hour

    if (this.redis) {
      await this.redis.setex(contextKey, ttl, JSON.stringify(context));
    }
  }

  /**
   * Store context for a specific chat
   */
  private async storeChatContext(
    chatId: string,
    context: RAGContext
  ): Promise<void> {
    const contextKey = `chat:${chatId}:${context.query}`;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    // Store in database
    await this.knex('rag_context_cache')
      .insert({
        chat_id: chatId,
        context_key: contextKey,
        retrieved_chunks: JSON.stringify(context.chunks),
        query_embedding: `[${(await this.generateQueryEmbedding(context.query)).join(',')}]`,
        expires_at: expiresAt,
        created_at: new Date(),
      })
      .onConflict(['chat_id', 'context_key'])
      .merge({
        retrieved_chunks: JSON.stringify(context.chunks),
        expires_at: expiresAt,
        created_at: new Date(),
      });

    // Also cache in Redis for fast access
    if (this.redis) {
      await this.redis.setex(
        `rag:chat:${chatId}`,
        3600,
        JSON.stringify(context)
      );
    }
  }

  /**
   * Get enriched context with full source documents
   */
  async getEnrichedContext(
    context: RAGContext
  ): Promise<RAGContext & { sources: any[] }> {
    const sources: any[] = [];
    const sourceMap = new Map<string, Set<string>>();

    // Group chunks by source
    for (const chunk of context.chunks) {
      if (!sourceMap.has(chunk.source_table)) {
        sourceMap.set(chunk.source_table, new Set());
      }
      sourceMap.get(chunk.source_table)!.add(chunk.source_id);
    }

    // Fetch full source documents
    for (const [table, ids] of sourceMap.entries()) {
      const items = await this.knex(table)
        .whereIn('id', Array.from(ids))
        .select('*');

      sources.push(
        ...items.map((item) => ({
          ...item,
          _source_table: table,
        }))
      );
    }

    return {
      ...context,
      sources,
    };
  }

  /**
   * Clean up expired context caches
   */
  async cleanupExpiredCaches(): Promise<void> {
    try {
      const deleted = await this.knex('rag_context_cache')
        .where('expires_at', '<', new Date())
        .delete();

      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} expired RAG context caches`);
      }
    } catch (error) {
      logger.error(error, 'Error cleaning up expired caches');
    }
  }
}

// Export singleton instance
export const ragService = new RAGService();
