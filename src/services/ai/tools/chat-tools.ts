import { z } from 'zod';
import { tool } from 'ai';
import { ItemsService } from '../../items.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';
import { getWebSearchTools } from './web-search-tools.js';
import type { ChatContext } from '../chat/chat-service.js';
import getDatabase from '../../../database/index.js';

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
      description: 'Get complete grant information including ALL requirements, submission guidelines, and formatting requirements. Use this when you need detailed grant specifications.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!applicationContext?.grant_id) {
          throw new Error('Grant context required');
        }

        const service = new ItemsService('grants', { accountability, schema });
        const grant = await service.readOne(applicationContext.grant_id);

        // Extract detailed requirements from metadata and extracted_requirements
        const extractedRequirements = grant['extracted_requirements'] || [];
        const metadataRequirements = grant['metadata']?.requirements || [];
        const allRequirements = [...extractedRequirements, ...metadataRequirements];

        return {
          success: true,
          grant: {
            basic_info: {
              name: grant['name'],
              provider: grant['provider'],
              category: grant['category'],
              deadline: grant['deadline'],
              amount_min: grant['amount_min'],
              amount_max: grant['amount_max'],
              currency: grant['currency'],
            },
            requirements: allRequirements,
            submission_guidelines: grant['metadata']?.submission_guidelines || [],
            formatting_requirements: grant['metadata']?.formatting_requirements || [],
            language_requirements: grant['metadata']?.language || grant['language'] || 'Not specified',
            eligibility: grant['metadata']?.eligibility || [],
            focus_areas: grant['focus_areas'] || grant['metadata']?.focus_areas || [],
          },
          message: `Retrieved complete information for grant: ${grant['name']} (${allRequirements.length} requirements documented)`,
        };
      },
    }),

    getCurrentNGOInfo: tool({
      description: 'Get complete NGO information including capabilities, track record, and past applications. Use this when you need to understand what the NGO can do or has accomplished.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!applicationContext?.ngo_id) {
          throw new Error('NGO context required');
        }

        const db = getDatabase();
        const service = new ItemsService('ngos', { accountability, schema });
        const ngo = await service.readOne(applicationContext.ngo_id);

        // Get recent past applications (limited to 5 by default)
        const pastApplications = await db('applications')
          .leftJoin('grants', 'applications.grant_id', 'grants.id')
          .where('applications.ngo_id', applicationContext.ngo_id)
          .where('applications.status', '!=', 'draft')
          .select(
            'applications.id',
            'applications.status',
            'applications.created_at',
            'grants.name as grant_name',
            'grants.provider as grant_provider',
            'grants.amount_max as grant_amount'
          )
          .orderBy('applications.created_at', 'desc')
          .limit(5);

        // Extract capabilities from NGO metadata
        const capabilities = ngo['capabilities'] || ngo['metadata']?.capabilities || [];
        const teamExpertise = ngo['metadata']?.team_expertise || [];

        // Calculate track record
        const successfulApps = pastApplications.filter((app: any) => app.status === 'won').length;
        const totalApps = pastApplications.length;
        const successRate = totalApps > 0 ? Math.round((successfulApps / totalApps) * 100) : 0;

        return {
          success: true,
          ngo: {
            basic_info: {
              organization_name: ngo['organization_name'],
              field_of_work: ngo['field_of_work'],
              company_size: ngo['company_size'],
              location: ngo['location'],
              about: ngo['about'],
            },
            capabilities: capabilities,
            team_expertise: teamExpertise,
            track_record: {
              total_applications: totalApps,
              successful_applications: successfulApps,
              success_rate: successRate,
              recent_applications: pastApplications,
            },
          },
          message: `Retrieved NGO information for ${ngo['organization_name']} (${totalApps} past applications, ${successRate}% success rate)`,
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
      description: 'Search for grants in the database including matched grants for the current NGO, with web search fallback. Always inform user about search progress.',
      inputSchema: z.object({
        query: z.string().describe('Search query for grant name or description'),
        category: z.string().optional().describe('Filter by category'),
        provider: z.string().optional().describe('Filter by provider'),
        min_amount: z.number().optional().describe('Minimum funding amount'),
        web_fallback: z.boolean().optional().default(true).describe('Search web if no database results'),
      }),
      execute: async ({ query, category, provider, min_amount, web_fallback }) => {
        const grantService = new ItemsService('grants', { accountability, schema });
        const matchService = new ItemsService('grant_matches', { accountability, schema });

        // Step 1: Check grant_matches table first (for current NGO if available)
        let matchedGrants: any[] = [];
        if (applicationContext?.ngo_id) {
          try {
            const matchFilter: any = {
              ngo_id: { _eq: applicationContext.ngo_id },
              _or: [
                { 'grant_id.name': { _icontains: query } },
                { 'grant_id.description': { _icontains: query } },
              ]
            };

            matchedGrants = await matchService.readByQuery({
              filter: matchFilter,
              limit: 10,
              fields: ['*', 'grant_id.*'],
            });
          } catch (err) {
            // grant_matches might not exist or query failed, continue to regular search
          }
        }

        // Step 2: Search regular grants table
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

        // Combine results (matched grants + regular grants)
        const allResults = [];

        if (matchedGrants.length > 0) {
          allResults.push(...matchedGrants.map((match: any) => ({
            ...match.grant_id,
            match_score: match.match_score,
            match_status: match.match_status,
            is_matched_for_ngo: true,
          })));
        }

        // Add regular grants that aren't already in matched results
        const matchedGrantIds = new Set(matchedGrants.map((m: any) => m.grant_id?.['id']));
        for (const grant of dbResults) {
          if (!matchedGrantIds.has(grant['id'])) {
            allResults.push({
              ...grant,
              is_matched_for_ngo: false,
            });
          }
        }

        // If we found results in database, return them
        if (allResults.length > 0) {
          const matchedCount = matchedGrants.length;
          const totalCount = allResults.length;

          let message = `Found ${totalCount} grant${totalCount !== 1 ? 's' : ''} matching "${query}"`;
          if (matchedCount > 0) {
            message += ` (${matchedCount} already analyzed for this NGO with match scores)`;
          }

          return {
            success: true,
            source: 'database',
            results: allResults,
            matched_grants_count: matchedCount,
            total_count: totalCount,
            message,
          };
        }

        // No database results - inform user and search web if enabled
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
              matched_grants_count: 0,
              total_count: 0,
              message: `I couldn't find relevant grants in our database for "${query}", so I searched the web and found some information.`,
            };
          } catch (webError) {
            return {
              success: false,
              source: 'none',
              message: `I couldn't find any grants in our database matching "${query}" and the web search also failed.`,
            };
          }
        }

        return {
          success: false,
          source: 'database',
          message: `I couldn't find any grants in our database matching "${query}". You may want to try different search terms or ask me to search the web.`,
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

    getApplicationProgress: tool({
      description: 'Get current progress of application creation including which documents exist and grant requirements. After calling this tool, ALWAYS respond to the user with a summary of the progress.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!applicationContext?.application_id) {
          throw new Error('Application context required');
        }

        const contentService = new ItemsService('application_content', { accountability, schema });
        const grantService = new ItemsService('grants', { accountability, schema });
        const applicationService = new ItemsService('applications', { accountability, schema });

        // Get existing documents
        const existingDocuments = await contentService.readByQuery({
          filter: { application_id: { _eq: applicationContext.application_id } },
          sort: ['-created_at'],
          fields: ['id', 'title', 'kind', 'created_at', 'updated_at'],
        });

        // Get grant and application info
        const grant = await grantService.readOne(applicationContext.grant_id as string);
        const application = await applicationService.readOne(applicationContext.application_id);

        // Extract requirements from grant metadata and extracted_requirements
        const grantRequirements = grant['extracted_requirements'] || grant['metadata']?.requirements || [];
        const requiredDocTypes = grant['metadata']?.required_document_types || [];

        // Calculate what's been created
        const createdTypes = existingDocuments.map((doc: any) => doc.kind);
        const documentsByType = existingDocuments.reduce((acc: any, doc: any) => {
          if (!acc[doc.kind]) acc[doc.kind] = [];
          acc[doc.kind].push({ id: doc.id, title: doc.title });
          return acc;
        }, {});

        return {
          success: true,
          progress: {
            documents_created: existingDocuments.length,
            documents_by_type: documentsByType,
            created_document_types: [...new Set(createdTypes)],
            grant_name: grant['name'],
            grant_deadline: grant['deadline'],
            grant_requirements: grantRequirements,
            required_document_types: requiredDocTypes,
            application_status: application['status'],
            last_updated: existingDocuments[0]?.['updated_at'] || application['updated_at'],
          },
          documents: existingDocuments,
          message: `Application progress: ${existingDocuments.length} documents created. Grant deadline: ${grant['deadline']}`,
        };
      },
    }),

    getPastApplications: tool({
      description: 'Get past applications for the current NGO with optional limit. Use this when user asks for "all" applications or more than the 5 shown by default.',
      inputSchema: z.object({
        limit: z.number().optional().describe('Number of applications to retrieve. Default is 10. Use 0 for all applications.'),
      }),
      execute: async ({ limit = 10 }) => {
        if (!applicationContext?.ngo_id) {
          throw new Error('NGO context required');
        }

        const db = getDatabase();
        let query = db('applications')
          .leftJoin('grants', 'applications.grant_id', 'grants.id')
          .where('applications.ngo_id', applicationContext.ngo_id)
          .where('applications.status', '!=', 'draft')
          .select(
            'applications.id',
            'applications.status',
            'applications.created_at',
            'applications.updated_at',
            'grants.name as grant_name',
            'grants.provider as grant_provider',
            'grants.amount_max as grant_amount',
            'grants.deadline as grant_deadline'
          )
          .orderBy('applications.created_at', 'desc');

        // Apply limit if specified (0 means all)
        if (limit > 0) {
          query = query.limit(limit);
        }

        const applications = await query;

        return {
          success: true,
          applications,
          count: applications.length,
          message: `Retrieved ${applications.length} past application${applications.length !== 1 ? 's' : ''} for this NGO`,
        };
      },
    }),

  };
}