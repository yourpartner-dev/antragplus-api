import { generateObject } from 'ai';
import { z } from 'zod';
import { getGrantExtractionModel } from '../providers.js';
import { useLogger } from '../../../helpers/logger/index.js';
import getDatabase from '../../../database/index.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';

const logger = useLogger();

// Schema for extracted grant data - aligned with grants table structure
const GrantExtractionSchema = z.object({
  // Priority 1: Essential fields
  name: z.string().describe('Official grant name/title - should be descriptive and specific'),
  provider: z.string().describe('Organization/foundation providing the grant'),
  description: z.string().describe(`AI-generated comprehensive grant description in MARKDOWN FORMAT covering exactly 3 mandatory topics:
**1. Thematic & Strategic Scope**
Focus areas, target groups, eligible activities, strategic alignment

**2. Applicant Eligibility** 
Legal form requirements, geographic scope, exclusion criteria, capacity requirements

**3. Financial Framework**
Funding type, category, grant size ranges, funding rate, eligible/ineligible costs

Each section must be formatted with bold markdown headings (**Section Name**) and proper line breaks between sections.`),
  deadline: z.string().optional().describe('Application deadline in YYYY-MM-DD format'),
  amount_min: z.number().optional().describe('Minimum grant amount (numbers only, no currency symbols)'),
  amount_max: z.number().optional().describe('Maximum grant amount (numbers only, no currency symbols)'),
  currency: z.string().default('EUR').describe('Currency code (EUR, USD, GBP, etc.)'),
  
  // Priority 2: Important fields
  category: z.string().optional().describe('Grant category: Education, Healthcare, Environment, Social Services, Arts & Culture, Technology, Research, Community Development, Human Rights, Emergency Relief'),
  type: z.string().optional().describe('Grant type: Project-based, Operating, Capacity Building, Research, Emergency, Infrastructure, Training'),
  eligibility_criteria: z.string().optional().describe('Detailed eligibility requirements and who can apply'),
  duration_months: z.number().optional().describe('Project/grant duration in months'),
  status: z.string().default('active').describe('Grant status: active, upcoming, closed, archived, draft'),
  
  // Priority 3: Detailed process information
  application_process: z.string().optional().describe('Step-by-step application process and how to apply'),
  evaluation_criteria: z.string().optional().describe('How applications will be evaluated and selection criteria'),
  reporting_requirements: z.string().optional().describe('Post-funding reporting requirements and obligations'),
  required_documents: z.array(z.string()).optional().describe('List of required documents for application'),
  
  // Priority 4: Metadata and language
  language: z.string().default('en-US').describe('Primary language of the grant documents (de-DE for German, en-US for English, etc.)'),
  
  // New dedicated fields (moved from metadata to proper columns)
  location: z.string().optional().describe('Geographic location where NGO should be (e.g. specific region in Germany or EU)'),
  reference_number: z.string().optional().describe('Official reference number for documentation and reference'),
  contact_person: z.string().optional().describe('Person responsible for this grant'),
  contact_number: z.string().optional().describe('Phone number of responsible person'),
  contact_email: z.string().optional().describe('Email of reference person'),
  company_size: z.string().optional().describe('Size of companies that can apply (1-10, 11-50, etc.)'),
  funding_frequency: z.string().optional().describe('How often they fund NGOs (annually, quarterly, etc.)'),
  decision_timeline: z.string().optional().describe('When they will likely make a decision'),
  year_of_program_establishment: z.number().optional().describe('When the grant program was established'),

  // Additional metadata that goes into grants.metadata JSONB column
  metadata: z.object({
    webinar_link: z.string().optional(),
    faq_link: z.string().optional(),
    previous_projects: z.string().optional().describe('Examples of previously funded projects or success stories mentioned in the documents'),
    notes: z.string().optional().describe('Additional strategic advice, tips, or recommendations on how to increase chances of success with this grant application')
  }).optional().describe('Additional grant metadata including success tips and project examples'),
  
  // Document processing metadata (not stored in grants table)
  document_metadata: z.array(z.object({
    filename: z.string(),
    description: z.string().describe('100-200 character description of this document'),
    document_type: z.string().describe('guidelines, template, example, requirements, or other')
  })).describe('Metadata for each uploaded document')
});

export interface ExtractGrantOptions {
  file_ids: string[];
  created_by: string;
  accountability: Accountability | null;
  schema: SchemaOverview;
}

export interface ExtractedGrantData {
  grant: z.infer<typeof GrantExtractionSchema>;
  confidence: number;
  raw_text: string;
}

export class GrantExtractionService {
  private accountability: Accountability | null;
  private schema: SchemaOverview;

  constructor(options: { accountability: Accountability | null; schema: SchemaOverview }) {
    this.accountability = options.accountability;
    this.schema = options.schema;
  }

  /**
   * Extract structured grant information from already-parsed document extracts
   * This method reads from document_extracts table, not from raw files
   */
  async extractGrantFromDocuments(options: ExtractGrantOptions): Promise<ExtractedGrantData> {
    const { file_ids, created_by } = options;
    const knex = getDatabase();

    try {
      // 1. Get file information and their extracted content
      const documentsWithExtracts = await knex('yp_files')
        .leftJoin('document_extracts', 'yp_files.id', 'document_extracts.file_id')
        .whereIn('yp_files.id', file_ids)
        .select(
          'yp_files.id as file_id',
          'yp_files.filename_download',
          'yp_files.filename_disk', 
          'yp_files.type',
          'document_extracts.content_text',
          'document_extracts.word_count',
          'document_extracts.page_count',
          'document_extracts.metadata as extract_metadata'
        );

      if (documentsWithExtracts.length === 0) {
        throw new Error('No files found with provided IDs');
      }

      // 2. Check for missing document extracts
      const missingExtracts = documentsWithExtracts.filter(doc => !doc.content_text);
      if (missingExtracts.length > 0) {
        const missingFileNames = missingExtracts.map(doc => doc.filename_download || doc.filename_disk).join(', ');
        throw new Error(`Document extracts not found for files: ${missingFileNames}. Please ensure documents are processed first.`);
      }

      // 3. Prepare extracted texts for AI analysis
      const extractedTexts = documentsWithExtracts
        .filter(doc => doc.content_text)
        .map(doc => ({
          filename: doc.filename_download || doc.filename_disk,
          text: doc.content_text,
          word_count: doc.word_count,
          page_count: doc.page_count,
          file_id: doc.file_id
        }));

      // 4. Combine all text for AI analysis
      const combinedText = extractedTexts
        .map(doc => `--- Document: ${doc.filename} (${doc.word_count} words, ${doc.page_count} pages) ---\n${doc.text}`)
        .join('\n\n');

      // 5. Use AI to extract structured grant information with enhanced prompt
      const result = await generateObject({
        model: getGrantExtractionModel(),
        schema: GrantExtractionSchema,
        prompt: `You are an expert grant analyst specializing in comprehensive grant document analysis. Extract detailed grant information from the provided documents.

CRITICAL REQUIREMENTS:

1. DESCRIPTION FIELD: Generate a comprehensive, structured description in MARKDOWN FORMAT covering exactly these 3 mandatory topics:
   
   Format each section with bold markdown headings and proper spacing:
   
   **1. Thematic & Strategic Scope**
   
   [Detailed content about focus areas, target groups, eligible activities, etc.]
   
   **2. Applicant Eligibility**
   
   [Detailed content about legal requirements, geographic scope, exclusion criteria, etc.]
   
   **3. Financial Framework**
   
   [Detailed content about funding type, grant sizes, funding rates, eligible costs, etc.]
   
   CRITICAL FORMATTING REQUIREMENTS:
   - Use **bold markdown** for section headings followed by TWO newlines (\n\n)
   - Add TWO newlines (\n\n) between all paragraphs and sections
   - Use bullet points with proper spacing where appropriate
   - Each section must be separated by double newlines for proper markdown rendering
   - Example format:
     **1. Thematic & Strategic Scope**\n\nDetailed content here.\n\nMore content in new paragraph.\n\n**2. Applicant Eligibility**\n\nContent here...

2. FIELD EXTRACTION RULES:
   - Extract ONLY information that is explicitly stated in the documents
   - For amounts: extract numerical values only (no currency symbols)
   - For deadline: format as YYYY-MM-DD if mentioned
   - For required_documents: list specific documents mentioned as application requirements
   - For contact information: extract contact_person, contact_email, contact_number as separate fields
   - For location: extract geographic requirements (regions, countries) into the location field
   - For reference_number: extract official program/grant reference numbers
   - For company_size: extract eligible organization sizes
   - For funding_frequency: extract how often grants are awarded
   - For decision_timeline: extract decision timeframes
   - For year_of_program_establishment: extract when the program started (as number)
   - For metadata.webinar_link and metadata.faq_link: extract any web links mentioned
   - For metadata.previous_projects: extract examples of previously funded projects, success stories, or case studies
   - For metadata.notes: extract strategic advice, application tips, or recommendations for increasing success chances
   - If information is not found, leave optional fields empty (do not guess or infer)

3. QUALITY STANDARDS:
   - Be thorough but accurate
   - Use the exact language from the documents where possible
   - Structure the description clearly with headings for each of the 3 topics
   - Ensure the name is descriptive and specific to this grant opportunity

Documents to analyze (${extractedTexts.length} files, ${extractedTexts.reduce((sum, doc) => sum + doc.word_count, 0)} total words):
${combinedText}

File list for document_metadata:
${extractedTexts.map(doc => doc.filename).join(', ')}`,
        temperature: 0.2, // Lower temperature for more consistent extraction
      });

      // 6. Calculate confidence based on essential fields
      const essentialFields = ['name', 'provider', 'description'];
      const extractedEssentials = essentialFields.filter(field => {
        const value = result.object[field as keyof typeof result.object];
        return value && value !== '' && value !== null;
      });
      
      const totalExtractedFields = Object.values(result.object).filter(v => 
        v !== null && v !== undefined && v !== '' && 
        (typeof v !== 'object' || (Array.isArray(v) && v.length > 0) || Object.keys(v).length > 0)
      ).length;
      
      const confidence = (extractedEssentials.length / essentialFields.length) * 0.7 + 
                        (totalExtractedFields / Object.keys(GrantExtractionSchema.shape).length) * 0.3;

      // 7. Log the extraction with detailed metadata (only if user_id is provided)
      if (created_by) {
        await knex('ai_activity_logs').insert({
          user_id: created_by,
          activity_type: 'grant_extraction',
          entity_type: 'grants',
          description: `Extracted structured grant data from ${extractedTexts.length} documents`,
          metadata: {
            file_ids,
            confidence: Math.round(confidence * 100) / 100,
            extracted_fields: totalExtractedFields,
            total_fields: Object.keys(GrantExtractionSchema.shape).length,
            essential_fields_found: extractedEssentials.length,
            total_word_count: extractedTexts.reduce((sum, doc) => sum + doc.word_count, 0),
            document_count: extractedTexts.length
          },
          created_at: new Date()
        });
      } else {
        logger.info(`Grant extraction completed for ${extractedTexts.length} documents with confidence ${Math.round(confidence * 100)}% (no user_id for activity log)`);
      }

      // Debug logging to see what was extracted
      logger.info(`Grant extraction completed with ${Math.round(confidence * 100)}% confidence:`, {
        name: result.object.name || 'NOT_EXTRACTED',
        provider: result.object.provider || 'NOT_EXTRACTED', 
        has_description: !!result.object.description,
        description_length: result.object.description?.length || 0,
        total_fields_extracted: totalExtractedFields,
        essential_fields_extracted: extractedEssentials.length
      });

      return {
        grant: result.object,
        confidence,
        raw_text: combinedText
      };

    } catch (error) {
      logger.error(error, 'Error extracting grant from document extracts');
      throw error;
    }
  }

  /**
   * Update an existing grant with extracted data
   */
  async updateGrantWithExtractedData(
    grantId: string,
    extractedData: ExtractedGrantData,
    file_ids: string[],
    updated_by: string
  ): Promise<any> {
    const knex = getDatabase();
    
    try {
      // Start transaction
      const result = await knex.transaction(async (trx) => {
        // 1. Update the grant with extracted data
        const { document_metadata, metadata: aiMetadata, ...baseGrantFields } = extractedData.grant;
        
        // Clean up data types for database insertion
        const cleanGrantFields = {
          ...baseGrantFields,
          // Convert empty date strings or non-date text to null for PostgreSQL
          deadline: baseGrantFields.deadline && baseGrantFields.deadline.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(baseGrantFields.deadline.trim())
            ? baseGrantFields.deadline 
            : null,
          // Ensure numbers are properly handled
          amount_min: baseGrantFields.amount_min || null,
          amount_max: baseGrantFields.amount_max || null,
          duration_months: baseGrantFields.duration_months || null,
          year_of_program_establishment: baseGrantFields.year_of_program_establishment || null,
          // Convert array to PostgreSQL text array format if needed
          required_documents: Array.isArray(baseGrantFields.required_documents) 
            ? baseGrantFields.required_documents.filter(doc => doc && doc.trim() !== '')
            : null,
          // Clean string fields - convert empty strings to null
          location: baseGrantFields.location && baseGrantFields.location.trim() !== '' ? baseGrantFields.location : null,
          reference_number: baseGrantFields.reference_number && baseGrantFields.reference_number.trim() !== '' ? baseGrantFields.reference_number : null,
          contact_person: baseGrantFields.contact_person && baseGrantFields.contact_person.trim() !== '' ? baseGrantFields.contact_person : null,
          contact_number: baseGrantFields.contact_number && baseGrantFields.contact_number.trim() !== '' ? baseGrantFields.contact_number : null,
          contact_email: baseGrantFields.contact_email && baseGrantFields.contact_email.trim() !== '' ? baseGrantFields.contact_email : null,
          company_size: baseGrantFields.company_size && baseGrantFields.company_size.trim() !== '' ? baseGrantFields.company_size : null,
          funding_frequency: baseGrantFields.funding_frequency && baseGrantFields.funding_frequency.trim() !== '' ? baseGrantFields.funding_frequency : null,
          decision_timeline: baseGrantFields.decision_timeline && baseGrantFields.decision_timeline.trim() !== '' ? baseGrantFields.decision_timeline : null,
        };
        
        const grantUpdateData = {
          ...cleanGrantFields,
          updated_at: new Date(),
          updated_by,
          // Set status to active when extraction is successful
          status: 'active',
          // Merge AI-extracted metadata with system metadata
          metadata: {
            ...(aiMetadata || {}), // Additional metadata like webinar_link, faq_link
            extraction_confidence: extractedData.confidence,
            extracted_at: new Date(),
            source_files: file_ids
          }
        };

        // Debug the data being sent to database
        logger.info(`Updating grant ${grantId} with data:`, {
          deadline: grantUpdateData.deadline,
          amount_min: grantUpdateData.amount_min,
          amount_max: grantUpdateData.amount_max,
          required_documents_type: typeof grantUpdateData.required_documents,
          required_documents_length: Array.isArray(grantUpdateData.required_documents) 
            ? grantUpdateData.required_documents.length 
            : 'not_array'
        });

        const [grant] = await trx('grants')
          .where('id', grantId)
          .update(grantUpdateData)
          .returning('*');

        if (!grant) {
          throw new Error(`Grant ${grantId} not found`);
        }

        // 2. Update grant_documents metadata with AI-generated descriptions
        if (document_metadata && document_metadata.length > 0) {
          for (let i = 0; i < document_metadata.length && i < file_ids.length; i++) {
            const fileId = file_ids[i];
            const metadata = document_metadata[i];
            
            // Note: grant_documents table doesn't have updated_at column
            await trx('grant_documents')
              .where('grant_id', grantId)
              .where('file_id', fileId)
              .update({
                metadata: {
                  description: metadata?.description || 'Grant document',
                  ai_generated_description: true,
                  document_type: metadata?.document_type
                }
              });
          }
        }

        // 3. Queue for embedding generation/update
        await trx('embedding_queue').insert({
          source_table: 'grants',
          source_id: grantId,
          operation: 'update',
          priority: 3, // Higher priority for grants
          status: 'pending',
          created_at: new Date()
        }).onConflict(['source_table', 'source_id', 'operation']).merge({
          status: 'pending',
          created_at: new Date()
        });

        return grant;
      });

      logger.info(`Successfully updated grant ${result.id} with extracted data from ${file_ids.length} documents`);
      return result;

    } catch (error) {
      logger.error(error, 'Error updating grant with extracted data');
      throw error;
    }
  }

  /**
   * Update existing grant with additional documents
   */
  async updateGrantWithDocuments(
    grantId: string,
    file_ids: string[],
    created_by: string
  ): Promise<any> {
    const knex = getDatabase();

    try {
      // Extract information from new documents
      const extractedData = await this.extractGrantFromDocuments({
        file_ids,
        created_by,
        accountability: this.accountability,
        schema: this.schema
      });

      // Get existing grant
      const existingGrant = await knex('grants').where('id', grantId).first();
      if (!existingGrant) {
        throw new Error('Grant not found');
      }

      // Merge extracted data with existing (prefer new data for non-empty fields)
      const { document_metadata, metadata: aiMetadata, ...grantFields } = extractedData.grant;
      const updates: any = {};
      
      for (const [key, value] of Object.entries(grantFields)) {
        if (value !== null && value !== undefined && value !== '') {
          // Handle string fields - trim and convert empty to null
          if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed !== '') {
              updates[key] = trimmed;
            }
          } else {
            updates[key] = value;
          }
        }
      }

      // Update grant if there are changes
      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date();
        updates.updated_by = created_by;
        
        await knex('grants')
          .where('id', grantId)
          .update(updates);
      }

      // Add new documents
      const documentLinks = [];
      const existingDocsCount = await knex('grant_documents')
        .where('grant_id', grantId)
        .count('id as count');

      let displayOrder = parseInt(existingDocsCount[0]?.['count'] as string || '0');

      for (let i = 0; i < file_ids.length; i++) {
        const fileId = file_ids[i];
        const metadata = extractedData.grant.document_metadata?.[i];
        
        documentLinks.push({
          grant_id: grantId,
          file_id: fileId,
          document_type: metadata?.document_type || 'additional',
          is_required: false,
          display_order: displayOrder + i,
          metadata: {
            description: metadata?.description || 'Additional grant document',
            ai_generated_description: true
          },
          created_at: new Date(),
          created_by
        });
      }

      if (documentLinks.length > 0) {
        await knex('grant_documents').insert(documentLinks);
      }

      // Re-queue for embedding update
      await knex('embedding_queue').insert({
        source_table: 'grants',
        source_id: grantId,
        operation: 'update',
        priority: 3,
        status: 'pending',
        created_at: new Date()
      }).onConflict(['source_table', 'source_id', 'operation']).merge({
        status: 'pending',
        created_at: new Date()
      });

      return await knex('grants').where('id', grantId).first();

    } catch (error) {
      logger.error(error, 'Error updating grant with documents');
      throw error;
    }
  }
}

export const grantExtractionService = new GrantExtractionService({
  accountability: null,
  schema: {} as SchemaOverview
});