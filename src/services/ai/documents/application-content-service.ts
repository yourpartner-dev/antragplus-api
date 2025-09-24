
import { generateText } from 'ai';
import { getOpenAIModel } from '../providers.js';
import { useLogger } from '../../../helpers/logger/index.js';
import { ItemsService } from '../../items.js';
import getDatabase from '../../../database/index.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';

const logger = useLogger();

export interface CreateDocumentOptions {
  title: string;
  content: string;
  kind?: string;
  ngo_id?: string;
  application_id?: string;
  created_by: string;
}

export interface GetDocumentsOptions {
  userId: string;
  ngo_id?: string;
  application_id?: string;
  kind?: string;
}

export class DocumentService extends ItemsService {
  override accountability: Accountability | null;
  override schema: SchemaOverview;

  constructor(options: { accountability: Accountability | null; schema: SchemaOverview }) {
    super('application_content', options);
    this.accountability = options.accountability;
    this.schema = options.schema;
  }

  /**
   * Create a new document
   */
  async createDocument(options: CreateDocumentOptions) {
    const { title, content, kind = 'text', ngo_id, application_id, created_by } = options;
    const knex = getDatabase();

    try {
      const now = new Date();

      const document:any = await knex('application_content').insert({
        title,
        content,
        content_format: 'markdown', // Default to markdown
        kind,
        ngo_id,
        application_id,
        created_by,
        created_at: now,
        updated_at: now,
        updated_by: created_by,
        metadata: {},
      }).returning('id');

      // Queue embedding generation for this document
      if (content && document?.id) {
        await knex('embedding_queue').insert({
          source_table: 'application_content',
          source_id: document.id,
          operation: 'insert',
          priority: 5,
          status: 'pending',
          created_at: new Date(),
        }).onConflict(['source_table', 'source_id', 'operation']).ignore();
      }

      // Note: application_attachments are handled separately for uploaded files

      // Log activity to ai_activity_logs
      if (created_by && document?.id) {
        try {
          await knex('ai_activity_logs').insert({
            user_id: created_by,
            activity_type: 'application_content_created',
            entity_type: 'application_content',
            entity_id: document.id,
            description: `Created document: ${title}`,
            metadata: {
              kind,
              ngo_id,
              application_id,
              content_length: content?.length || 0,
            },
            ip_address: this.accountability?.ip || null,
            user_agent: this.accountability?.userAgent || null,
            created_at: new Date()
          });
        } catch (logError) {
          // Don't throw - logging should not break operations
          logger.error(logError, 'Failed to log document creation activity');
        }
      }

      return document[0];
    } catch (error) {
      logger.error(error, 'Error creating document:');
      throw error;
    }
  }

  /**
   * Get documents for a user with optional filters
   */
  async getUserDocuments(options: GetDocumentsOptions) {
    const { userId, ngo_id, application_id, kind } = options;
    const knex = getDatabase();

    try {
      let query = knex('application_content')
        .where('created_by', userId)
        .orderBy('updated_at', 'desc');

      if (ngo_id) {
        query = query.where('ngo_id', ngo_id);
      }
      if (application_id) {
        query = query.where('application_id', application_id);
      }
      if (kind) {
        query = query.where('kind', kind);
      }

      const documents = await query;
      return documents;
    } catch (error) {
      logger.error(error, 'Error fetching documents');
      throw error;
    }
  }

  /**
   * Get a specific document
   */
  async getDocument(documentId: string, userId: string) {
    const knex = getDatabase();

    try {
      const document = await knex('application_content')
        .where('id', documentId)
        .where('created_by', userId)
        .first();

      if (!document) {
        return null;
      }

      // Get versions count
      const versionCount = await knex('application_content_versions')
        .where('application_content_id', documentId)
        .count('id as count')
        .first();

      // Get suggestions count
      const suggestionCount = await knex('application_content_suggestions')
        .where('application_content_id', documentId)
        .where('created_at', document.created_at)
        .where('is_resolved', false)
        .count('id as count')
        .first();

      return {
        ...document,
        version_count: parseInt(versionCount?.['count'] as string || '0'),
        pending_suggestions: parseInt(suggestionCount?.['count'] as string || '0'),
      };
    } catch (error) {
      logger.error(error, 'Error fetching document');
      throw error;
    }
  }

  /**
   * Update document content and create version
   */
  async updateDocument(
    documentId: string,
    updates: { title?: string; content?: string; metadata?: any },
    userId: string
  ) {
    const knex = getDatabase();

    try {
      // Get current document
      const currentDoc = await knex('application_content')
        .where('id', documentId)
        .where('created_by', userId)
        .first();

      if (!currentDoc) {
        return null;
      }

      // Create version if content changed
      if (updates.content && updates.content !== currentDoc.content) {
        // Get latest version number
        const latestVersion = await knex('application_content_versions')
          .where('application_content_id', documentId)
          .orderBy('version_number', 'desc')
          .first();

        const versionNumber = (latestVersion?.version_number || 0) + 1;

        // Create version
        await knex('application_content_versions').insert({
          application_content_id: documentId,
          version_number: versionNumber,
          content: currentDoc.content, // Save the OLD content
          changes: {
            from: currentDoc.content?.substring(0, 100) + '...',
            to: updates.content?.substring(0, 100) + '...',
            changed_by: userId,
          },
          metadata: {},
          created_at: new Date(),
          created_by: userId,
        });
      }

      // Update document
      const updated = await knex('application_content')
        .where('id', documentId)
        .where('created_by', userId)
        .update({
          ...updates,
          updated_at: new Date(),
          updated_by: userId,
        })
        .returning('*');

      // Queue embedding update if content changed
      if (updates.content) {
        await knex('embedding_queue').insert({
          source_table: 'application_content',
          source_id: documentId,
          operation: 'update',
          priority: 5,
          status: 'pending',
          created_at: new Date(),
        }).onConflict(['source_table', 'source_id', 'operation']).merge({
          priority: knex.raw('LEAST(priority, ?)', [5]),
          status: 'pending',
          created_at: new Date(),
        });
      }

      // Log activity to ai_activity_logs
      if (userId && updated[0]) {
        try {
          await knex('ai_activity_logs').insert({
            user_id: userId,
            activity_type: 'application_content_updated',
            entity_type: 'application_content',
            entity_id: documentId,
            description: `Updated document: ${updates.title || currentDoc.title}`,
            metadata: {
              fields_updated: Object.keys(updates),
              content_changed: !!updates.content,
              new_content_length: updates.content?.length || 0,
            },
            ip_address: this.accountability?.ip || null,
            user_agent: this.accountability?.userAgent || null,
            created_at: new Date()
          });
        } catch (logError) {
          // Don't throw - logging should not break operations
          logger.error(logError, 'Failed to log document update activity');
        }
      }

      return updated[0];
    } catch (error) {
      logger.error(error, 'Error updating document');
      throw error;
    }
  }

  /**
   * Delete a document
   */
  async deleteDocument(documentId: string, userId: string) {
    const knex = getDatabase();

    try {
      // Verify ownership
      const document = await knex('application_content')
        .where('id', documentId)
        .where('created_by', userId)
        .first();

      if (!document) {
        throw new Error('Document not found');
      }

      // Delete document (cascade will handle related records)
      await knex('application_content')
        .where('id', documentId)
        .where('created_at', document.created_at)
        .delete();

      // Log activity to ai_activity_logs
      if (userId) {
        try {
          await knex('ai_activity_logs').insert({
            user_id: userId,
            activity_type: 'application_content_deleted',
            entity_type: 'application_content',
            entity_id: documentId,
            description: `Deleted document: ${document.title}`,
            metadata: {
              document_title: document.title,
              document_kind: document.kind,
              ngo_id: document.ngo_id,
              application_id: document.application_id,
            },
            ip_address: this.accountability?.ip || null,
            user_agent: this.accountability?.userAgent || null,
            created_at: new Date()
          });
        } catch (logError) {
          // Don't throw - logging should not break operations
          logger.error(logError, 'Failed to log document deletion activity');
        }
      }

      return true;
    } catch (error) {
      logger.error(error, 'Error deleting document');
      throw error;
    }
  }

  /**
   * Create a document version
   */
  async createDocumentVersion(
    documentId: string,
    versionData: { content: string; changes?: any },
    userId: string
  ) {
    const knex = getDatabase();

    try {
      // Verify ownership
      const document = await knex('application_content')
        .where('id', documentId)
        .where('created_by', userId)
        .first();

      if (!document) {
        throw new Error('Document not found');
      }

      // Get latest version number
      const latestVersion = await knex('application_content_versions')
        .where('application_content_id', documentId)
        .orderBy('version_number', 'desc')
        .first();

      const versionNumber = (latestVersion?.version_number || 0) + 1;

      const version = await knex('application_content_versions').insert({
        application_content_id: documentId,
        version_number: versionNumber,
        content: versionData.content,
        changes: versionData.changes || {},
        metadata: {},
        created_at: new Date(),
        created_by: userId,
      }).returning('*');

      return version[0];
    } catch (error) {
      logger.error(error, 'Error creating document version');
      throw error;
    }
  }

  /**
   * Get document versions
   */
  async getDocumentVersions(documentId: string, userId: string) {
    const knex = getDatabase();

    try {
      // Verify ownership
      const document = await knex('application_content')
        .where('id', documentId)
        .where('created_by', userId)
        .first();

      if (!document) {
        throw new Error('Document not found');
      }

      const versions = await knex('application_content_versions')
        .where('application_content_id', documentId)
        .orderBy('version_number', 'desc');

      return versions;
    } catch (error) {
      logger.error(error, 'Error fetching document versions');
      throw error;
    }
  }

  /**
   * Generate AI suggestions for document improvement
   */
  async generateSuggestions(
    documentId: string,
    type: string,
    userId: string
  ) {
    const knex = getDatabase();

    try {
      // Get document
      const document = await knex('application_content')
        .where('id', documentId)
        .where('created_by', userId)
        .first();

      if (!document) {
        throw new Error('Document not found');
      }

      // Build context based on document type
      let context = '';
      if (document.application_id) {
        const application = await knex('applications')
          .where('id', document.application_id)
          .first();
        
        if (application) {
          const grant = await knex('grants')
            .where('id', application.grant_id)
            .first();
          
          if (grant) {
            context = `This document is part of a grant application for: ${grant.name}. 
            Grant requirements: ${grant.eligibility_criteria || 'Not specified'}`;
          }
        }
      }

      // Generate suggestions using AI
      const prompt = this.buildSuggestionPrompt(document.content, type, context);
      
      const result = await generateText({
        model: getOpenAIModel('gpt-4-turbo-preview'),
        messages: [
          {
            role: 'system',
            content: 'You are an expert grant application reviewer. Provide specific, actionable suggestions to improve the document.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
      });

      // Parse suggestions from response
      const suggestions = this.parseSuggestions(result.text, document);

      // Store suggestions in database
      const storedSuggestions = [];
      for (const suggestion of suggestions) {
        const stored = await knex('application_content_suggestions').insert({
          application_content_id: documentId,
          original_text: suggestion.original_text,
          suggested_text: suggestion.suggested_text,
          description: suggestion.description,
          suggestion_type: suggestion.type,
          confidence_score: suggestion.confidence || 0.8,
          is_resolved: false,
          created_by: userId,
          created_at: new Date(),
          metadata: {},
        }).returning('*');
        
        storedSuggestions.push(stored[0]);
      }

      // Log activity to ai_activity_logs
      if (userId) {
        try {
          await knex('ai_activity_logs').insert({
            user_id: userId,
            activity_type: 'suggestions_generated',
            entity_type: 'application_content',
            entity_id: documentId,
            description: `Generated ${storedSuggestions.length} AI suggestions for document`,
            metadata: {
              document_title: document.title,
              suggestion_type: type,
              suggestion_count: storedSuggestions.length,
              ngo_id: document.ngo_id,
              application_id: document.application_id,
            },
            ip_address: this.accountability?.ip || null,
            user_agent: this.accountability?.userAgent || null,
            created_at: new Date()
          });
        } catch (logError) {
          // Don't throw - logging should not break operations
          logger.error(logError, 'Failed to log suggestion generation activity');
        }
      }

      return storedSuggestions;
    } catch (error) {
      logger.error(error, 'Error generating suggestions');
      throw error;
    }
  }

  /**
   * Build prompt for suggestion generation
   */
  private buildSuggestionPrompt(content: string, type: string, context: string): string {
    let prompt = `Please analyze the following document and provide suggestions for improvement.\n\n`;
    
    if (context) {
      prompt += `Context: ${context}\n\n`;
    }

    prompt += `Document content:\n${content}\n\n`;

    switch (type) {
      case 'grammar':
        prompt += 'Focus on grammar, spelling, and punctuation corrections.';
        break;
      case 'style':
        prompt += 'Focus on writing style, clarity, and readability improvements.';
        break;
      case 'content':
        prompt += 'Focus on content completeness, accuracy, and relevance.';
        break;
      case 'structure':
        prompt += 'Focus on document structure, organization, and flow.';
        break;
      default:
        prompt += 'Provide comprehensive suggestions covering grammar, style, content, and structure.';
    }

    prompt += '\n\nFormat your response as a JSON array of suggestions, each with:\n';
    prompt += '- original_text: The text to be replaced\n';
    prompt += '- suggested_text: The improved text\n';
    prompt += '- description: Brief explanation of the change\n';
    prompt += '- type: One of "grammar", "style", "content", or "structure"\n';
    prompt += '- confidence: A score from 0 to 1\n';

    return prompt;
  }

  /**
   * Parse AI suggestions from response
   */
  private parseSuggestions(aiResponse: string, document: any): any[] {
    try {
      // Try to extract JSON from response
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]);
        return suggestions.filter((s: any) => 
          s.original_text && 
          s.suggested_text && 
          document.content.includes(s.original_text)
        );
      }

      // Fallback: create basic suggestions from response
      return [{
        original_text: document.content.substring(0, 100),
        suggested_text: document.content.substring(0, 100),
        description: aiResponse.substring(0, 200),
        type: 'content',
        confidence: 0.5,
      }];
    } catch (error) {
      logger.error(error, 'Error parsing suggestions');
      return [];
    }
  }

  /**
   * Get document suggestions
   */
  async getDocumentSuggestions(
    documentId: string,
    userId: string,
    filters: { resolved?: boolean }
  ) {
    const knex = getDatabase();

    try {
      // Verify ownership
      const document = await knex('application_content')
        .where('id', documentId)
        .where('created_by', userId)
        .first();

      if (!document) {
        throw new Error('Document not found');
      }

      let query = knex('application_content_suggestions')
        .where('application_content_id', documentId)
        .where('created_at', document.created_at)
        .orderBy('created_at', 'desc');

      if (filters.resolved !== undefined) {
        query = query.where('is_resolved', filters.resolved);
      }

      const suggestions = await query;
      return suggestions;
    } catch (error) {
      logger.error(error, 'Error fetching suggestions');
      throw error;
    }
  }
}
