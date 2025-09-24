import { z } from 'zod';
import { tool } from 'ai';
import { ItemsService } from '../../items.js';
import getDatabase from '../../../database/index.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';
import { DocumentService } from '../documents/application-content-service.js';
import { GrantExtractionService } from '../grants/grant-extraction-service.js';
import { getWebSearchTools } from './web-search-tools.js';
import { getDocumentTools } from './document-tools.js';

/**
 * Define available tools for the chat AI
 */
export function getChatTools(options: {
  accountability: Accountability | null;
  schema: SchemaOverview;
  userId: string | null;
}) {
  const { accountability, schema, userId } = options;

  // Get web search tools
  const webSearchTools = getWebSearchTools();

  // Get enhanced document tools
  const documentTools = getDocumentTools({ userId });

  return {
    // Web search tools - for current information
    ...webSearchTools,

    // Enhanced document tools - for document creation and management
    ...documentTools,

    // Legacy createDocument (keeping for backwards compatibility)
    createLegacyDocument: tool({
      description: 'Create a new document for the user',
      inputSchema: z.object({
        title: z.string().describe('The title of the document'),
        content: z.string().describe('The content of the document'),
        kind: z.enum(['text', 'code', 'markdown']).optional().default('text'),
        ngo_id: z.string().optional().describe('Associated NGO ID'),
        application_id: z.string().optional().describe('Associated application ID'),
      }),
      execute: async ({ title, content, kind, ngo_id, application_id }) => {
        if (!userId) {
          throw new Error('User must be authenticated to create documents');
        }

        const service = new DocumentService({ accountability, schema });
        const document = await service.createDocument({
          title,
          content,
          ...(kind && { kind }),
          ...(ngo_id && { ngo_id }),
          ...(application_id && { application_id }),
          created_by: userId,
        });

        return {
          success: true,
          document,
          message: `Document "${title}" created successfully`,
        };
      },
    }),

    // Search for grants
    searchGrants: tool({
      description: 'Search for grants matching specific criteria',
      inputSchema: z.object({
        query: z.string().optional().describe('Search query'),
        category: z.string().optional().describe('Grant category'),
        min_amount: z.number().optional().describe('Minimum grant amount'),
        max_amount: z.number().optional().describe('Maximum grant amount'),
        deadline_after: z.string().optional().describe('Grants with deadline after this date'),
        status: z.enum(['active', 'closed', 'upcoming']).optional(),
      }),
      execute: async ({ query, category, min_amount, max_amount, deadline_after, status }) => {
        const knex = getDatabase();
        
        let searchQuery = knex('grants');

        if (query) {
          searchQuery = searchQuery.where(function() {
            this.where('name', 'ilike', `%${query}%`)
              .orWhere('description', 'ilike', `%${query}%`)
              .orWhere('provider', 'ilike', `%${query}%`);
          });
        }

        if (category) {
          searchQuery = searchQuery.where('category', category);
        }

        if (min_amount !== undefined) {
          searchQuery = searchQuery.where('amount_min', '>=', min_amount);
        }

        if (max_amount !== undefined) {
          searchQuery = searchQuery.where('amount_max', '<=', max_amount);
        }

        if (deadline_after) {
          searchQuery = searchQuery.where('deadline', '>=', new Date(deadline_after));
        }

        if (status) {
          searchQuery = searchQuery.where('status', status);
        }

        const grants = await searchQuery.limit(10);

        return {
          success: true,
          count: grants.length,
          grants,
          message: `Found ${grants.length} grants matching your criteria`,
        };
      },
    }),

    // Get NGO information
    getNGOInfo: tool({
      description: 'Get information about a specific NGO',
      inputSchema: z.object({
        ngo_id: z.string().describe('The NGO ID to get information for'),
      }),
      execute: async ({ ngo_id }) => {
        const service = new ItemsService('ngos', { accountability, schema });
        const ngo = await service.readOne(ngo_id);

        if (!ngo) {
          return {
            success: false,
            message: 'NGO not found',
          };
        }

        return {
          success: true,
          ngo,
          message: `Retrieved information for NGO`,
        };
      },
    }),

    // Create an application
    createApplication: tool({
      description: 'Create a new grant application',
      inputSchema: z.object({
        ngo_id: z.string().describe('The NGO applying for the grant'),
        grant_id: z.string().describe('The grant being applied for'),
        title: z.string().describe('Application title'),
        project_title: z.string().describe('Project title'),
        project_description: z.string().describe('Project description'),
        requested_amount: z.number().describe('Amount requested'),
      }),
      execute: async ({ ngo_id, grant_id, title, project_title, project_description, requested_amount }) => {
        if (!userId) {
          throw new Error('User must be authenticated to create applications');
        }

        const service = new ItemsService('applications', { accountability, schema });
        
        const application = await service.createOne({
          ngo_id,
          grant_id,
          title,
          project_title,
          project_description,
          requested_amount,
          status: 'draft',
          created_at: new Date(),
          created_by: userId,
        });

        return {
          success: true,
          application,
          message: `Application "${title}" created successfully`,
        };
      },
    }),

    // Generate grant match recommendations
    findGrantMatches: tool({
      description: 'Find grants that match an NGO profile',
      inputSchema: z.object({
        ngo_id: z.string().describe('The NGO to find matches for'),
        limit: z.number().optional().default(5).describe('Number of matches to return'),
      }),
      execute: async ({ ngo_id, limit = 5 }) => {
        const knex = getDatabase();

        // Get NGO details
        const ngo = await knex('ngos').where('id', ngo_id).first();
        if (!ngo) {
          return {
            success: false,
            message: 'NGO not found',
          };
        }

        // Find matching grants based on NGO field of work and funding type
        let matchQuery = knex('grants')
          .where('status', 'active')
          .where('deadline', '>', new Date());

        if (ngo.field_of_work) {
          matchQuery = matchQuery.where('category', 'ilike', `%${ngo.field_of_work}%`);
        }

        const matches = await matchQuery.limit(limit);

        // Store matches in grant_matches table
        for (const grant of matches) {
          await knex('grant_matches')
            .insert({
              ngo_id,
              grant_id: grant.id,
              match_score: 0.75, // Simplified scoring
              match_status: 'active',
              summary: `${grant.name} matches your organization's focus on ${ngo.field_of_work}`,
              analysis: `This grant from ${grant.provider} offers funding between ${grant.amount_min} and ${grant.amount_max} ${grant.currency} for projects in ${grant.category}.`,
              created_at: new Date(),
              created_by: userId,
            })
            .onConflict(['ngo_id', 'grant_id'])
            .ignore();
        }

        return {
          success: true,
          count: matches.length,
          matches,
          message: `Found ${matches.length} potential grant matches for your organization`,
        };
      },
    }),

    // Legacy updateDocument (keeping for backwards compatibility)
    updateLegacyDocument: tool({
      description: 'Update the content of an existing document',
      inputSchema: z.object({
        document_id: z.string().describe('The document ID to update'),
        content: z.string().describe('The new content'),
        title: z.string().optional().describe('New title (optional)'),
      }),
      execute: async ({ document_id, content, title }) => {
        if (!userId) {
          throw new Error('User must be authenticated to update documents');
        }

        const service = new DocumentService({ accountability, schema });
        
        const updates: any = { content };
        if (title) updates.title = title;

        const document = await service.updateDocument(
          document_id,
          updates,
          userId
        );

        return {
          success: true,
          document,
          message: `Document updated successfully`,
        };
      },
    }),

    // Extract grant information from documents
    extractGrantFromDocuments: tool({
      description: 'Extract grant information from uploaded documents',
      inputSchema: z.object({
        file_ids: z.array(z.string()).describe('Array of file IDs to extract from'),
      }),
      execute: async ({ file_ids }) => {
        if (!userId) {
          throw new Error('User must be authenticated to extract grants');
        }

        const service = new GrantExtractionService({ accountability, schema });
        
        const extractedData = await service.extractGrantFromDocuments({
          file_ids,
          created_by: userId,
          accountability,
          schema,
        });

        return {
          success: true,
          grant: extractedData.grant,
          confidence: extractedData.confidence,
          message: `Successfully extracted grant information with ${Math.round(extractedData.confidence * 100)}% confidence`,
        };
      },
    }),

    // Create grant from extracted data
    createGrantFromExtraction: tool({
      description: 'Create a grant record from extracted document data',
      inputSchema: z.object({
        file_ids: z.array(z.string()).describe('Array of file IDs that were extracted'),
        extracted_data: z.object({
          grant: z.any(),
          confidence: z.number(),
          raw_text: z.string(),
        }).describe('The extracted grant data'),
      }),
      execute: async ({ file_ids, extracted_data }) => {
        if (!userId) {
          throw new Error('User must be authenticated to create grants');
        }

        const itemsService = new ItemsService('grants', { accountability, schema });
        
        // Prepare grant data with proper type conversions
        const grantData = {
          ...extracted_data.grant,
          // Convert deadline string to Date if provided
          deadline: extracted_data.grant.deadline ? new Date(extracted_data.grant.deadline) : null,
          // Use AI-detected language, fallback to de-DE for German grants
          language: extracted_data.grant.language || 'de-DE',
          status: 'active',
          created_by: userId,
          metadata: {
            extraction_confidence: extracted_data.confidence,
            extracted_at: new Date(),
            source_files: file_ids,
            raw_extraction: extracted_data.raw_text
          }
        };

        // Remove document_metadata as it's not a database field
        delete grantData.document_metadata;
        
        // Create the grant
        const grantId = await itemsService.createOne(grantData);
        const grant = await itemsService.readOne(grantId);

        // Create grant_documents links if files provided
        if (file_ids && file_ids.length > 0) {
          const documentsService = new ItemsService('grant_documents', { accountability, schema });
          
          for (let i = 0; i < file_ids.length; i++) {
            const fileId = file_ids[i];
            const metadata = extracted_data.grant.document_metadata?.[i];
            
            await documentsService.createOne({
              grant_id: grantId,
              file_id: fileId,
              document_type: metadata?.document_type || 'guidelines',
              is_required: false,
              display_order: i,
              metadata: {
                description: metadata?.description || 'Grant document',
                ai_generated_description: true
              },
              created_by: userId
            });
          }
        }

        return {
          success: true,
          grant,
          message: `Grant "${grant?.['name']}" created successfully`,
        };
      },
    }),

    // Get grant details
    getGrantDetails: tool({
      description: 'Get detailed information about a specific grant',
      inputSchema: z.object({
        grant_id: z.string().describe('The grant ID to get details for'),
      }),
      execute: async ({ grant_id }) => {
        const knex = getDatabase();
        
        const grant = await knex('grants')
          .where('id', grant_id)
          .first();

        if (!grant) {
          return {
            success: false,
            message: 'Grant not found',
          };
        }

        // Get linked documents
        const documents = await knex('grant_documents')
          .where('grant_id', grant_id)
          .join('yp_files', 'grant_documents.file_id', 'yp_files.id')
          .select('grant_documents.*', 'yp_files.filename_download', 'yp_files.type');

        return {
          success: true,
          grant: {
            ...grant,
            documents,
          },
          message: `Retrieved grant details for "${grant.name}"`,
        };
      },
    }),
  };
}