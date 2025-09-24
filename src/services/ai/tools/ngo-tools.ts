import { z } from 'zod';
import { tool } from 'ai';
import { generateText } from 'ai';
import { getOpenAIModel } from '../providers.js';
import { TavilyClient } from 'tavily';
import getDatabase from '../../../database/index.js';
import { nanoid } from 'nanoid';
import { useLogger } from '../../../helpers/logger/index.js';
import { useEnv } from '../../../helpers/env/index.js';
import { fetchNGOInformation, type NGOExtractionResult } from './ngo-fetch-tool.js';

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
  force_proceed?: boolean;
}): Promise<NGOExtractionResult | any> {
  const { website_url } = params;

  try {
    // FIRST PRIORITY: Try direct website fetch if URL is provided
    if (website_url) {
      logger.info(`Attempting direct fetch for website: ${website_url}`);
      const fetchResult = await fetchNGOInformation(website_url);

      if (fetchResult.success && fetchResult.confidence && fetchResult.confidence > 0.6) {
        logger.info(`Direct fetch successful with ${Math.round(fetchResult.confidence * 100)}% confidence`);
        return {
          success: true,
          extractedInfo: fetchResult.extractedInfo,
          searchResults: {
            answer: `Information extracted directly from ${website_url}`,
            results: [{
              title: 'Organization Website',
              url: website_url,
              content: 'Direct website extraction'
            }]
          },
          message: `${fetchResult.message} (direct fetch method)`,
          method: 'direct_fetch',
          confidence: fetchResult.confidence
        };
      } else {
        logger.info(`Direct fetch had low confidence (${fetchResult.confidence}), falling back to search method`);
      }
    }

    // FALLBACK: Use original search-based method
    logger.info('Using search-based extraction method');
    return await searchNGOInformationWithSearch(params);
  } catch (error) {
    logger.error(error, 'Error in NGO information search');
    return {
      success: false,
      message: 'Failed to extract NGO information',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Original search-based NGO information extraction (renamed for clarity)
 */
async function searchNGOInformationWithSearch(params: {
  website_url?: string;
  ngo_name?: string;
  search_query?: string;
  force_proceed?: boolean;
}) {
  const { website_url, ngo_name, force_proceed } = params;

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
        // Add protocol if missing
        const urlToProcess = website_url.startsWith('http') ? website_url : `https://${website_url}`;
        domain = new URL(urlToProcess).hostname.replace('www.', '');
      } catch (e) {
        logger.warn('Invalid URL provided:', website_url);
      }
    }

    // Generate targeted queries for each specific field we need
    const searchQueries = [];
    const nameQuery = ngo_name || domain || '';

    // Early return if we have no search terms
    if (!nameQuery) {
      return {
        success: false,
        message: 'Please provide either a website URL or NGO name to search for.',
        error: 'No search terms provided',
      };
    }

    // LAYER 1: Silent Organization Type Detection (no tool state triggered)
    logger.info(`Silently detecting organization type for ${nameQuery}`);

    const typeDetectionQuery = domain
      ? `site:${domain} impressum about school gymnasium university company NGO nonprofit business government institution`
      : `"${nameQuery}" school gymnasium university company NGO nonprofit business government institution type`;

    let typeDetectionResult;
    try {
      typeDetectionResult = await tavilyClient.search({
        query: typeDetectionQuery,
        search_depth: 'advanced',
        max_results: 5,
        include_answer: true,
        include_raw_content: true,
      });
    } catch (error: any) {
      if (error.response?.status === 432) {
        return {
          success: false,
          message: 'Tavily API authentication failed. Please check your TAVILY_API_KEY configuration.',
          error: 'Tavily API authentication error (432)',
        };
      }
      throw error; // Re-throw other errors for normal handling
    }

    const organizationType = await detectOrganizationType(typeDetectionResult.answer || '', nameQuery);
    logger.info(`Detected organization type: ${organizationType}`);

    // Pre-search validation: Return confirmation message for non-NGOs (unless forced)
    if (!force_proceed && (organizationType === 'school' || organizationType === 'company' || organizationType === 'government')) {
      return {
        success: true,
        requiresConfirmation: true,
        organizationType,
        message: `I noticed this appears to be a ${organizationType}. Are you sure you want me to search for NGO information about this organization?`,
        instruction: 'Ask the user to confirm if they want to proceed with NGO information extraction for this non-NGO organization. If they confirm, call this tool again with force_proceed: true.',
      };
    }

    // LAYER 2: Extract all fields for NGOs, nonprofits, or unknown organizations
    const fieldQueries = [
      {
        query: domain
          ? `site:${domain} ${nameQuery} mission about purpose what we do`
          : `"${nameQuery}" mission about purpose organization Germany`,
        field: 'about',
        depth: 'advanced'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} address location contact impressum`
          : `"${nameQuery}" address location contact Germany`,
        field: 'location',
        depth: 'basic'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} email contact impressum`
          : `"${nameQuery}" email contact Germany`,
        field: 'contact_email',
        depth: 'basic'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} phone telephone contact impressum`
          : `"${nameQuery}" phone telephone contact Germany`,
        field: 'contact_phone',
        depth: 'basic'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} legal entity type impressum`
          : `"${nameQuery}" legal entity type e.V. gGmbH Germany`,
        field: 'legal_entity',
        depth: 'basic'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} field work sector industry what we do`
          : `"${nameQuery}" field work sector what they do Germany`,
        field: 'field_of_work',
        depth: 'basic'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} team size employees staff how many`
          : `"${nameQuery}" team size employees staff Germany`,
        field: 'company_size',
        depth: 'basic'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} funding grants support donations`
          : `"${nameQuery}" funding grants support donations Germany`,
        field: 'funding_type',
        depth: 'basic'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} funding amount grant size budget`
          : `"${nameQuery}" funding amount grant size budget Germany`,
        field: 'application_size',
        depth: 'basic'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} tax ID VAT number impressum`
          : `"${nameQuery}" tax ID VAT number Germany`,
        field: 'tax_id',
        depth: 'basic'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} registration number HRB VR impressum`
          : `"${nameQuery}" registration number HRB VR Germany`,
        field: 'registration_number',
        depth: 'basic'
      },
      {
        query: domain
          ? `site:${domain} ${nameQuery} contact person director manager team`
          : `"${nameQuery}" contact person director manager Germany`,
        field: 'contact_name',
        depth: 'basic'
      }
    ];

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
        logger.error(error, `Search failed for ${field}`);
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
            extractedInfo.about = await extractFieldValueWithAI(result.answer, 'about');
          }
        } else {
          // Use AI-powered extraction for clean, accurate field values
          let cleanAnswer = await extractFieldValueWithAI(result.answer, field);

          // Store the cleaned answer (filter out "not found" responses)
          if (cleanAnswer && cleanAnswer.length > 1 && !cleanAnswer.toLowerCase().includes('not found') && !cleanAnswer.toLowerCase().includes('not relevant')) {
            extractedInfo[field] = cleanAnswer;

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

    // Add detected organization type
    extractedInfo.organization_type = organizationType;

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
      description: 'Analyze organization type and search for NGO information. First call analyzes if organization is an NGO. Second call (with force_proceed: true) performs actual NGO data extraction.',
      inputSchema: z.object({
        website_url: z.string().optional().describe('The NGO website URL to search'),
        ngo_name: z.string().optional().describe('The NGO name to search for'),
        search_query: z.string().optional().describe('Additional search query terms'),
        force_proceed: z.boolean().optional().describe('Set to true to bypass organization type confirmation and proceed with search'),
      }),
      execute: async ({ website_url, ngo_name, search_query, force_proceed }) => {
        // Use the standalone function, filtering out undefined values
        return searchNGOInformation({
          ...(website_url && { website_url }),
          ...(ngo_name && { ngo_name }),
          ...(search_query && { search_query }),
          ...(force_proceed && { force_proceed }),
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

/**
 * Extract specific field value using AI for clean, accurate results
 */
async function extractFieldValueWithAI(content: string, fieldName: string): Promise<string> {
  if (!content || content.trim().length === 0) {
    return '';
  }

  // Field-specific extraction prompts
  const extractionPrompts: Record<string, string> = {
    'about': 'Extract ONLY information about what this specific organization does. If the text does not contain information about the organization being searched for, return exactly "not found". Do not make up information.',
    'contact_email': 'Extract ONLY the email address from this text. Return just the email address or "not found". Do not make up email addresses.',
    'contact_phone': 'Extract ONLY the phone number from this text. Return just the phone number or "not found". Do not make up phone numbers.',
    'location': 'Extract ONLY the address or location from this text. Return just the address or "not found". Do not make up addresses.',
    'legal_entity': 'Extract ONLY the legal entity type (e.V., gGmbH, GmbH, etc.) from this text. Return just the entity type or "not found". Do not make up legal entity information.',
    'company_size': 'Extract ONLY the number of employees or team size from this text. Return just the number/range or "not found". Do not make up company size information.',
    'tax_id': 'Extract ONLY the tax ID, VAT number, or USt-ID from this text. Return just the ID number or "not found". Do not make up tax IDs.',
    'registration_number': 'Extract ONLY the registration number (HRB, VR, HRA, etc.) from this text. Return just the registration number or "not found". Do not make up registration numbers.',
    'contact_name': 'Extract ONLY the contact person\'s name from this text. Return just the person\'s name or "not found". Do not make up contact names.',
    'application_size': 'Extract ONLY the funding amount or grant size from this text. Return just the amount with currency or "not found". Do not make up funding amounts.',
    'funding_type': 'Extract ONLY the type of funding or grants mentioned in this text. Return just the funding type or "not found". Do not make up funding types.',
    'field_of_work': 'Extract ONLY the field of work or sector from this text. Return just the field/sector or "not found". Do not make up fields of work.',
  };

  const prompt = extractionPrompts[fieldName];
  if (!prompt) {
    // Fallback for unknown fields - just clean up the text
    return content.trim();
  }

  try {
    const result = await generateText({
      model: getOpenAIModel('gpt-4o-mini'), // Use cost-effective model from providers
      prompt: `${prompt}\n\nText: "${content}"`,
      maxRetries: 1,
      temperature: 0, // Deterministic for factual extraction
    });

    const extracted = result.text.trim();

    // Basic validation - if result is too long or contains explanatory text, fall back to simple cleanup
    if (extracted.length > 200 || extracted.toLowerCase().includes('the ') || extracted.toLowerCase().includes('from this text')) {
      // Fallback to simple regex for this field
      return fallbackExtraction(content, fieldName);
    }

    return extracted;
  } catch (error) {
    logger.warn(`AI extraction failed for ${fieldName}, falling back to regex:`, error);
    return fallbackExtraction(content, fieldName);
  }
}

/**
 * Fallback extraction using regex patterns (simplified version of original)
 */
function fallbackExtraction(content: string, fieldName: string): string {
  const text = content.trim().replace(/\s+/g, ' ');

  switch (fieldName) {
    case 'contact_email':
      const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
      return emailMatch ? emailMatch[0] : '';

    case 'contact_phone':
      const phoneMatch = text.match(/[\+\d\s\(\)-]{10,}/);
      return phoneMatch ? phoneMatch[0].trim() : '';

    case 'legal_entity':
      const entityMatch = text.match(/\b(e\.V\.|gGmbH|GmbH|gUG|UG|AG|Foundation|Stiftung)\b/i);
      return entityMatch ? entityMatch[0] : '';

    case 'registration_number':
      const registrationMatch = text.match(/\b(?:HRB|HRA|VR|GnR|PR)\s*\d+\s*[A-Z]?\b/i);
      return registrationMatch ? registrationMatch[0] : '';

    default:
      return text.trim();
  }
}

/**
 * Detect organization type using AI analysis
 */
async function detectOrganizationType(content: string, organizationName: string): Promise<string> {
  if (!content || content.trim().length === 0) {
    return 'unknown';
  }

  try {
    const result = await generateText({
      model: getOpenAIModel('gpt-4o-mini'),
      prompt: `Analyze this content about "${organizationName}" and determine what type of organization it is.

Content: "${content}"

IMPORTANT: Look for specific organizational indicators:
- If it mentions "school", "gymnasium", "university", "education", "students", "grades" → school
- If it mentions "e.V.", "gGmbH", "nonprofit", "charity", "foundation", "NGO" → NGO
- If it mentions "GmbH", "business", "products", "services", "commercial" → company
- If it mentions "government", "ministry", "public agency", "municipal" → government

Return ONLY one word:
- NGO
- school
- company
- government
- unknown

Just the single word, nothing else.`,
      maxRetries: 1,
      temperature: 0,
    });

    const detectedType = result.text.trim().toLowerCase();

    // Validate the response
    const validTypes = ['ngo', 'school', 'company', 'government', 'unknown'];
    if (validTypes.includes(detectedType)) {
      return detectedType;
    } else {
      return 'unknown';
    }
  } catch (error) {
    logger.warn('Organization type detection failed:', error);
    return 'unknown';
  }
}