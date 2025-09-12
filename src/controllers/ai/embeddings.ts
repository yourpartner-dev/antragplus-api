import { Router } from 'express';
import { useLogger } from '../../helpers/logger/index.js';
import asyncHandler from '../../helpers/utils/async-handler.js';
import { ragService } from '../../services/rag-service.js';
import getDatabase from '../../database/index.js';
import type { Request, Response } from 'express';
import {
  searchSchema,
  buildContextSchema,
  batchQueueEmbeddingSchema,
} from './schemas/embeddings.schema.js';

const logger = useLogger();
const router = Router();

/**
 * Search for similar content using RAG
 */
router.post(
  '/search',
  asyncHandler(async (req: Request, res: Response) => {
    // Validate request body
    const { error, value } = searchSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        errors: error.details.map((detail) => ({
          message: detail.message,
          field: detail.path.join('.'),
        })),
      });
    }

    const { query, options } = value;

    try {
      const context = await ragService.searchSimilar(query, options);

      return res.json({
        data: context,
      });
    } catch (error) {
      logger.error(error, 'Error searching embeddings:');
      return res.status(500).json({
        errors: [{ message: 'Failed to search embeddings' }],
      });
    }
  })
);

/**
 * Get context for a specific chat
 */
router.get(
  '/context/chat/:chatId',
  asyncHandler(async (req: Request, res: Response) => {
    const { chatId } = req.params;

    if (!chatId) {
      return res.status(400).json({
        errors: [{ message: 'Chat ID is required' }],
      });
    }

    try {
      const context = await ragService.getChatContext(chatId);

      if (!context) {
        return res.status(404).json({
          errors: [{ message: 'No context found for this chat' }],
        });
      }

      return res.json({
        data: context,
      });
    } catch (error) {
      logger.error(error, 'Error getting chat context');
      return res.status(500).json({
        errors: [{ message: 'Failed to get chat context' }],
      });
    }
  })
);

/**
 * Build context for a query with optional chat association
 */
router.post(
  '/context/build',
  asyncHandler(async (req: Request, res: Response) => {
    // Validate request body
    const { error, value } = buildContextSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        errors: error.details.map((detail) => ({
          message: detail.message,
          field: detail.path.join('.'),
        })),
      });
    }

    const { query, chatId, options } = value;

    try {
      const context = await ragService.buildContext(query, chatId, options);

      return res.json({
        data: context,
      });
    } catch (error) {
      logger.error(error, 'Error building context');
      return res.status(500).json({
        errors: [{ message: 'Failed to build context' }],
      });
    }
  })
);

/**
 * Queue embedding generation/update for specific items
 */
router.post(
  '/queue',
  asyncHandler(async (req: Request, res: Response) => {
    // Validate request body
    const { error, value } = batchQueueEmbeddingSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        errors: error.details.map((detail) => ({
          message: detail.message,
          field: detail.path.join('.'),
        })),
      });
    }

    const { items } = value;

    try {
      const knex = getDatabase();
      const queued = [];

      for (const item of items) {

        await knex('embedding_queue')
          .insert({
            source_table: item.source_table,
            source_id: item.source_id,
            operation: item.operation || 'update',
            priority: item.priority || 5,
            status: 'pending',
            created_at: new Date(),
          })
          .onConflict(['source_table', 'source_id', 'operation'])
          .merge({
            priority: knex.raw('LEAST(priority, ?)', [item.priority || 5]),
            status: 'pending',
            retry_count: 0,
            created_at: new Date(),
          });

        queued.push({
          source_table: item.source_table,
          source_id: item.source_id,
        });
      }

      return res.json({
        data: {
          queued: queued.length,
          items: queued,
        },
      });
    } catch (error) {
      logger.error(error, 'Error queuing embeddings');
      return res.status(500).json({
        errors: [{ message: 'Failed to queue embeddings' }],
      });
    }
  })
);

/**
 * Get embedding statistics
 */
router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const knex = getDatabase();

      // Get embedding counts by source table
      const embeddingCounts = await knex('embeddings')
        .select('source_table')
        .count('id as count')
        .groupBy('source_table');

      // Get queue statistics
      const queueStats = await knex('embedding_queue')
        .select('status')
        .count('id as count')
        .groupBy('status');

      // Get total unique sources
      const uniqueSources = await knex('embeddings')
        .countDistinct('source_id as count')
        .first();

      // Get recent activity
      const recentActivity = await knex('embeddings')
        .select(knex.raw('DATE(created_at) as date'))
        .count('id as count')
        .where('created_at', '>', knex.raw("CURRENT_DATE - INTERVAL '7 days'"))
        .groupBy(knex.raw('DATE(created_at)'))
        .orderBy('date', 'desc');

      return res.json({
        data: {
          embeddings: {
            by_table: embeddingCounts,
            total_sources: uniqueSources?.['count'] || 0,
          },
          queue: {
            by_status: queueStats,
          },
          recent_activity: recentActivity,
        },
      });
    } catch (error) {
      logger.error(error, 'Error getting embedding stats');
      return res.status(500).json({
        errors: [{ message: 'Failed to get embedding statistics' }],
      });
    }
  })
);

/**
 * Health check for embedding system
 */
router.get(
  '/health',
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const knex = getDatabase();

      // Check if embeddings table exists and is accessible
      const embeddingCount = await knex('embeddings').count('id as count').first();

      // Check if queue is processing
      const pendingJobs = await knex('embedding_queue')
        .where('status', 'pending')
        .count('id as count')
        .first();

      // Check if vector extension is installed
      const vectorExtension = await knex.raw(
        "SELECT * FROM pg_extension WHERE extname = 'vector'"
      );

      const isHealthy =
        embeddingCount &&
        vectorExtension.rows.length > 0 &&
        Number(pendingJobs?.['count'] || 0) < 1000; // Arbitrary threshold

      return res.json({
        data: {
          status: isHealthy ? 'healthy' : 'degraded',
          embeddings: {
            count: embeddingCount?.['count'] || 0,
          },
          queue: {
            pending: pendingJobs?.['count'] || 0,
          },
          vector_extension: vectorExtension.rows.length > 0,
        },
      });
    } catch (error) {
      logger.error(error, 'Error checking embedding health:');
      return res.status(500).json({
        errors: [{ message: 'Failed to check embedding health' }],
      });
    }
  })
);

export default router;
