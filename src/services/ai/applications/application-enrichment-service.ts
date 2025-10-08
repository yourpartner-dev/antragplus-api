import { generateObject } from 'ai';
import { z } from 'zod';
import { getGrantExtractionModel } from '../providers.js';
import { useLogger } from '../../../helpers/logger/index.js';
import getDatabase from '../../../database/index.js';

const logger = useLogger();

// Schema for enriched application data extracted from grant documents
const ApplicationEnrichmentSchema = z.object({
  requested_amount: z.number().optional().describe('Recommended funding amount to request based on grant max amount and project scope'),
  submission_date: z.string().optional().describe('Expected submission date in YYYY-MM-DD format (use grant deadline if available)'),
  decision_date: z.string().optional().describe('Expected decision date in YYYY-MM-DD format (calculate from submission_date + decision_timeline)'),

  timeline: z.object({
    phases: z.array(z.object({
      name: z.string().describe('Phase name (e.g., "Preparation", "Implementation", "Evaluation")'),
      duration_months: z.number().describe('Duration of this phase in months'),
      description: z.string().optional().describe('Brief description of what happens in this phase'),
      start_month: z.number().optional().describe('Start month relative to project start (0-based)'),
    })).describe('Project timeline broken into phases based on grant requirements'),
    total_duration_months: z.number().optional().describe('Total project duration in months'),
  }).optional().describe('Project timeline structured as phases'),

  budget_breakdown: z.object({
    categories: z.array(z.object({
      name: z.string().describe('Budget category name (e.g., "Personnel", "Materials", "Travel")'),
      amount: z.number().describe('Amount allocated to this category'),
      description: z.string().optional().describe('Brief description of what this covers'),
    })).describe('Budget categories based on grant requirements and typical project needs'),
    total: z.number().optional().describe('Total budget amount (should match requested_amount)'),
  }).optional().describe('Budget breakdown by category'),
});

export interface EnrichApplicationOptions {
  application_id: string;
  grant_id: string;
}

export interface EnrichedApplicationData {
  enrichment: z.infer<typeof ApplicationEnrichmentSchema>;
  confidence: number;
  source: string;
}

export class ApplicationEnrichmentService {
  constructor() {
    // Service uses direct Knex queries, no accountability/schema needed
  }

  /**
   * Enrich application with data extracted from grant documents
   */
  async enrichApplication(options: EnrichApplicationOptions): Promise<EnrichedApplicationData | null> {
    const { application_id, grant_id } = options;
    const knex = getDatabase();

    try {
      logger.info(`Starting application enrichment for application ${application_id} from grant ${grant_id}`);

      // 1. Get grant basic info
      const grant = await knex('grants')
        .where('id', grant_id)
        .first();

      if (!grant) {
        logger.warn(`Grant ${grant_id} not found for enrichment`);
        return null;
      }

      // 2. Get application basic info
      const application = await knex('applications')
        .where('id', application_id)
        .first();

      if (!application) {
        logger.warn(`Application ${application_id} not found for enrichment`);
        return null;
      }

      // 3. Check if already enriched (idempotency)
      if (application.metadata?.enriched_at) {
        logger.info(`Application ${application_id} already enriched at ${application.metadata.enriched_at}, skipping`);
        return null;
      }

      // 4. Get grant documents with extracted content
      const grantDocuments = await knex('grant_documents')
        .join('yp_files', 'grant_documents.file_id', 'yp_files.id')
        .leftJoin('document_extracts', 'yp_files.id', 'document_extracts.file_id')
        .where('grant_documents.grant_id', grant_id)
        .select(
          'yp_files.filename_download',
          'document_extracts.content_text',
          'document_extracts.word_count',
          'grant_documents.document_type'
        );

      // 5. Filter documents with content and combine text
      const documentsWithContent = grantDocuments.filter(doc => doc.content_text);

      if (documentsWithContent.length === 0) {
        logger.warn(`No grant documents with extracted content found for grant ${grant_id}, cannot enrich`);
        return null;
      }

      const combinedDocumentText = documentsWithContent
        .map(doc => `--- ${doc.filename_download} (${doc.document_type || 'document'}) ---\n${doc.content_text}`)
        .join('\n\n');

      // 6. Build enrichment prompt
      const prompt = this.buildEnrichmentPrompt(grant, application, combinedDocumentText);

      // 7. Use AI to extract enrichment data
      const result = await generateObject({
        model: getGrantExtractionModel(),
        schema: ApplicationEnrichmentSchema,
        prompt,
        temperature: 0.2, // Lower temperature for consistent extraction
      });

      // 8. Calculate confidence
      const extractedFields = Object.values(result.object).filter(v =>
        v !== null && v !== undefined &&
        (typeof v !== 'object' || Object.keys(v).length > 0)
      ).length;
      const totalFields = Object.keys(ApplicationEnrichmentSchema.shape).length;
      const confidence = extractedFields / totalFields;

      logger.info(`Application enrichment completed with ${Math.round(confidence * 100)}% confidence (${extractedFields}/${totalFields} fields)`);

      return {
        enrichment: result.object,
        confidence,
        source: `grant_documents (${documentsWithContent.length} files)`
      };

    } catch (error) {
      logger.error(error, `Error enriching application ${application_id}`);
      return null;
    }
  }

  /**
   * Update application with enriched data
   */
  async updateApplicationWithEnrichment(
    applicationId: string,
    enrichedData: EnrichedApplicationData
  ): Promise<void> {
    const knex = getDatabase();

    try {
      const { enrichment, confidence, source } = enrichedData;

      // Build update payload - only include fields that were extracted
      const updates: any = {
        updated_at: new Date(),
      };

      // Add extracted fields to update
      if (enrichment.requested_amount) {
        updates.requested_amount = enrichment.requested_amount;
      }

      if (enrichment.submission_date && /^\d{4}-\d{2}-\d{2}$/.test(enrichment.submission_date)) {
        updates.submission_date = enrichment.submission_date;
      }

      if (enrichment.decision_date && /^\d{4}-\d{2}-\d{2}$/.test(enrichment.decision_date)) {
        updates.decision_date = enrichment.decision_date;
      }

      if (enrichment.timeline) {
        updates.timeline = enrichment.timeline;
      }

      if (enrichment.budget_breakdown) {
        updates.budget_breakdown = enrichment.budget_breakdown;
      }

      // Update metadata to mark as enriched
      const existingMetadata = (await knex('applications')
        .where('id', applicationId)
        .select('metadata')
        .first())?.metadata || {};

      updates.metadata = {
        ...existingMetadata,
        enriched_at: new Date().toISOString(),
        enrichment_confidence: Math.round(confidence * 100),
        enrichment_source: source,
      };

      // Perform update
      await knex('applications')
        .where('id', applicationId)
        .update(updates);

      logger.info(`Application ${applicationId} updated with enrichment data:`, {
        fields_updated: Object.keys(updates).filter(k => k !== 'metadata' && k !== 'updated_at'),
        confidence: Math.round(confidence * 100),
      });

    } catch (error) {
      logger.error(error, `Error updating application ${applicationId} with enrichment`);
      throw error;
    }
  }

  /**
   * Main method: Enrich and update application in one go
   */
  async enrichAndUpdateApplication(options: EnrichApplicationOptions): Promise<boolean> {
    try {
      const enrichedData = await this.enrichApplication(options);

      if (!enrichedData) {
        logger.info(`No enrichment data extracted for application ${options.application_id}`);
        return false;
      }

      await this.updateApplicationWithEnrichment(options.application_id, enrichedData);
      return true;

    } catch (error) {
      logger.error(error, `Failed to enrich and update application ${options.application_id}`);
      return false;
    }
  }

  /**
   * Build comprehensive prompt for AI enrichment
   */
  private buildEnrichmentPrompt(grant: any, application: any, documentText: string): string {
    return `You are an expert grant analyst. Extract application planning data from grant documents.

GRANT INFORMATION:
- Name: ${grant.name}
- Provider: ${grant.provider}
- Amount Range: €${grant.amount_min || 0} - €${grant.amount_max || 0}
- Deadline: ${grant.deadline || 'Not specified'}
- Duration: ${grant.duration_months || 'Not specified'} months
- Decision Timeline: ${grant.decision_timeline || 'Not specified'}

APPLICATION CONTEXT:
- Project Title: ${application.project_title || 'Not specified'}
- Project Description: ${application.project_description || 'Not specified'}

GRANT DOCUMENTS (${documentText.length} characters):
${documentText.substring(0, 15000)} ${documentText.length > 15000 ? '[... truncated for brevity]' : ''}

EXTRACTION TASK:
Extract the following information to help plan this grant application:

1. **requested_amount**:
   - Look for recommended project sizes in the documents
   - Consider the grant's max amount (€${grant.amount_max})
   - Suggest a realistic amount based on project scope

2. **submission_date**:
   - Use the grant deadline if available: ${grant.deadline || 'unknown'}
   - Format as YYYY-MM-DD

3. **decision_date**:
   - Calculate from submission_date + decision timeline
   - Decision timeline: ${grant.decision_timeline || 'typically 2-3 months'}
   - Format as YYYY-MM-DD

4. **timeline**:
   - Extract typical project phases from grant requirements
   - Structure as phases with duration and descriptions
   - Total duration: ${grant.duration_months || 12} months

5. **budget_breakdown**:
   - Extract budget categories mentioned in grant documents
   - Look for eligible cost categories
   - Structure by category with realistic amounts
   - Total should align with requested_amount

RULES:
- Extract ONLY information explicitly or implicitly stated in the documents
- For dates: use YYYY-MM-DD format
- For amounts: numbers only (no currency symbols)
- If information is not available, leave the field empty
- Be realistic and conservative with amounts
- Budget categories should reflect grant requirements

Begin extraction now.`;
  }
}

export const applicationEnrichmentService = new ApplicationEnrichmentService();
