import { z } from 'zod';
import { tool } from 'ai';
import { nanoid } from 'nanoid';
import getDatabase from '../../../database/index.js';
import { useLogger } from '../../../helpers/logger/index.js';

const logger = useLogger();

export function getDocumentTools(options: {
  userId: string | null;
}) {
  const { userId } = options;
  const db = getDatabase();

  return {
    createDocument: tool({
      description: 'Create a new document for a grant application. Can create any type of document - proposals, budgets, timelines, cover letters, etc.',
      parameters: z.object({
        title: z.string().describe('Title of the document'),
        content: z.string().describe('The document content'),
        application_id: z.string().optional().describe('Application ID this document belongs to'),
        ngo_id: z.string().optional().describe('NGO ID if not tied to specific application'),
        document_type: z.string().default('text').describe('Type of document (proposal, budget, timeline, cover_letter, etc.)'),
        content_format: z.string().default('markdown').describe('Format of the content (markdown, text, html)')
      }),
      execute: async ({ title, content, application_id, ngo_id, document_type, content_format }) => {
        if (!userId) {
          throw new Error('User must be authenticated to create documents');
        }

        try {
          const documentId = nanoid();

          const [document] = await db('application_content').insert({
            id: documentId,
            title,
            content,
            content_format,
            kind: document_type,
            application_id: application_id || null,
            ngo_id: ngo_id || null,
            created_by: userId,
            updated_by: userId,
            created_at: new Date(),
            updated_at: new Date(),
            metadata: JSON.stringify({
              ai_generated: true,
              source: 'ai_chat'
            })
          }).returning('*');

          logger.info(`Document created: ${documentId} (${title})`);

          return {
            success: true,
            document_id: documentId,
            title,
            message: `Document "${title}" created successfully`,
            document
          };

        } catch (error) {
          logger.error(error, 'Error creating document');
          return {
            success: false,
            message: 'Failed to create document',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      },
    }),

    updateDocument: tool({
      description: 'Update an existing document. This creates a new version while preserving the original.',
      parameters: z.object({
        document_id: z.string().describe('ID of the document to update'),
        content: z.string().describe('New content for the document'),
        title: z.string().optional().describe('New title (optional)'),
        change_description: z.string().optional().describe('Description of what changed')
      }),
      execute: async ({ document_id, content, title, change_description }) => {
        if (!userId) {
          throw new Error('User must be authenticated to update documents');
        }

        try {
          // Get current document
          const currentDoc = await db('application_content')
            .where('id', document_id)
            .first();

          if (!currentDoc) {
            return {
              success: false,
              message: 'Document not found'
            };
          }

          // Create version of current content
          await db('application_content_versions').insert({
            id: nanoid(),
            application_content_id: document_id,
            version_number: await getNextVersionNumber(document_id),
            content: currentDoc.content,
            changes: {
              description: change_description || 'Updated via AI chat',
              previous_title: currentDoc.title
            },
            created_at: new Date(),
            created_by: userId
          });

          // Update the document
          const updateData: any = {
            content,
            updated_at: new Date(),
            updated_by: userId
          };

          if (title) {
            updateData.title = title;
          }

          await db('application_content')
            .where('id', document_id)
            .update(updateData);

          logger.info(`Document updated: ${document_id}`);

          return {
            success: true,
            document_id,
            message: `Document updated successfully`,
            change_description
          };

        } catch (error) {
          logger.error(error, 'Error updating document');
          return {
            success: false,
            message: 'Failed to update document',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      },
    }),

    generateDocumentSuggestions: tool({
      description: 'Generate AI suggestions to improve a document (grammar, style, content, structure, compliance, etc.)',
      parameters: z.object({
        document_id: z.string().describe('ID of the document to analyze'),
        suggestion_types: z.array(z.enum(['grammar', 'style', 'content', 'structure', 'compliance', 'persuasiveness'])).describe('Types of suggestions to generate'),
        focus_areas: z.array(z.string()).optional().describe('Specific areas to focus on (e.g., "budget section", "methodology")')
      }),
      execute: async ({ document_id, suggestion_types, focus_areas }) => {
        if (!userId) {
          throw new Error('User must be authenticated to generate suggestions');
        }

        try {
          // Get the document
          const document = await db('application_content')
            .where('id', document_id)
            .first();

          if (!document) {
            return {
              success: false,
              message: 'Document not found'
            };
          }

          // For now, return a placeholder - in real implementation, this would use AI to analyze
          const suggestions = [
            {
              type: 'content',
              suggestion: 'Consider adding more specific metrics and quantifiable outcomes to strengthen your impact statement.',
              confidence: 0.85,
              section: 'Impact Statement'
            },
            {
              type: 'structure',
              suggestion: 'The methodology section could benefit from clearer step-by-step breakdown.',
              confidence: 0.78,
              section: 'Methodology'
            }
          ];

          // Store suggestions in database
          for (const suggestion of suggestions) {
            await db('application_content_suggestions').insert({
              id: nanoid(),
              application_content_id: document_id,
              original_text: '', // Would extract relevant section
              suggested_text: suggestion.suggestion,
              description: `${suggestion.type} improvement suggestion`,
              suggestion_type: suggestion.type,
              confidence_score: suggestion.confidence,
              created_by: userId,
              created_at: new Date(),
              metadata: {
                section: suggestion.section,
                focus_areas: focus_areas || [],
                ai_generated: true
              }
            });
          }

          logger.info(`Generated ${suggestions.length} suggestions for document ${document_id}`);

          return {
            success: true,
            document_id,
            suggestions_generated: suggestions.length,
            suggestions,
            message: `Generated ${suggestions.length} suggestions for improvement`
          };

        } catch (error) {
          logger.error(error, 'Error generating suggestions');
          return {
            success: false,
            message: 'Failed to generate suggestions',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      },
    }),

    getDocumentContext: tool({
      description: 'Retrieve context about a document, application, or NGO to help with document creation/editing',
      parameters: z.object({
        document_id: z.string().optional().describe('Document ID to get context for'),
        application_id: z.string().optional().describe('Application ID to get context for'),
        ngo_id: z.string().optional().describe('NGO ID to get context for'),
        include_grant_info: z.boolean().default(true).describe('Whether to include grant requirements'),
        include_similar_docs: z.boolean().default(true).describe('Whether to include similar successful documents')
      }),
      execute: async ({ document_id, application_id, ngo_id, include_grant_info, include_similar_docs }) => {
        try {
          const context: any = {};

          // Get document info if provided
          if (document_id) {
            const document = await db('application_content')
              .where('id', document_id)
              .first();
            context.document = document;

            if (document?.application_id) {
              application_id = document.application_id;
            }
            if (document?.ngo_id) {
              ngo_id = document.ngo_id;
            }
          }

          // Get application info
          if (application_id) {
            const application = await db('applications')
              .where('id', application_id)
              .first();
            context.application = application;

            if (application?.ngo_id) {
              ngo_id = application.ngo_id;
            }
          }

          // Get NGO info
          if (ngo_id) {
            const ngo = await db('ngos')
              .join('yp_organizations', 'ngos.organization_id', 'yp_organizations.id')
              .where('ngos.id', ngo_id)
              .select('ngos.*', 'yp_organizations.name as organization_name')
              .first();
            context.ngo = ngo;
          }

          // Get grant info if requested
          if (include_grant_info && context.application?.grant_id) {
            const grant = await db('grants')
              .where('id', context.application.grant_id)
              .first();
            context.grant = grant;
          }

          return {
            success: true,
            context,
            message: 'Context retrieved successfully'
          };

        } catch (error) {
          logger.error(error, 'Error getting document context');
          return {
            success: false,
            message: 'Failed to retrieve context',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      },
    }),
  };

  async function getNextVersionNumber(documentId: string): Promise<number> {
    const result = await db('application_content_versions')
      .where('application_content_id', documentId)
      .max('version_number as max_version')
      .first();

    return (result?.max_version || 0) + 1;
  }
}