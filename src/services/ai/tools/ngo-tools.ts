import { z } from 'zod';
import { tool } from 'ai';
import { TavilyClient } from 'tavily';
import getDatabase from '../../../database/index.js';
import { nanoid } from 'nanoid';
import { useLogger } from '../../../helpers/logger/index.js';
import { useEnv } from '../../../helpers/env/index.js';

const logger = useLogger();
const env = useEnv();

// Initialize Tavily client once
const TAVILY_API_KEY = env['TAVILY_API_KEY'] as string;
if (!TAVILY_API_KEY) {
  logger.warn('TAVILY_API_KEY is not configured - NGO search functionality will be limited');
}

const tavilyClient = new TavilyClient({
  apiKey: TAVILY_API_KEY || '',
});

/**
 * Standalone function for searching NGO information
 * Can be called directly without AI SDK tool context
 */
export async function searchNGOInformation(params: {
  website_url?: string;
  ngo_name?: string;
  search_query?: string;
}) {
  const { website_url, ngo_name } = params;

  try {
    // Check if Tavily API key is configured
    if (!TAVILY_API_KEY) {
      logger.warn('Tavily API key not configured, returning mock data');
      return {
        success: false,
        message: 'Search API not configured. Please configure TAVILY_API_KEY environment variable.',
        error: 'TAVILY_API_KEY not configured',
      };
    }
    // Prepare base information for multi-step deep search
    let domain = '';
    if (website_url) {
      try {
        domain = new URL(website_url).hostname.replace('www.', '');
      } catch (e) {
        logger.warn('Invalid URL provided:', website_url);
      }
    }

    // Generate targeted queries for each specific field we need
    const searchQueries = [];
    const nameQuery = ngo_name || domain || '';

    // Query for each specific field we want to extract
    // Add instruction to return just the value without explanatory text
    const fieldQueries = [
      {
        query: `What is the mission and about information for ${nameQuery}? Return just the mission/about text.`,
        field: 'about',
        depth: 'basic'
      },
      {
        query: `What is the location address city country of ${nameQuery}? Return just the address.`,
        field: 'location',
        depth: 'basic'
      },
      {
        query: `What is the contact email address of ${nameQuery}? Return just the email address.`,
        field: 'contact_email',
        depth: 'basic'
      },
      {
        query: `What is the contact phone number of ${nameQuery}? Return just the phone number.`,
        field: 'contact_phone',
        depth: 'basic'
      },
      {
        query: `What is the legal entity type (e.V., gGmbH, foundation) of ${nameQuery}? Return just the entity type.`,
        field: 'legal_entity',
        depth: 'basic'
      },
      {
        query: `What is the field of work sector industry of ${nameQuery}? Return just the field/sector.`,
        field: 'field_of_work',
        depth: 'basic'
      },
      {
        query: `What is the company team size number of employees of ${nameQuery}? Return just the number or range.`,
        field: 'company_size',
        depth: 'basic'
      },
      {
        query: `What type of funding grants does ${nameQuery} receive or apply for? Return just the funding types.`,
        field: 'funding_type',
        depth: 'basic'
      },
      {
        query: `What is the typical grant application funding amount size for ${nameQuery}? Return just the amount.`,
        field: 'application_size',
        depth: 'basic'
      },
      {
        query: `What is the tax ID VAT number of ${nameQuery}? Return just the tax ID or VAT number.`,
        field: 'tax_id',
        depth: 'basic'
      },
      {
        query: `What is the registration number of ${nameQuery}? Return just the registration number.`,
        field: 'registration_number',
        depth: 'basic'
      },
      {
        query: `Who is the contact person name at ${nameQuery}? Return just the person's name.`,
        field: 'contact_name',
        depth: 'basic'
      }
    ];

    // Add website-specific query if we have a domain
    if (domain) {
      fieldQueries.unshift({
        query: `site:${domain} about mission`,
        field: 'website_info',
        depth: 'advanced'
      });
    }

    searchQueries.push(...fieldQueries);

    // Execute all searches concurrently for efficiency
    logger.info(`Executing ${searchQueries.length} deep searches for ${ngo_name || domain}`);

    const searchPromises = searchQueries.map(async ({ query, field, depth }) => {
      try {
        const result = await tavilyClient.search({
          query,
          search_depth: depth as 'basic' | 'advanced',
          max_results: depth === 'advanced' ? 5 : 2,
          include_answer: true,
          include_raw_content: false, // We mainly want the answer for targeted queries
        });
        return { field, result };
      } catch (error) {
        logger.warn(`Search failed for ${field}:`, error);
        return { field, result: null };
      }
    });

    const allSearchResults = await Promise.all(searchPromises);

    // Process search results and directly extract field values
    const extractedInfo: any = {};
    let websiteInfo = '';
    const allResults = [];

    // Process each field-specific search result
    for (const { field, result } of allSearchResults) {
      if (result && result.answer) {
        // For targeted queries, the answer IS the extracted value
        if (field === 'website_info') {
          websiteInfo = result.answer;
          // Also use this for about if we don't get a better answer
          if (!extractedInfo.about) {
            extractedInfo.about = result.answer.substring(0, 1000);
          }
        } else {
          // Directly use the answer for the field but clean it up
          let cleanAnswer = result.answer.trim().replace(/\s+/g, ' ');

          // Post-process to extract just the key value from verbose responses
          // Remove common prefixes like "The contact email for X is..." 
          if (field === 'contact_email') {
            // Extract just the email from verbose text
            const emailMatch = cleanAnswer.match(/[\w.-]+@[\w.-]+\.\w+/);
            if (emailMatch) {
              cleanAnswer = emailMatch[0];
            }
          } else if (field === 'contact_phone') {
            // Extract just the phone number
            const phoneMatch = cleanAnswer.match(/[\+\d\s\(\)-]+/);
            if (phoneMatch && phoneMatch[0].length >= 10) {
              cleanAnswer = phoneMatch[0].trim();
            }
          } else if (field === 'location') {
            // Remove "is located at" or similar prefixes
            cleanAnswer = cleanAnswer.replace(/.*(?:is located at|is based in|address is|location is)\s*/i, '');
            // Remove trailing periods and extra text
            cleanAnswer = cleanAnswer?.split('.')[0]?.trim() || '';
          } else if (field === 'legal_entity') {
            // Extract just the entity type
            const entityMatch = cleanAnswer.match(/\b(e\.V\.|gGmbH|GmbH|gUG|UG|AG|Foundation|Stiftung|non-profit|NGO)\b/i);
            if (entityMatch) {
              cleanAnswer = entityMatch[0];
            }
          } else if (field === 'company_size') {
            // Extract just the number or range
            const sizeMatch = cleanAnswer.match(/\d+(?:-\d+)?(?:\s*employees)?|\d+\+/);
            if (sizeMatch) {
              cleanAnswer = sizeMatch[0].replace('employees', '').trim();
            }
          } else if (field === 'tax_id') {
            // Extract just the ID number
            const idMatch = cleanAnswer.match(/\b[A-Z]{2}\d{9,11}\b|\b\d{9,15}\b/);
            if (idMatch) {
              cleanAnswer = idMatch[0];
            }
          } else if (field === 'registration_number') {
            // Match common German registration patterns like "HRB 236252 B", "VR 12345", "HRA 123456"
            const registrationPattern = cleanAnswer.match(/\b(?:HRB|HRA|VR|GnR|PR)\s*\d+\s*[A-Z]?\b/i);
            if (registrationPattern) {
              cleanAnswer = registrationPattern[0];
            } else {
              // Fallback: look for any pattern with 2-3 letters followed by numbers and optional letter
              const fallbackPattern = cleanAnswer.match(/\b[A-Z]{2,3}\s*\d{4,10}\s*[A-Z]?\b/);
              if (fallbackPattern) {
                cleanAnswer = fallbackPattern[0];
              }
            }
          } else if (field === 'contact_name') {
            // Remove "The contact person is" type prefixes
            cleanAnswer = cleanAnswer.replace(/.*(?:contact person is|contact name is|person at.*is)\s*/i, '');
            // Take just the name, not email or other info
            cleanAnswer = cleanAnswer?.split(/[,\.]|Her |His |Their |Email/)[0]?.trim() || '';
          } else if (field === 'application_size') {
            // Extract just the amount
            const amountMatch = cleanAnswer.match(/[\$€]\s*[\d,]+(?:\.\d+)?(?:k|K|M|million)?|\d+(?:,\d+)*(?:\s*(?:USD|EUR|dollars|euros))?/);
            if (amountMatch) {
              cleanAnswer = amountMatch[0];
            }
          }

          // Store the cleaned answer
          if (cleanAnswer && cleanAnswer.length > 1) {
            extractedInfo[field] = cleanAnswer.substring(0, 500);

            // Map to additional fields as needed
            if (field === 'location') {
              extractedInfo.billing_address = cleanAnswer;
            }
            if (field === 'contact_email') {
              extractedInfo.email = cleanAnswer; // Legacy field
            }
            if (field === 'contact_phone') {
              extractedInfo.phone = cleanAnswer; // Legacy field
            }
          }
        }

        // Collect all search results for reference
        if (result.results) {
          allResults.push(...result.results);
        }
      }
    }

    // Create consolidated searchResults object for the AI response
    const searchResults = {
      answer: websiteInfo || Object.values(extractedInfo).filter(v => v).join('\n'),
      results: allResults,
      additionalInfo: extractedInfo // Direct field mappings
    };

    // Add basic info we already have
    if (website_url) {
      extractedInfo.website_url = website_url;
    }
    if (domain) {
      extractedInfo.domain_name = domain;
    }

    // Set company_name if provided or derive from domain
    if (ngo_name) {
      extractedInfo.company_name = ngo_name;
    } else if (domain) {
      // Derive a basic name from domain (e.g., visioneers.berlin -> Visioneers)
      const domainName = domain.split('.')[0];
      if (domainName) {
        // Capitalize first letter
        extractedInfo.company_name = domainName.charAt(0).toUpperCase() + domainName.slice(1);
      }
    }

    // Additional processing for specific fields if needed
    // Since we're using targeted queries, most extraction is already done

    // Process company size to match our enum values
    if (extractedInfo.company_size) {
      const sizeText = extractedInfo.company_size.toLowerCase();

      // Map to standard size ranges
      if (sizeText.includes('1-10') || sizeText.includes('small') || /\b[1-9]\b/.test(sizeText)) {
        extractedInfo.company_size = '1-10';
      } else if (sizeText.includes('11-50') || sizeText.includes('medium')) {
        extractedInfo.company_size = '11-50';
      } else if (sizeText.includes('51-200')) {
        extractedInfo.company_size = '51-200';
      } else if (sizeText.includes('201-500')) {
        extractedInfo.company_size = '201-500';
      } else if (sizeText.includes('500+') || sizeText.includes('large')) {
        extractedInfo.company_size = '500+';
      }
    }

    // Add description if we have about text
    if (extractedInfo.about && !extractedInfo.description) {
      extractedInfo.description = extractedInfo.about.substring(0, 255);
    }

    // No more complex extraction needed - we already have everything from targeted queries
    // Clean up extracted info - remove any null/undefined values
    const cleanedExtractedInfo: any = {};
    for (const [key, value] of Object.entries(extractedInfo)) {
      if (value !== null && value !== undefined && value !== '') {
        cleanedExtractedInfo[key] = value;
      }
    }

    // Return a structured result that prompts the AI to respond
    return {
      success: true,
      extractedInfo: cleanedExtractedInfo,
      searchResults: {
        answer: searchResults.answer,
        results: searchResults.results.map((r: any) => ({
          title: r.title,
          url: r.url,
          content: r.content,
        })),
      },
      message: 'Successfully searched and extracted NGO information',
      instruction: 'Now present this information to the user in a friendly way, showing what was found and what is still missing.',
    };
  } catch (error) {
    logger.error(error, `Error searching NGO website for ${website_url || ngo_name || 'unknown'}:`);
    return {
      success: false,
      message: 'Failed to search for NGO information',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Define NGO-specific tools for the chat AI
 */
export function getNGOTools(options: {
  userId: string | null;
}) {
  const { userId } = options;

  return {
    // Search web for NGO information
    searchNGOWebsite: tool({
      description: 'Search the web for information about an NGO using their website or name',
      inputSchema: z.object({
        website_url: z.string().optional().describe('The NGO website URL to search'),
        ngo_name: z.string().optional().describe('The NGO name to search for'),
        search_query: z.string().optional().describe('Additional search query terms'),
      }),
      execute: async ({ website_url, ngo_name, search_query }) => {
        // Use the standalone function, filtering out undefined values
        return searchNGOInformation({
          ...(website_url && { website_url }),
          ...(ngo_name && { ngo_name }),
          ...(search_query && { search_query }),
        });
      },
    }),

    // Create or update NGO with extracted information
    createOrUpdateNGO: tool({
      description: 'Create a new NGO or update existing NGO with extracted information',
      inputSchema: z.object({
        organization_id: z.string().optional().describe('Organization ID if updating'),
        // Organization fields
        company_name: z.string().describe('Company/NGO name'),
        billing_address: z.string().optional().describe('Billing address'),
        domain_name: z.string().optional().describe('Domain name'),
        website_url: z.string().optional().describe('Website URL'),
        contact_email: z.string().optional().describe('Contact email'),
        contact_phone: z.string().optional().describe('Contact phone'),
        contact_name: z.string().optional().describe('Contact person name'),
        registration_number: z.string().optional().describe('Registration number'),
        // NGO specific fields
        description: z.string().optional().describe('Brief description'),
        about: z.string().optional().describe('About the NGO'),
        location: z.string().optional().describe('NGO location'),
        legal_entity: z.string().optional().describe('Legal entity type'),
        field_of_work: z.string().optional().describe('Field of work'),
        company_size: z.string().optional().describe('Company size range'),
        tax_id: z.string().optional().describe('Tax ID'),
        funding_type: z.string().optional().describe('Types of funding sought'),
        application_size: z.string().optional().describe('Typical application size'),
      }),
      execute: async (data) => {
        if (!userId) {
          throw new Error('User must be authenticated to create/update NGOs');
        }

        const knex = getDatabase();

        try {
          // Start transaction for atomic operations
          const result = await knex.transaction(async (trx) => {
            let organizationId: string;

            if (data.organization_id) {
              // Update existing organization
              await trx('yp_organizations')
                .where('id', data.organization_id)
                .update({
                  name: data.company_name,
                  company_name: data.company_name,
                  billing_address: data.billing_address || data.location,
                  domain_name: data.domain_name,
                  website_url: data.website_url,
                  contact_email: data.contact_email,
                  contact_phone: data.contact_phone,
                  contact_name: data.contact_name,
                  registration_number: data.registration_number,
                  status: 'active',
                  metadata: JSON.stringify({
                    source: 'ngo_chat',
                    extracted: true,
                  }),
                  updated_at: new Date(),
                  updated_by: userId,
                });
              organizationId = data.organization_id;
            } else {
              // Create new organization
              const organizations: any = await trx('yp_organizations').insert({
                name: data.company_name,
                company_name: data.company_name,
                billing_address: data.billing_address || data.location,
                domain_name: data.domain_name,
                website_url: data.website_url,
                contact_email: data.contact_email,
                contact_phone: data.contact_phone,
                contact_name: data.contact_name,
                registration_number: data.registration_number,
                status: 'active',
                metadata: JSON.stringify({
                  source: 'ngo_chat',
                  extracted: true,
                }),
                created_at: new Date(),
                created_by: userId,
              }).returning('id');

              organizationId = organizations.id;
            }
            // Check if NGO entry exists for this organization
            let ngo = await trx('ngos')
              .where('organization_id', organizationId)
              .first();

            if (ngo) {
              // Update existing NGO
              await trx('ngos')
                .where('id', ngo.id)
                .update({
                  name: data.company_name,
                  description: data.description || data.about,
                  about: data.about,
                  location: data.location,
                  legal_entity: data.legal_entity,
                  field_of_work: data.field_of_work,
                  company_size: data.company_size,
                  tax_id: data.tax_id,
                  funding_type: data.funding_type,
                  application_size: data.application_size,
                  website_url: data.website_url,
                  contact_email: data.contact_email,
                  contact_phone: data.contact_phone,
                  updated_at: new Date(),
                  updated_by: userId,
                });

              // Fetch updated record
              ngo = await trx('ngos')
                .where('id', ngo.id)
                .first();
            } else {
              // Create new NGO
              const ngoId = nanoid();
              await trx('ngos').insert({
                id: ngoId,
                organization_id: organizationId,
                name: data.company_name,
                description: data.description || data.about,
                about: data.about,
                location: data.location,
                legal_entity: data.legal_entity,
                field_of_work: data.field_of_work,
                company_size: data.company_size,
                tax_id: data.tax_id,
                funding_type: data.funding_type,
                application_size: data.application_size,
                website_url: data.website_url,
                contact_email: data.contact_email,
                contact_phone: data.contact_phone,
                status: 'active',
                created_at: new Date(),
                created_by: userId,
              });

              // Fetch created record
              ngo = await trx('ngos')
                .where('id', ngoId)
                .first();
            }

            return {
              success: true,
              organization_id: organizationId,
              ngo_id: ngo?.id || null,
              ngo,
              message: `NGO "${data.company_name}" ${data.organization_id ? 'updated' : 'created'} successfully`,
            };
          });

          return result;
        } catch (error) {
          logger.error(error, 'Error creating/updating NGO:');
          return {
            success: false,
            message: 'Failed to create/update NGO',
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
    }),

    // Validate NGO information
    validateNGOData: tool({
      description: 'Validate and check completeness of NGO data',
      inputSchema: z.object({
        company_name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        location: z.string().optional(),
        website_url: z.string().optional(),
      }),
      execute: async (data) => {
        const validation = {
          isValid: true,
          missingFields: [] as string[],
          invalidFields: [] as string[],
          warnings: [] as string[],
        };

        // Check required fields
        if (!data.company_name) {
          validation.missingFields.push('company_name');
          validation.isValid = false;
        }

        // Validate email format
        if (data.email) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(data.email)) {
            validation.invalidFields.push('email');
            validation.isValid = false;
          }
        } else {
          validation.warnings.push('Email is recommended for communication');
        }

        // Validate phone format (basic check)
        if (data.phone) {
          const phoneRegex = /^[\d\s\-\+\(\)]+$/;
          if (!phoneRegex.test(data.phone) || data.phone.length < 7) {
            validation.invalidFields.push('phone');
            validation.isValid = false;
          }
        }

        // Validate website URL
        if (data.website_url) {
          try {
            new URL(data.website_url);
          } catch {
            validation.invalidFields.push('website_url');
            validation.isValid = false;
          }
        }

        // Check for recommended fields
        if (!data.location) {
          validation.warnings.push('Location helps with grant matching');
        }

        return {
          success: true,
          validation,
          message: validation.isValid
            ? 'NGO data is valid and complete'
            : 'NGO data needs attention',
        };
      },
    }),
  };
}