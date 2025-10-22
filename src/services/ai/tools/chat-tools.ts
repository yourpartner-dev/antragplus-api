import { z } from 'zod';
import { tool } from 'ai';
import { ItemsService } from '../../items.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';
import { getWebSearchTools } from './web-search-tools.js';
import type { ChatContext } from '../chat/chat-service.js';
import getDatabase from '../../../database/index.js';
import { useLogger } from '../../../helpers/logger/index.js';

const logger = useLogger();

/**
 * Helper function to create a version record for document changes
 */
export async function createVersion(
  documentId: string,
  content: string,
  contentBlocks: any[] | null,
  changeDescription: string,
  userId: string,
  accountability: Accountability | null,
  schema: SchemaOverview
): Promise<number> {
  const db = getDatabase();

  // Get latest version number for this document
  const result = await db('application_content_versions')
    .where('application_content_id', documentId)
    .max('version_number as max_version')
    .first();

  const nextVersion = (result?.['max_version'] || 0) + 1;

  // Create version record
  const versionService = new ItemsService('application_content_versions', { accountability, schema });

  // Clear 'current' flag from ALL existing versions
  // Because we're about to update application_content with new content
  // that won't match any version
  await db('application_content_versions')
    .where('application_content_id', documentId)
    .update({
      metadata: db.raw(`metadata - 'current'`)  // Remove 'current' key from JSONB
    });

  await versionService.createOne({
    application_content_id: documentId,
    version_number: nextVersion,
    content,
    content_blocks: contentBlocks || [],
    changes: { description: changeDescription },
    created_by: userId,
    created_at: new Date(),
    metadata: { current: true }, // Mark this as the current version
  });

  return nextVersion;
}

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
        // LOG: What AI provided for document creation
        logger.info('[CREATE DOC] AI provided args:', {
          title,
          content_length: content?.length,
          content_preview: content?.substring(0, 200),
          kind,
          application_id: applicationContext?.application_id
        });

        if (!userId) {
          throw new Error('User must be authenticated to create documents');
        }

        if (!applicationContext?.application_id) {
          throw new Error('Application context required for document creation');
        }

        const service = new ItemsService('application_content', { accountability, schema });

        const documentId = await service.createOne({
          title,
          content,
          content_blocks: [],
          kind,
          content_format: 'markdown',
          application_id: applicationContext.application_id,
          ngo_id: applicationContext.ngo_id,
          created_at: new Date(),
          created_by: userId,
        });

        // Read back the full document object to return complete data
        const document = await service.readOne(documentId as string);

        // Create initial version (v1) with the created content
        await createVersion(
          documentId as string,
          content,
          [],
          'Initial document creation',
          userId,
          accountability,
          schema
        );
        
        return {
          success: true,
          document: {
            id: documentId,
            title: document['title'],
            kind: document['kind'],
            content_format: document['content_format'],
            created_at: document['created_at'],
          },
          message: `Document "${title}" created successfully in application`,
        };
      },
    }),

    updateApplicationDocument: tool({
      description: 'Update an existing document in the application. You can update by document_id (exact UUID) or by document_title (fuzzy search using partial title). When multiple documents match the title, a list of options will be returned for user selection. Automatically creates a new version.',
      inputSchema: z.object({
        document_id: z.string().optional().describe('The exact UUID of the document to update'),
        document_title: z.string().optional().describe('Partial or full title to search for (case-insensitive)'),
        content: z.string().optional().describe('The new content (REQUIRED - you must always provide updated content)'),
        title: z.string().optional().describe('The new title'),
        change_description: z.string().optional().describe('Description of changes made'),
      }),
      execute: async ({ document_id, document_title, content, title, change_description }) => {
        if (!userId) {
          throw new Error('User must be authenticated to update documents');
        }

        const service = new ItemsService('application_content', { accountability, schema });

        // If no document_id but document_title provided, search by title
        if (!document_id && document_title) {
          if (!applicationContext?.application_id) {
            return {
              success: false,
              error: 'Application context not available'
            };
          }

          const matches = await service.readByQuery({
            filter: {
              application_id: { _eq: applicationContext.application_id },
              title: { _icontains: document_title }
            },
            fields: ['id', 'title', 'updated_at']
          });

          if (matches.length === 0) {
            return {
              success: false,
              error: `No documents found matching "${document_title}"`
            };
          }

          if (matches.length > 1) {
            return {
              success: false,
              multiple_matches: true,
              matches: matches.map((m: any) => ({
                id: m['id'],
                title: m['title'],
                updated_at: m['updated_at']
              })),
              message: `Found ${matches.length} documents matching "${document_title}". Please specify which one to update by providing the exact document_id:`,
            };
          }

          // Single match - use this document
          const matchedDoc = matches[0];
          if (!matchedDoc) {
            return {
              success: false,
              error: 'Unexpected error: matched document is undefined'
            };
          }
          document_id = matchedDoc['id'];
        }

        if (!document_id) {
          return {
            success: false,
            error: 'Must provide either document_id or document_title'
          };
        }

        // Require content to be provided for updates
        if (!content) {
          return {
            success: false,
            error: 'Content is required to update a document'
          };
        }

        // Read CURRENT document BEFORE making any changes
        const currentDocument = await service.readOne(document_id);

        // Build updates with NEW content
        const updates: any = {
          updated_at: new Date(),
          updated_by: userId,
        };

        if (content) {
          updates.content = content;
          updates.content_blocks = [];  // Clear blocks - frontend will regenerate from content

          // Recalculate metadata word_count and character_count
          updates.metadata = {
            ...currentDocument['metadata'],
            word_count: content.split(/\s+/).filter(word => word.length > 0).length,
            character_count: content.length
          };
        }
        if (title) updates.title = title;

        // LOG 3: Update payload being sent to database
        logger.info({
          document_id,
          title_change: updates.title,
          content_length: updates.content?.length,
          content_preview: updates.content?.substring(0, 200),
          content_blocks_cleared: updates.content_blocks?.length === 0
        }, '[UPDATE DOC] Update payload:');

        // Update application_content with NEW content FIRST
        await service.updateOne(document_id, updates, {});

        // Read the updated document to get the NEW content
        const document = await service.readOne(document_id);

        // Create version with NEW content (what user sees now) - stores n versions
        const versionNumber = await createVersion(
          document_id,
          document['content'], // NEW content that was just saved
          document['content_blocks'], // NEW blocks
          change_description || 'Document updated',
          userId,
          accountability,
          schema
        );

        // LOG 4: Document after save (verify what's in database)
        logger.info({
          id: document['id'],
          title: document['title'],
          content_length: document['content']?.length,
          content_preview: document['content']?.substring(0, 200),
          updated_at: document['updated_at'],
          content_blocks_count: document['content_blocks']?.length || 0
        }, '[UPDATE DOC] Document after save:');

        // LOG 5: What we're returning to AI
        const returnData = {
          success: true,
          document,
          version_number: versionNumber,
          message: `Document "${document['title']}" updated successfully (version ${versionNumber})`,
        };

        logger.info({
          success: true,
          document_id: returnData.document['id'],
          content_length: returnData.document['content']?.length,
          version_number: versionNumber
        }, '[UPDATE DOC] Returning to AI:');

        return returnData;
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

    listDocumentVersions: tool({
      description: 'List all versions of a specific document',
      inputSchema: z.object({
        document_id: z.string().describe('The document ID to get versions for'),
      }),
      execute: async ({ document_id }) => {
        if (!userId) {
          throw new Error('User must be authenticated to view versions');
        }

        const versionService = new ItemsService('application_content_versions', { accountability, schema });

        const versions = await versionService.readByQuery({
          filter: { application_content_id: { _eq: document_id } },
          sort: ['-version_number'],
          fields: ['id', 'version_number', 'created_at', 'created_by', 'changes'],
        });

        return {
          success: true,
          versions,
          count: versions.length,
          message: `Found ${versions.length} versions for document`,
        };
      },
    }),

    restoreDocumentVersion: tool({
      description: 'Restore a document to a previous version. This will replace the current content with the selected version and create a new version record.',
      inputSchema: z.object({
        document_id: z.string().describe('The document to restore'),
        version_number: z.number().describe('The version number to restore to'),
      }),
      execute: async ({ document_id, version_number }) => {
        if (!userId) {
          throw new Error('User must be authenticated to restore versions');
        }

        const versionService = new ItemsService('application_content_versions', { accountability, schema });

        // Find the version to restore
        const versions = await versionService.readByQuery({
          filter: {
            application_content_id: { _eq: document_id },
            version_number: { _eq: version_number }
          },
          limit: 1,
        });

        if (versions.length === 0) {
          return {
            success: false,
            error: `Version ${version_number} not found for this document`,
          };
        }

        const versionToRestore = versions[0] as any;

        // Update the application_content with restored content
        const service = new ItemsService('application_content', { accountability, schema });
        await service.updateOne(document_id, {
          content: versionToRestore.content,
          content_blocks: versionToRestore.content_blocks,
          updated_at: new Date(),
          updated_by: userId,
        });

        // Read updated document to get the actual restored state
        const document = await service.readOne(document_id);

        // Create a new version with the restored content (follows n-version pattern)
        const newVersionNumber = await createVersion(
          document_id,
          document['content'], // Use actual content from database
          document['content_blocks'], // Use actual blocks from database
          `Restored to version ${version_number}`,
          userId,
          accountability,
          schema
        );

        return {
          success: true,
          document: {
            id: document['id'],
            title: document['title'],
            content: document['content'],
            updated_at: document['updated_at'],
          },
          restored_from_version: version_number,
          new_version_number: newVersionNumber,
          message: `Document restored to version ${version_number} (created new version ${newVersionNumber})`,
        };
      },
    }),

    // GRANT AND NGO INFORMATION TOOLS (for context only)
    getCurrentGrantInfo: tool({
      description: 'PRIORITY TOOL: Get complete grant information including ALL requirements, submission guidelines, and formatting requirements from internal database AND uploaded grant documents. ALWAYS use this BEFORE considering web search. After calling this tool, ALWAYS respond to the user with what you found.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!applicationContext?.grant_id) {
          throw new Error('Grant context required');
        }

        // Import the RAG service to get comprehensive grant details including documents
        const { enhancedRAGService } = await import('../enhanced-rag-service.js');

        // Get complete grant details (basic info + simple document metadata)
        const grantDetails = await enhancedRAGService.getGrantDetailsWithDocuments(
          applicationContext.grant_id
        );

        // Use AI to extract detailed requirements from documents
        // This is expensive but only called when tool is explicitly invoked
        const aiExtractedRequirements = await enhancedRAGService.getGrantRequirementsWithAI(
          applicationContext.grant_id
        );

        // Combine requirements from ALL sources
        const dbRequirements = grantDetails.info.extracted_requirements || [];
        const metadataRequirements = grantDetails.info.metadata?.requirements || [];
        const simpleDocRequirements = grantDetails.requirements_matrix || [];

        // Prioritize AI-extracted requirements (most detailed and accurate)
        const allRequirements = [
          ...aiExtractedRequirements,      // AI-extracted from documents (most comprehensive)
          ...dbRequirements,                // From extraction service
          ...metadataRequirements,          // From manual metadata
          ...simpleDocRequirements          // Simple keyword matches (fallback)
        ].filter((req, index, self) =>
          // Deduplicate by checking first 50 chars
          self.findIndex(r => r.substring(0, 50) === req.substring(0, 50)) === index
        );

        return {
          success: true,
          grant: {
            basic_info: {
              name: grantDetails.info.name,
              provider: grantDetails.info.provider,
              category: grantDetails.info.category,
              deadline: grantDetails.info.deadline,
              amount_min: grantDetails.info.amount_min,
              amount_max: grantDetails.info.amount_max,
              currency: grantDetails.info.currency,
            },
            requirements: allRequirements,
            submission_guidelines: grantDetails.submission_guidelines,
            formatting_requirements: grantDetails.formatting_requirements,
            language_requirements: grantDetails.language_requirements,
            eligibility: grantDetails.info.metadata?.eligibility || [],
            focus_areas: grantDetails.info.focus_areas || grantDetails.info.metadata?.focus_areas || [],
            documents_analyzed: grantDetails.documents?.length || 0,
            deadlines: grantDetails.deadlines || [],
          },
          message: `Retrieved complete information for grant: ${grantDetails.info.name} (${allRequirements.length} requirements from ${aiExtractedRequirements.length} AI-extracted + ${grantDetails.documents?.length || 0} uploaded documents + database)`,
        };
      },
    }),

    getCurrentNGOInfo: tool({
      description: 'PRIORITY TOOL: Get complete NGO information including capabilities, track record, and past applications from internal database. ALWAYS use this BEFORE considering web search. After calling this tool, ALWAYS respond to the user with what you found.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!applicationContext?.ngo_id) {
          throw new Error('NGO context required');
        }

        const db = getDatabase();
        const service = new ItemsService('ngos', { accountability, schema });

        // Read NGO with all organization details joined
        const ngo = await service.readOne(applicationContext.ngo_id, {
          fields: [
            '*',
            'organization_id.id',
            'organization_id.name',
            'organization_id.company_name',
            'organization_id.billing_address',
            'organization_id.domain_name',
            'organization_id.website_url',
            'organization_id.contact_email',
            'organization_id.contact_phone',
            'organization_id.contact_name',
            'organization_id.logo',
            'organization_id.registration_number',
            'organization_id.status',
            'organization_id.metadata'
          ]
        });

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

        // Extract organization info from joined data
        const organizationInfo = ngo['organization_id'] || {};
        const organizationName = organizationInfo['name'] || 'Unknown Organization';

        return {
          success: true,
          ngo: {
            basic_info: {
              organization_name: organizationName,
              company_name: organizationInfo['company_name'],
              field_of_work: ngo['field_of_work'],
              company_size: ngo['company_size'],
              location: ngo['location'],
              about: ngo['about'],
            },
            contact_info: {
              contact_email: organizationInfo['contact_email'],
              contact_phone: organizationInfo['contact_phone'],
              contact_name: organizationInfo['contact_name'],
              website_url: organizationInfo['website_url'],
            },
            legal_info: {
              legal_entity: ngo['legal_entity'],
              tax_id: ngo['tax_id'],
              registration_number: organizationInfo['registration_number'],
              billing_address: organizationInfo['billing_address'],
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
          message: `Retrieved NGO information for ${organizationName} (${totalApps} past applications, ${successRate}% success rate)`,
        };
      },
    }),

    // DATABASE SEARCH TOOLS (with web search fallback)
    searchNGOs: tool({
      description: 'Search for NGOs in the internal database. If no results found and web_fallback is enabled, this tool will AUTOMATICALLY search the web - do NOT call searchWeb() separately. After calling this tool, ALWAYS respond to the user with the results.',
      inputSchema: z.object({
        query: z.string().describe('Search query for NGO name or description'),
        field_of_work: z.string().optional().describe('Filter by field of work'),
        location: z.string().optional().describe('Filter by location'),
        web_fallback: z.boolean().optional().default(true).describe('Automatically search web if no database results (default: true)'),
      }),
      execute: async ({ query, field_of_work, location, web_fallback }) => {
        const db = getDatabase();

        try {
          // First search the database using direct Knex query with JOIN
          // ItemsService doesn't handle relational filters well, so we use Knex directly
          let dbQuery = db('ngos')
            .join('yp_organizations', 'ngos.organization_id', 'yp_organizations.id')
            .select(
              'ngos.*',
              'yp_organizations.id as org_id',
              'yp_organizations.name as organization_name',
              'yp_organizations.company_name',
              'yp_organizations.billing_address',
              'yp_organizations.domain_name',
              'yp_organizations.website_url',
              'yp_organizations.contact_email',
              'yp_organizations.contact_phone',
              'yp_organizations.contact_name',
              'yp_organizations.logo',
              'yp_organizations.registration_number',
              'yp_organizations.status as org_status',
              'yp_organizations.metadata as org_metadata'
            )
            .where(function () {
              this.where('yp_organizations.name', 'ilike', `%${query}%`)
                .orWhere('yp_organizations.company_name', 'ilike', `%${query}%`)
                .orWhere('ngos.about', 'ilike', `%${query}%`);
            });

          if (field_of_work) {
            dbQuery = dbQuery.andWhere('ngos.field_of_work', 'ilike', `%${field_of_work}%`);
          }

          if (location) {
            dbQuery = dbQuery.andWhere('ngos.location', 'ilike', `%${location}%`);
          }

          const dbResults = await dbQuery.limit(10);

          // If we found results in database, return them
          if (dbResults.length > 0) {
            return {
              success: true,
              source: 'database',
              results: dbResults,
              count: dbResults.length,
              database_count: dbResults.length,
              web_search_performed: false,
              message: `Found ${dbResults.length} NGO${dbResults.length > 1 ? 's' : ''} in internal database matching "${query}". All contact information is included in the results. DO NOT search the web.`,
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
                database_count: 0,
                web_search_performed: true,
                message: `No NGOs found in internal database for "${query}". I already searched the web and found some information (results included above). DO NOT call searchWeb() again.`,
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

        } catch (error: any) {
          // Database query error - return error message
          return {
            success: false,
            source: 'error',
            message: `Database search error: ${error.message}`,
            error: error.message,
          };
        }
      },
    }),

    searchGrants: tool({
      description: 'Search for grants in the internal database including matched grants for the current NGO. If no results found and web_fallback is enabled, this tool will AUTOMATICALLY search the web - do NOT call searchWeb() separately. After calling this tool, ALWAYS respond to the user with the results.',
      inputSchema: z.object({
        query: z.string().describe('Search query for grant name or description'),
        category: z.string().optional().describe('Filter by category'),
        provider: z.string().optional().describe('Filter by provider'),
        min_amount: z.number().optional().describe('Minimum funding amount'),
        web_fallback: z.boolean().optional().default(true).describe('Automatically search web if no database results (default: true)'),
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

          let message = `Found ${totalCount} grant${totalCount !== 1 ? 's' : ''} in internal database matching "${query}"`;
          if (matchedCount > 0) {
            message += ` (${matchedCount} already analyzed for this NGO with match scores)`;
          }
          message += `. All grant information is included in the results. DO NOT search the web.`;

          return {
            success: true,
            source: 'database',
            results: allResults,
            matched_grants_count: matchedCount,
            total_count: totalCount,
            database_count: totalCount,
            web_search_performed: false,
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
              database_count: 0,
              web_search_performed: true,
              message: `No grants found in internal database for "${query}". I already searched the web and found some information (results included above). DO NOT call searchWeb() again.`,
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

    getApplicationAttachments: tool({
      description: 'List and/or read attachments (PDFs, documents, previous applications) uploaded to this application. Use when user references "my files", "my previous application", "annual report", etc. Can list all files OR read specific file content.',
      inputSchema: z.object({
        attachment_id: z.string().optional().describe('Specific attachment ID to read. If omitted, returns list of all attachments.'),
        filename_search: z.string().optional().describe('Search for attachment by partial filename (case-insensitive). Returns matching file with content.'),
        include_content: z.boolean().optional().default(false).describe('Include extracted text content. Default false for listing, true when reading specific file.'),
        max_content_length: z.number().optional().default(10000).describe('Maximum content length in characters (default 10000 for token efficiency)'),
      }),
      execute: async ({ attachment_id, filename_search, include_content, max_content_length }) => {
        if (!applicationContext?.application_id) {
          throw new Error('Application context required');
        }

        logger.info('[GET ATTACHMENTS] Tool called:', {
          mode: attachment_id ? 'single' : filename_search ? 'search' : 'list',
          attachment_id,
          filename_search,
          include_content,
          max_content_length,
          application_id: applicationContext.application_id
        });

        const db = getDatabase();

        // Query all attachments for current application with extracted content
        const attachments = await db('application_attachments')
          .leftJoin('yp_files', 'application_attachments.file_id', 'yp_files.id')
          .leftJoin('document_extracts', 'yp_files.id', 'document_extracts.file_id')
          .where('application_attachments.application_id', applicationContext.application_id)
          .select(
            'application_attachments.id as attachment_id',
            'yp_files.id as file_id',
            'yp_files.filename_download',
            'yp_files.filename_disk',
            'yp_files.type',
            'yp_files.filesize',
            'document_extracts.content_text',
            'document_extracts.word_count',
            'document_extracts.page_count',
            'document_extracts.extracted_at',
            'application_attachments.created_at'
          )
          .orderBy('application_attachments.created_at', 'desc');

        logger.info('[GET ATTACHMENTS] Query results:', {
          count: attachments.length,
          files: attachments.map(a => ({ filename: a.filename_download, has_content: !!a.content_text }))
        });

        // MODE: List all attachments
        if (!attachment_id && !filename_search) {
          return {
            success: true,
            mode: 'list',
            attachments: attachments.map(att => ({
              attachment_id: att.attachment_id,
              filename: att.filename_download,
              type: att.type,
              size_kb: Math.round(att.filesize / 1024),
              has_extracted_content: !!att.content_text,
              status: att.extracted_at ? 'ready' : 'processing',
              uploaded_at: att.created_at,
              word_count: att.word_count,
              page_count: att.page_count,
              content_preview: include_content && att.content_text ? att.content_text.substring(0, 200) + '...' : undefined
            })),
            count: attachments.length,
            message: `Found ${attachments.length} attachment(s) in this application`,
          };
        }

        // MODE: Search by filename
        if (filename_search) {
          const matched = attachments.filter(att =>
            att.filename_download.toLowerCase().includes(filename_search.toLowerCase())
          );

          if (matched.length === 0) {
            return {
              success: false,
              error: `No attachments found matching "${filename_search}"`,
              available_files: attachments.map(a => a.filename_download)
            };
          }

          if (matched.length > 1) {
            return {
              success: false,
              multiple_matches: true,
              matches: matched.map(m => ({
                attachment_id: m.attachment_id,
                filename: m.filename_download,
                type: m.type,
                uploaded_at: m.created_at
              })),
              message: `Found ${matched.length} files matching "${filename_search}". Please specify which one to read by providing the exact attachment_id.`,
            };
          }

          // Single match - proceed to read it
          attachment_id = matched[0].attachment_id;
        }

        // MODE: Read specific attachment by ID
        const file = attachments.find(att => att.attachment_id === attachment_id);

        if (!file) {
          return {
            success: false,
            error: `Attachment with ID "${attachment_id}" not found in this application`,
            available_attachments: attachments.map(a => ({ id: a.attachment_id, filename: a.filename_download }))
          };
        }

        // Check if content is available
        if (!file.content_text) {
          return {
            success: false,
            attachment: {
              attachment_id: file.attachment_id,
              filename: file.filename_download,
              type: file.type,
              status: 'processing'
            },
            message: `File "${file.filename_download}" is still being processed. Try again in a moment.`,
          };
        }

        // Return file with content
        const truncatedContent = file.content_text.substring(0, max_content_length);
        const isTruncated = file.content_text.length > max_content_length;

        logger.info('[GET ATTACHMENTS] Returning content:', {
          filename: file.filename_download,
          original_length: file.content_text.length,
          truncated_length: truncatedContent.length,
          is_truncated: isTruncated
        });

        return {
          success: true,
          mode: 'single',
          attachment: {
            attachment_id: file.attachment_id,
            filename: file.filename_download,
            type: file.type,
            size_kb: Math.round(file.filesize / 1024),
            word_count: file.word_count,
            page_count: file.page_count,
            uploaded_at: file.created_at,
            content: truncatedContent,
            content_truncated: isTruncated,
            original_length: file.content_text.length,
            truncated_length: truncatedContent.length
          },
          message: `Retrieved content from "${file.filename_download}"${isTruncated ? ' (truncated to ' + max_content_length + ' chars for token efficiency)' : ''}`,
        };
      },
    }),

  };
}