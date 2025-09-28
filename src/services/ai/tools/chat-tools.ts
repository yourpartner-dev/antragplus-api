import { z } from 'zod';
import { tool } from 'ai';
import { ItemsService } from '../../items.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';
import { getWebSearchTools } from './web-search-tools.js';
import type { ChatContext } from '../chat/chat-service.js';

/**
 * Define available tools for the chat AI (APPLICATION CONTEXT ONLY)
 */
export function getChatTools(options: {
  accountability: Accountability | null;
  schema: SchemaOverview;
  userId: string | null;
  applicationContext?: ChatContext;
}) {
  const { accountability, schema, userId, applicationContext } = options;

  // Get web search tools
  const webSearchTools = getWebSearchTools();

  return {
    // Web search tools - for current information
    ...webSearchTools,

    // APPLICATION DOCUMENT MANAGEMENT TOOLS
    createApplicationDocument: tool({
      description: 'Create a new document within the current application context',
      inputSchema: z.object({
        title: z.string().describe('The title of the document'),
        content: z.string().describe('The content of the document'),
        kind: z.enum(['proposal', 'budget', 'timeline', 'cover_letter', 'organization', 'text']).describe('Type of document'),
      }),
      execute: async ({ title, content, kind }) => {
        if (!userId) {
          throw new Error('User must be authenticated to create documents');
        }

        if (!applicationContext?.application_id) {
          throw new Error('Application context required for document creation');
        }

        const service = new ItemsService('application_content', { accountability, schema });

        const document = await service.createOne({
          title,
          content,
          kind,
          content_format: 'markdown',
          application_id: applicationContext.application_id,
          ngo_id: applicationContext.ngo_id,
          created_at: new Date(),
          created_by: userId,
        });

        return {
          success: true,
          document,
          message: `Document "${title}" created successfully in application`,
        };
      },
    }),

    updateApplicationDocument: tool({
      description: 'Update an existing document within the current application',
      inputSchema: z.object({
        document_id: z.string().describe('The ID of the document to update'),
        content: z.string().optional().describe('The new content'),
        title: z.string().optional().describe('The new title'),
        change_description: z.string().optional().describe('Description of changes made'),
      }),
      execute: async ({ document_id, content, title, change_description }) => {
        if (!userId) {
          throw new Error('User must be authenticated to update documents');
        }

        const service = new ItemsService('application_content', { accountability, schema });

        const updates: any = {
          updated_at: new Date(),
          updated_by: userId,
        };

        if (content) updates.content = content;
        if (title) updates.title = title;

        const document = await service.updateOne(document_id, updates);

        return {
          success: true,
          document,
          message: `Document updated successfully${change_description ? ': ' + change_description : ''}`,
        };
      },
    }),

    deleteApplicationDocument: tool({
      description: 'Delete a document from the current application',
      inputSchema: z.object({
        document_id: z.string().describe('The ID of the document to delete'),
        reason: z.string().optional().describe('Reason for deletion'),
      }),
      execute: async ({ document_id, reason }) => {
        if (!userId) {
          throw new Error('User must be authenticated to delete documents');
        }

        const service = new ItemsService('application_content', { accountability, schema });

        await service.deleteOne(document_id);

        return {
          success: true,
          message: `Document deleted successfully${reason ? ': ' + reason : ''}`,
        };
      },
    }),

    listApplicationDocuments: tool({
      description: 'List all documents in the current application',
      inputSchema: z.object({
        include_content: z.boolean().optional().default(false).describe('Whether to include document content'),
      }),
      execute: async ({ include_content }) => {
        if (!applicationContext?.application_id) {
          throw new Error('Application context required');
        }

        const service = new ItemsService('application_content', { accountability, schema });

        const documents = await service.readByQuery({
          filter: { application_id: { _eq: applicationContext.application_id } },
          sort: ['-created_at'],
          fields: include_content ? ['*'] : ['id', 'title', 'kind', 'created_at', 'updated_at'],
        });

        return {
          success: true,
          documents,
          count: documents.length,
          message: `Found ${documents.length} documents in application`,
        };
      },
    }),

    // GRANT AND NGO INFORMATION TOOLS (for context only)
    getCurrentGrantInfo: tool({
      description: 'Get current grant information and requirements',
      inputSchema: z.object({}),
      execute: async () => {
        if (!applicationContext?.grant_id) {
          throw new Error('Grant context required');
        }

        const service = new ItemsService('grants', { accountability, schema });
        const grant = await service.readOne(applicationContext.grant_id);

        return {
          success: true,
          grant,
          message: 'Retrieved current grant information',
        };
      },
    }),

    getCurrentNGOInfo: tool({
      description: 'Get current NGO information and capabilities',
      inputSchema: z.object({}),
      execute: async () => {
        if (!applicationContext?.ngo_id) {
          throw new Error('NGO context required');
        }

        const service = new ItemsService('ngos', { accountability, schema });
        const ngo = await service.readOne(applicationContext.ngo_id);

        return {
          success: true,
          ngo,
          message: 'Retrieved current NGO information',
        };
      },
    }),

    // DATABASE SEARCH TOOLS (with web search fallback)
    searchNGOs: tool({
      description: 'Search for NGOs in the database, with web search fallback if none found',
      inputSchema: z.object({
        query: z.string().describe('Search query for NGO name or description'),
        field_of_work: z.string().optional().describe('Filter by field of work'),
        location: z.string().optional().describe('Filter by location'),
        web_fallback: z.boolean().optional().default(true).describe('Search web if no database results'),
      }),
      execute: async ({ query, field_of_work, location, web_fallback }) => {
        const ngoService = new ItemsService('ngos', { accountability, schema });

        // First search the database
        const filter: any = {
          _or: [
            { organization_name: { _icontains: query } },
            { about: { _icontains: query } },
          ]
        };

        if (field_of_work) {
          filter.field_of_work = { _icontains: field_of_work };
        }

        if (location) {
          filter.location = { _icontains: location };
        }

        const dbResults = await ngoService.readByQuery({
          filter,
          limit: 10,
        });

        // If we found results in database, return them
        if (dbResults.length > 0) {
          return {
            success: true,
            source: 'database',
            results: dbResults,
            count: dbResults.length,
            message: `Found ${dbResults.length} NGOs in database matching "${query}"`,
          };
        }

        // No database results - search web if enabled
        if (web_fallback) {
          const webQuery = `NGO "${query}" ${field_of_work ? field_of_work : ''} ${location ? location : ''} Germany nonprofit organization`;

          try {
            // Import and call the search function directly
            const { tavilySearchWithTimeout } = await import('../tools/web-search-tools.js');
            const webResults = await tavilySearchWithTimeout({
              query: webQuery,
              search_depth: 'advanced',
              max_results: 5,
              include_answer: true,
              include_raw_content: false,
            }, 30000);

            return {
              success: true,
              source: 'web',
              results: webResults,
              count: 0,
              message: `No NGOs found in database. Found web information about "${query}"`,
            };
          } catch (webError) {
            return {
              success: false,
              source: 'none',
              message: `No NGOs found in database and web search failed for "${query}"`,
            };
          }
        }

        return {
          success: false,
          source: 'database',
          message: `No NGOs found in database for "${query}"`,
        };
      },
    }),

    searchGrants: tool({
      description: 'Search for grants in the database, with web search fallback',
      inputSchema: z.object({
        query: z.string().describe('Search query for grant name or description'),
        category: z.string().optional().describe('Filter by category'),
        provider: z.string().optional().describe('Filter by provider'),
        min_amount: z.number().optional().describe('Minimum funding amount'),
        web_fallback: z.boolean().optional().default(true).describe('Search web if no database results'),
      }),
      execute: async ({ query, category, provider, min_amount, web_fallback }) => {
        const grantService = new ItemsService('grants', { accountability, schema });

        // First search the database
        const filter: any = {
          _or: [
            { name: { _icontains: query } },
            { description: { _icontains: query } },
          ]
        };

        if (category) filter.category = { _icontains: category };
        if (provider) filter.provider = { _icontains: provider };
        if (min_amount) filter.amount_min = { _gte: min_amount };

        const dbResults = await grantService.readByQuery({
          filter,
          limit: 10,
        });

        // If we found results in database, return them
        if (dbResults.length > 0) {
          return {
            success: true,
            source: 'database',
            results: dbResults,
            count: dbResults.length,
            message: `Found ${dbResults.length} grants in database matching "${query}"`,
          };
        }

        // No database results - search web if enabled
        if (web_fallback) {
          const webQuery = `grant funding "${query}" ${category ? category : ''} ${provider ? provider : ''} Germany nonprofit`;

          try {
            // Import and call the search function directly
            const { tavilySearchWithTimeout } = await import('../tools/web-search-tools.js');
            const webResults = await tavilySearchWithTimeout({
              query: webQuery,
              search_depth: 'advanced',
              max_results: 5,
              include_answer: true,
              include_raw_content: false,
            }, 30000);

            return {
              success: true,
              source: 'web',
              results: webResults,
              count: 0,
              message: `No grants found in database. Found web information about "${query}"`,
            };
          } catch (webError) {
            return {
              success: false,
              source: 'none',
              message: `No grants found in database and web search failed for "${query}"`,
            };
          }
        }

        return {
          success: false,
          source: 'database',
          message: `No grants found in database for "${query}"`,
        };
      },
    }),

    // ANALYSIS TOOLS
    analyzeGrantCompliance: tool({
      description: 'Analyze application compliance with grant requirements',
      inputSchema: z.object({
        focus_area: z.string().optional().describe('Specific area to focus analysis on'),
      }),
      execute: async ({ focus_area }) => {
        if (!applicationContext?.application_id || !applicationContext?.grant_id) {
          throw new Error('Full application context required for compliance analysis');
        }

        // Get current documents
        const contentService = new ItemsService('application_content', { accountability, schema });
        const documents = await contentService.readByQuery({
          filter: { application_id: { _eq: applicationContext.application_id } },
        });

        // Get grant requirements
        const grantService = new ItemsService('grants', { accountability, schema });
        const grant = await grantService.readOne(applicationContext.grant_id);

        return {
          success: true,
          compliance_status: {
            documents_created: documents.length,
            focus_area: focus_area || 'general',
            grant_deadline: grant['deadline'],
            language_requirement: grant['language'] || 'de-DE',
          },
          message: 'Compliance analysis completed',
        };
      },
    }),

  };
}