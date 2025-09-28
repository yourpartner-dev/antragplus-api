import { useLogger } from '../../../helpers/logger/index.js';
import { ItemsService } from '../../items.js';
import getDatabase from '../../../database/index.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';

const logger = useLogger();

export interface GetSuggestionsOptions {
  documentId?: string;
  resolved?: boolean;
  type?: string;
  createdBy?: string;
}

export interface ApplySuggestionResult {
  suggestion: any;
  document: any;
  applied: boolean;
}

export class SuggestionService extends ItemsService {
  override accountability: Accountability | null;
  override schema: SchemaOverview;

  constructor(options: { accountability: Accountability | null; schema: SchemaOverview }) {
    super('document_suggestions', options);
    this.accountability = options.accountability;
    this.schema = options.schema;
  }

  /**
   * Get a specific suggestion
   */
  async getSuggestion(suggestionId: string) {
    const knex = getDatabase();

    try {
      const suggestion = await knex('document_suggestions')
        .where('id', suggestionId)
        .first();

      return suggestion;
    } catch (error) {
      logger.error(error, 'Error getting suggestion');
      throw error;
    }
  }

  /**
   * Get suggestions with filters
   */
  async getSuggestions(options: GetSuggestionsOptions) {
    const { documentId, resolved, type, createdBy } = options;
    const knex = getDatabase();

    try {
      let query = knex('document_suggestions')
        .orderBy('created_at', 'desc');

      if (documentId) {
        query = query.where('document_id', documentId);
      }
      if (resolved !== undefined) {
        query = query.where('is_resolved', resolved);
      }
      if (type) {
        query = query.where('suggestion_type', type);
      }
      if (createdBy) {
        query = query.where('created_by', createdBy);
      }

      const suggestions = await query;
      return suggestions;
    } catch (error) {
      logger.error(error, 'Error getting suggestions');
      throw error;
    }
  }

  /**
   * Resolve a suggestion (accept, reject, or modify)
   */
  async resolveSuggestion(
    suggestionId: string,
    resolution: 'accepted' | 'rejected' | 'modified',
    userId: string
  ) {
    const knex = getDatabase();

    try {
      const updated = await knex('document_suggestions')
        .where('id', suggestionId)
        .update({
          is_resolved: true,
          resolution_type: resolution,
          resolved_by: userId,
          resolved_at: new Date(),
        })
        .returning('*');

      return updated[0];
    } catch (error) {
      logger.error(error, 'Error resolving suggestion');
      throw error;
    }
  }

  /**
   * Apply a suggestion to the document
   */
  async applySuggestion(
    suggestionId: string,
    userId: string,
    modifiedText?: string
  ): Promise<ApplySuggestionResult | null> {
    const knex = getDatabase();

    try {
      // Get the suggestion
      const suggestion = await knex('document_suggestions')
        .where('id', suggestionId)
        .where('is_resolved', false)
        .first();

      if (!suggestion) {
        return null;
      }

      // Get the document
      const document = await knex('documents')
        .where('id', suggestion.document_id)
        .where('created_at', suggestion.document_created_at)
        .first();

      if (!document) {
        logger.error('Document not found for suggestion');
        return null;
      }

      // Apply the suggestion to the document content
      const textToReplace = suggestion.original_text;
      const replacementText = modifiedText || suggestion.suggested_text;

      if (!document.content.includes(textToReplace)) {
        logger.warn('Original text not found in document, suggestion may be outdated');
        return {
          suggestion,
          document,
          applied: false,
        };
      }

      const newContent = document.content.replace(textToReplace, replacementText);

      // Update the document using ItemsService
      const documentService = new ItemsService('application_content', {
        accountability: this.accountability,
        schema: this.schema,
      });

      const updatedDocument = await documentService.updateOne(
        document.id,
        { content: newContent }
      );

      // Mark suggestion as resolved
      await this.resolveSuggestion(
        suggestionId,
        modifiedText ? 'modified' : 'accepted',
        userId
      );

      return {
        suggestion: { ...suggestion, is_resolved: true, resolution_type: modifiedText ? 'modified' : 'accepted' },
        document: updatedDocument,
        applied: true,
      };
    } catch (error) {
      logger.error(error, 'Error applying suggestion');
      throw error;
    }
  }

  /**
   * Bulk resolve suggestions
   */
  async bulkResolveSuggestions(
    suggestionIds: string[],
    resolution: 'accepted' | 'rejected',
    userId: string
  ) {
    const knex = getDatabase();

    try {
      const updated = await knex('document_suggestions')
        .whereIn('id', suggestionIds)
        .update({
          is_resolved: true,
          resolution_type: resolution,
          resolved_by: userId,
          resolved_at: new Date(),
        })
        .returning('*');

      return {
        updated: updated.length,
        suggestions: updated,
      };
    } catch (error) {
      logger.error(error, 'Error bulk resolving suggestions');
      throw error;
    }
  }

  /**
   * Get suggestion statistics for a document
   */
  async getDocumentSuggestionStats(documentId: string) {
    const knex = getDatabase();

    try {
      const stats = await knex('document_suggestions')
        .where('document_id', documentId)
        .select(
          knex.raw('COUNT(*) as total'),
          knex.raw('COUNT(CASE WHEN is_resolved = false THEN 1 END) as pending'),
          knex.raw('COUNT(CASE WHEN resolution_type = \'accepted\' THEN 1 END) as accepted'),
          knex.raw('COUNT(CASE WHEN resolution_type = \'rejected\' THEN 1 END) as rejected'),
          knex.raw('COUNT(CASE WHEN resolution_type = \'modified\' THEN 1 END) as modified')
        )
        .first();

      const byType = await knex('document_suggestions')
        .where('document_id', documentId)
        .groupBy('suggestion_type')
        .select('suggestion_type', knex.raw('COUNT(*) as count'));

      return {
        total: parseInt(stats?.total || '0'),
        pending: parseInt(stats?.pending || '0'),
        accepted: parseInt(stats?.accepted || '0'),
        rejected: parseInt(stats?.rejected || '0'),
        modified: parseInt(stats?.modified || '0'),
        byType: byType.reduce((acc: any, item: any) => {
          acc[item.suggestion_type] = parseInt(item.count);
          return acc;
        }, {}),
      };
    } catch (error) {
      logger.error(error, 'Error getting suggestion stats');
      throw error;
    }
  }
}
