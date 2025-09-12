import { useLogger } from '../../../helpers/logger/index.js';
import { ItemsService } from '../../items.js';
import getDatabase from '../../../database/index.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';
import { parse } from 'json2csv';

const logger = useLogger();

export interface ActivityFilters {
  limit?: number;
  offset?: number;
  activity_type?: string;
  start_date?: Date;
  end_date?: Date;
  entity_type?: string;
  entity_id?: string;
}

export interface ExportOptions {
  format: 'json' | 'csv';
  startDate?: Date;
  endDate?: Date;
  activityType?: string;
  includeMetadata?: boolean;
}

export class HistoryService extends ItemsService {
  override accountability: Accountability | null;
  override schema: SchemaOverview;

  constructor(options: { accountability: Accountability | null; schema: SchemaOverview }) {
    super('ai_activity_logs', options);
    this.accountability = options.accountability;
    this.schema = options.schema;
  }

  /**
   * Get user activity history with filters
   */
  async getUserHistory(userId: string, filters: ActivityFilters = {}) {
    const knex = getDatabase();
    
    try {
      const {
        limit = 50,
        offset = 0,
        activity_type,
        start_date,
        end_date,
        entity_type,
        entity_id
      } = filters;

      let query = knex('ai_activity_logs')
        .where('user_id', userId)
        .orderBy('created_at', 'desc');

      // Apply filters
      if (activity_type) {
        query = query.where('activity_type', activity_type);
      }
      
      if (entity_type) {
        query = query.where('entity_type', entity_type);
      }
      
      if (entity_id) {
        query = query.where('entity_id', entity_id);
      }
      
      if (start_date) {
        query = query.where('created_at', '>=', start_date);
      }
      
      if (end_date) {
        query = query.where('created_at', '<=', end_date);
      }

      // Apply pagination
      const activities = await query
        .limit(limit)
        .offset(offset);

      // Get total count for pagination
      const countQuery = knex('ai_activity_logs').where('user_id', userId);
      
      if (activity_type) countQuery.where('activity_type', activity_type);
      if (entity_type) countQuery.where('entity_type', entity_type);
      if (entity_id) countQuery.where('entity_id', entity_id);
      if (start_date) countQuery.where('created_at', '>=', start_date);
      if (end_date) countQuery.where('created_at', '<=', end_date);
      
      const countResult = await countQuery.count('* as count');
      const count = countResult[0]?.['count'] || 0;

      return {
        data: activities,
        meta: {
          total: parseInt(count as string),
          limit,
          offset,
          has_more: offset + limit < parseInt(count as string)
        }
      };
    } catch (error) {
      logger.error(error, 'Error fetching user history');
      throw error;
    }
  }

  /**
   * Export user history in specified format
   */
  async exportUserHistory(userId: string, options: ExportOptions) {
    try {
      // Get data with extended limit for export
      const filters: ActivityFilters = {
        limit: 10000,
        offset: 0,
        ...(options.startDate && { start_date: options.startDate }),
        ...(options.endDate && { end_date: options.endDate }),
        ...(options.activityType && { activity_type: options.activityType })
      };

      const result = await this.getUserHistory(userId, filters);
      const data = result.data;

      // Format based on requested type
      if (options.format === 'csv') {
        if (!data || data.length === 0) {
          return 'No data to export';
        }

        // Prepare data for CSV export
        const csvData = data.map(item => ({
          Date: item.created_at,
          Activity: item.activity_type,
          Entity: item.entity_type,
          EntityID: item.entity_id,
          Description: item.description,
          IPAddress: item.ip_address,
          ...(options.includeMetadata ? { Metadata: JSON.stringify(item.metadata) } : {})
        }));

        // Convert to CSV
        const csv = parse(csvData);
        return csv;
      } else {
        // Return JSON format
        return {
          export_date: new Date(),
          user_id: userId,
          period: {
            start: options.startDate,
            end: options.endDate
          },
          total_activities: data.length,
          activities: data
        };
      }
    } catch (error) {
      logger.error(error, 'Error exporting user history');
      throw error;
    }
  }

  /**
   * Get activity summary statistics
   */
  async getActivitySummary(userId: string, period: string = 'week') {
    const knex = getDatabase();
    
    try {
      // Calculate date range based on period
      const now = new Date();
      const startDate = new Date();
      
      switch(period) {
        case 'day':
          startDate.setDate(now.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(now.getMonth() - 1);
          break;
        case 'year':
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          startDate.setDate(now.getDate() - 7);
      }

      // Get activity counts by type
      const activityCounts = await knex('ai_activity_logs')
        .where('user_id', userId)
        .where('created_at', '>=', startDate)
        .select('activity_type')
        .count('* as count')
        .groupBy('activity_type')
        .orderBy('count', 'desc');

      // Get entity counts
      const entityCounts = await knex('ai_activity_logs')
        .where('user_id', userId)
        .where('created_at', '>=', startDate)
        .whereNotNull('entity_type')
        .select('entity_type')
        .count('* as count')
        .groupBy('entity_type')
        .orderBy('count', 'desc');

      // Get daily activity trend
      const dailyTrend = await knex('ai_activity_logs')
        .where('user_id', userId)
        .where('created_at', '>=', startDate)
        .select(knex.raw('DATE(created_at) as date'))
        .count('* as count')
        .groupBy(knex.raw('DATE(created_at)'))
        .orderBy('date', 'asc');

      // Get most active hours
      const hourlyDistribution = await knex('ai_activity_logs')
        .where('user_id', userId)
        .where('created_at', '>=', startDate)
        .select(knex.raw('EXTRACT(HOUR FROM created_at) as hour'))
        .count('* as count')
        .groupBy(knex.raw('EXTRACT(HOUR FROM created_at)'))
        .orderBy('hour', 'asc');

      // Calculate total activities
      const totalResult = await knex('ai_activity_logs')
        .where('user_id', userId)
        .where('created_at', '>=', startDate)
        .count('* as total');
      const total = totalResult[0]?.['total'] || 0;

      return {
        period,
        start_date: startDate,
        end_date: now,
        total_activities: parseInt(total as string),
        activities_by_type: activityCounts,
        activities_by_entity: entityCounts,
        daily_trend: dailyTrend,
        hourly_distribution: hourlyDistribution,
        average_per_day: Math.round(parseInt(total as string) / ((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)))
      };
    } catch (error) {
      logger.error(error, 'Error getting activity summary');
      throw error;
    }
  }

  /**
   * Get recent activities for quick display
   */
  async getRecentActivities(userId: string, limit: number = 10) {
    const knex = getDatabase();
    
    try {
      const activities = await knex('ai_activity_logs')
        .where('user_id', userId)
        .select(
          'id',
          'activity_type',
          'entity_type',
          'entity_id',
          'description',
          'created_at',
          knex.raw(`
            CASE 
              WHEN created_at > NOW() - INTERVAL '1 hour' THEN 'recent'
              WHEN created_at > NOW() - INTERVAL '24 hours' THEN 'today'
              WHEN created_at > NOW() - INTERVAL '7 days' THEN 'this_week'
              ELSE 'older'
            END as time_category
          `)
        )
        .orderBy('created_at', 'desc')
        .limit(limit);

      // Enrich with entity names if possible
      const enrichedActivities = await Promise.all(
        activities.map(async (activity) => {
          if (activity.entity_type && activity.entity_id) {
            try {
              // Fetch entity name based on type
              const entityName = await this.getEntityName(
                activity.entity_type,
                activity.entity_id
              );
              return {
                ...activity,
                entity_name: entityName
              };
            } catch (error) {
              // If entity not found, return activity as is
              return activity;
            }
          }
          return activity;
        })
      );

      return enrichedActivities;
    } catch (error) {
      logger.error(error, 'Error fetching recent activities');
      throw error;
    }
  }

  /**
   * Helper to get entity name for display
   */
  private async getEntityName(entityType: string, entityId: string): Promise<string | null> {
    const knex = getDatabase();
    
    try {
      let nameField = 'name'; // default field name
      let table = entityType;

      // Map entity types to correct table names and name fields
      const entityMap: Record<string, { table: string; field: string }> = {
        'chat': { table: 'chats', field: 'title' },
        'document': { table: 'documents', field: 'title' },
        'ngo': { table: 'ngos', field: 'name' },
        'grant': { table: 'grants', field: 'name' },
        'application': { table: 'applications', field: 'id' }, // Applications might not have names
      };

      if (entityMap[entityType]) {
        table = entityMap[entityType].table;
        nameField = entityMap[entityType].field;
      }

      const entity = await knex(table)
        .where('id', entityId)
        .select(nameField)
        .first();

      return entity ? entity[nameField] : null;
    } catch (error) {
      // Entity might not exist or table might not have the field
      return null;
    }
  }

  /**
   * Log an activity (helper method for other services)
   */
  async logActivity(
    userId: string,
    activityType: string,
    entityType?: string,
    entityId?: string,
    description?: string,
    metadata?: any
  ) {
    const knex = getDatabase();
    
    try {
      await knex('ai_activity_logs').insert({
        user_id: userId,
        activity_type: activityType,
        entity_type: entityType,
        entity_id: entityId,
        description: description,
        metadata: metadata || {},
        ip_address: this.accountability?.ip || null,
        user_agent: this.accountability?.userAgent || null,
        created_at: new Date()
      });
    } catch (error) {
      // Don't throw - logging should not break operations
      logger.error(error, 'Failed to log activity');
    }
  }
}