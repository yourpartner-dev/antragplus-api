import express from 'express';
import asyncHandler from '../../helpers/utils/async-handler.js';
import { HistoryService } from '../../services/ai/history/history-service.js';
import { respond } from '../../middleware/respond.js';
import type { Request, Response } from 'express';
import {
  getUserHistorySchema,
} from './schemas/history.schema.js';
import { ForbiddenError } from '../../helpers/errors/index.js';
const router = express.Router();

/**
 * Get user activity history
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response, next) => {
    // Validate query parameters
    const { error, value } = getUserHistorySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        errors: error.details.map((detail) => ({
          message: detail.message,
          field: detail.path.join('.'),
        })),
      });
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    const service = new HistoryService({
      accountability,
      schema,
    });

    const history = await service.getUserHistory(accountability.user, value);

    res.locals['payload'] = { data: history };
    return next();
  }),
  respond
);

/**
 * Export user history as CSV or JSON
 */
router.get(
  '/export',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const accountability = req.accountability;
    const schema = req.schema;
    const { 
      format = 'json',
      start_date,
      end_date,
      activity_type
    } = req.query;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    if (!['json', 'csv'].includes(format as string)) {
     //TODO THIS MUYST BE UPDATED IN THE SCHEMA!!! 
    }

    const service = new HistoryService({
      accountability,
      schema,
    });

    const exportData = await service.exportUserHistory(accountability.user, {
      format: format as 'json' | 'csv',
      ...(start_date && { startDate: new Date(start_date as string) }),
      ...(end_date && { endDate: new Date(end_date as string) }),
      ...(activity_type && { activityType: activity_type as string }),
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="history.csv"');
      res.send(exportData);
    } else {
      res.json(exportData);
    }
  })
);

/**
 * Get activity summary/statistics
 */
router.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response, next) => {
    const accountability = req.accountability;
    const schema = req.schema;
    const { period = 'week' } = req.query; // day, week, month, year

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    const service = new HistoryService({
      accountability,
      schema,
    });

    const summary = await service.getActivitySummary(
      accountability.user,
      period as string
    );

    res.locals['payload'] = { data: summary };
    return next();
  }),
  respond
);

/**
 * Get recent activities (simplified view)
 */
router.get(
  '/recent',
  asyncHandler(async (req: Request, res: Response, next) => {
    const accountability = req.accountability;
    const schema = req.schema;
    const { limit = '10' } = req.query;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    const service = new HistoryService({
      accountability,
      schema,
    });

    const recent = await service.getRecentActivities(
      accountability.user,
      parseInt(limit as string)
    );

    res.locals['payload'] = { data: recent };
    return next();
  }),
  respond
);

export default router;
