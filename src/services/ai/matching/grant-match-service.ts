import { generateObject } from 'ai';
import { z } from 'zod';
import { getGrantMatchingModel } from '../providers.js';
import { useLogger } from '../../../helpers/logger/index.js';
import getDatabase from '../../../database/index.js';
import type { Accountability } from '../../../types/index.js';

const logger = useLogger();

// Schema for matching criteria scoring
const MatchingCriteriaSchema = z.object({
  mission_alignment: z.object({
    score: z.number().min(0).max(2.5).describe('Mission alignment score (0-2.5)'),
    evidence: z.array(z.string()).describe('Evidence supporting this score')
  }),
  experience_match: z.object({
    score: z.number().min(0).max(2.5).describe('Experience & track record score (0-2.5)'),
    evidence: z.array(z.string()).describe('Evidence supporting this score')
  }),
  eligibility_compliance: z.object({
    score: z.number().min(0).max(2.0).describe('Eligibility compliance score (0-2.0)'),
    evidence: z.array(z.string()).describe('Evidence supporting this score')
  }),
  financial_compatibility: z.object({
    score: z.number().min(0).max(1.5).describe('Financial & scale compatibility score (0-1.5)'),
    evidence: z.array(z.string()).describe('Evidence supporting this score')
  }),
  timing_readiness: z.object({
    score: z.number().min(0).max(1.5).describe('Strategic timing & readiness score (0-1.5)'),
    evidence: z.array(z.string()).describe('Evidence supporting this score')
  })
});

// Schema for overall match analysis
const GrantMatchAnalysisSchema = z.object({
  total_score: z.number().min(0).max(10).describe('Total match score (0-10)'),
  confidence_level: z.enum(['high', 'medium', 'low']).describe('Confidence in the analysis'),
  summary: z.string().describe('2-3 sentence summary of why this is/isn\'t a good match'),
  detailed_analysis: z.string().describe('Detailed analysis with strategic insights'),
  matching_criteria: MatchingCriteriaSchema,
  matching_points: z.array(z.string()).describe('ONLY specific points with clear evidence explaining why this grant matches the NGO. Leave empty if no genuine matches found.'),
  missing_points: z.array(z.string()).describe('ONLY specific requirements the NGO is actually missing based on evidence. Leave empty if no clear gaps identified.'),
  suggestions: z.array(z.string()).describe('ONLY actionable suggestions based on actual identified gaps. Leave empty if no concrete suggestions can be made.'),
  key_strengths: z.array(z.string()).describe('Key strengths of this match'),
  potential_challenges: z.array(z.string()).describe('Potential challenges or concerns'),
  recommendation: z.enum(['highly_recommended', 'recommended', 'consider', 'not_recommended']).describe('Overall recommendation'),
  next_steps: z.array(z.string()).describe('Suggested next steps for the NGO')
});

interface DocumentContent {
  file_id: string;
  content_text: string;
  extracted_at: Date;
  document_type?: string;
}

interface NGOData {
  id: string;
  organization_id: string;
  about: string;
  location: string;
  legal_entity: string;
  field_of_work: string;
  company_size: string;
  funding_type: string;
  application_size: string;
  documents: DocumentContent[];
}

interface GrantData {
  id: string;
  name: string;
  description: string;
  provider: string;
  category: string;
  type: string;
  amount_min: number;
  amount_max: number;
  deadline: Date;
  eligibility_criteria: string;
  location: string;
  company_size: string;
  documents: DocumentContent[];
}

export class GrantMatchService {
  private readonly db = getDatabase();

  /**
   * Get all documents linked to a grant
   */
  private async getGrantDocuments(grantId: string): Promise<DocumentContent[]> {
    try {
      const query = `
        SELECT
          f.id as file_id,
          de.content_text,
          de.extracted_at,
          f.type as document_type
        FROM grant_documents gd
        JOIN yp_files f ON gd.file_id = f.id
        LEFT JOIN document_extracts de ON f.id = de.file_id
        WHERE gd.grant_id = ?
          AND de.content_text IS NOT NULL
          AND de.content_text != ''
        ORDER BY de.extracted_at DESC
      `;

      const documents = await this.db.raw(query, [grantId]);
      return documents.rows || [];
    } catch (error) {
      logger.error(error, 'Error fetching grant documents');
      return [];
    }
  }

  /**
   * Get all documents linked to an NGO organization
   */
  private async getNGODocuments(organizationId: string): Promise<DocumentContent[]> {
    try {
      const query = `
        SELECT
          f.id as file_id,
          de.content_text,
          de.extracted_at,
          f.type as document_type
        FROM yp_files f
        LEFT JOIN document_extracts de ON f.id = de.file_id
        WHERE f.organization_id = ?
          AND de.content_text IS NOT NULL
          AND de.content_text != ''
        ORDER BY de.extracted_at DESC
      `;

      const documents = await this.db.raw(query, [organizationId]);
      return documents.rows || [];
    } catch (error) {
      logger.error(error, 'Error fetching NGO documents');
      return [];
    }
  }

  /**
   * Get NGO data with documents
   */
  private async getNGOData(ngoId: string): Promise<NGOData | null> {
    try {
      const ngoQuery = `
        SELECT
          n.*,
          o.name as organization_name
        FROM ngos n
        JOIN yp_organizations o ON n.organization_id = o.id
        WHERE n.id = ?
      `;

      const ngoResult = await this.db.raw(ngoQuery, [ngoId]);
      const ngo = ngoResult.rows?.[0];

      if (!ngo) {
        return null;
      }

      const documents = await this.getNGODocuments(ngo.organization_id);

      return {
        id: ngo.id,
        organization_id: ngo.organization_id,
        about: ngo.about || '',
        location: ngo.location || '',
        legal_entity: ngo.legal_entity || '',
        field_of_work: ngo.field_of_work || '',
        company_size: ngo.company_size || '',
        funding_type: ngo.funding_type || '',
        application_size: ngo.application_size || '',
        documents
      };
    } catch (error) {
      logger.error(error, 'Error fetching NGO data');
      return null;
    }
  }

  /**
   * Get grant data with documents
   */
  private async getGrantData(grantId: string): Promise<GrantData | null> {
    try {
      const grantQuery = `
        SELECT * FROM grants WHERE id = ?
      `;

      const grantResult = await this.db.raw(grantQuery, [grantId]);
      const grant = grantResult.rows?.[0];

      if (!grant) {
        return null;
      }

      const documents = await this.getGrantDocuments(grant.id);

      return {
        id: grant.id,
        name: grant.name || '',
        description: grant.description || '',
        provider: grant.provider || '',
        category: grant.category || '',
        type: grant.type || '',
        amount_min: grant.amount_min || 0,
        amount_max: grant.amount_max || 0,
        deadline: grant.deadline,
        eligibility_criteria: grant.eligibility_criteria || '',
        location: grant.location || '',
        company_size: grant.company_size || '',
        documents
      };
    } catch (error) {
      logger.error(error, 'Error fetching grant data');
      return null;
    }
  }

  /**
   * Analyze grant-NGO match using AI
   */
  private async analyzeGrantNGOMatch(
    ngoData: NGOData,
    grantData: GrantData
  ): Promise<z.infer<typeof GrantMatchAnalysisSchema> | null> {
    try {
      const ngoDocumentText = ngoData.documents
        .map(doc => `[${doc.document_type || 'Document'}]: ${doc.content_text}`)
        .join('\n\n---\n\n');

      const grantDocumentText = grantData.documents
        .map(doc => `[${doc.document_type || 'Document'}]: ${doc.content_text}`)
        .join('\n\n---\n\n');

      const analysisPrompt = `
You are an AI expert in grant matching. Analyze this NGO-Grant pair and provide a comprehensive match score and analysis.

## NGO Information:
**Database Fields:**
- About: ${ngoData.about}
- Field of Work: ${ngoData.field_of_work}
- Location: ${ngoData.location}
- Legal Entity: ${ngoData.legal_entity}
- Company Size: ${ngoData.company_size}
- Funding Type: ${ngoData.funding_type}
- Application Size: ${ngoData.application_size}

**Document Content:**
${ngoDocumentText || 'No documents available'}

## Grant Information:
**Database Fields:**
- Name: ${grantData.name}
- Provider: ${grantData.provider}
- Description: ${grantData.description}
- Category: ${grantData.category}
- Type: ${grantData.type}
- Amount Range: €${grantData.amount_min} - €${grantData.amount_max}
- Deadline: ${grantData.deadline}
- Eligibility Criteria: ${grantData.eligibility_criteria}
- Location: ${grantData.location}
- Company Size: ${grantData.company_size}

**Document Content:**
${grantDocumentText || 'No documents available'}

## Scoring Criteria (Total: 10 points):
1. **Mission Alignment (max 2.5 points)**: How well does the NGO's mission align with the grant's strategic priorities?
2. **Experience & Track Record (max 2.5 points)**: Does the NGO have relevant experience for this grant?
3. **Eligibility Compliance (max 2.0 points)**: Does the NGO meet all eligibility requirements?
4. **Financial & Scale Compatibility (max 1.5 points)**: Can the NGO handle this grant size/complexity?
5. **Strategic Timing & Readiness (max 1.5 points)**: Is the NGO ready to apply and execute?

For each criterion, provide a score and specific evidence from the data. Do not make up scores - base them only on clear evidence.

## CRITICAL INSTRUCTIONS:
- **matching_points**: ONLY include points with clear evidence from the provided data. If you cannot find specific evidence of alignment, leave this array EMPTY.
- **missing_points**: ONLY include requirements that are explicitly stated in the grant information and clearly missing from the NGO data. Do NOT make assumptions. Leave EMPTY if uncertain.
- **suggestions**: ONLY provide actionable suggestions based on actual identified gaps. Do NOT create generic advice. Leave EMPTY if no concrete suggestions can be made.
- Do NOT fabricate information or make assumptions beyond what is explicitly provided in the data.

Please provide a detailed analysis with specific evidence from both database fields and document content.
      `;

      const result = await generateObject({
        model: getGrantMatchingModel(),
        schema: GrantMatchAnalysisSchema,
        prompt: analysisPrompt,
        temperature: 0.3,
      });

      return result.object;
    } catch (error) {
      logger.error(error, 'Error analyzing grant-NGO match');
      return null;
    }
  }

  /**
   * Save match result to database
   */
  private async saveMatchResult(
    ngoId: string,
    grantId: string,
    analysis: z.infer<typeof GrantMatchAnalysisSchema>,
    grantData: GrantData
  ): Promise<boolean> {
    try {
      // Calculate expiry date (grant deadline + 7 days buffer)
      const expiresAt = new Date(grantData.deadline);
      expiresAt.setDate(expiresAt.getDate() + 7);

      const matchData = {
        ngo_id: ngoId,
        grant_id: grantId,
        match_score: analysis.total_score / 10, // Convert to 0-1 scale for database
        summary: analysis.summary,
        analysis: analysis.detailed_analysis,
        matching_criteria: JSON.stringify(analysis.matching_criteria),
        matching_points: analysis.matching_points,
        missing_points: analysis.missing_points,
        suggestions: analysis.suggestions,
        expires_at: expiresAt,
        metadata: JSON.stringify({
          document_analysis: true,
          key_strengths: analysis.key_strengths,
          potential_challenges: analysis.potential_challenges,
          recommendation: analysis.recommendation,
          confidence_level: analysis.confidence_level,
          next_steps: analysis.next_steps
        }),
        match_status: 'active',
        created_at: new Date(),
        updated_at: new Date()
      };

      // Use upsert to handle duplicate matches
      await this.db('grant_matches')
        .insert(matchData)
        .onConflict(['ngo_id', 'grant_id'])
        .merge({
          match_score: matchData.match_score,
          summary: matchData.summary,
          analysis: matchData.analysis,
          matching_criteria: matchData.matching_criteria,
          matching_points: matchData.matching_points,
          missing_points: matchData.missing_points,
          suggestions: matchData.suggestions,
          expires_at: matchData.expires_at,
          metadata: matchData.metadata,
          updated_at: new Date()
        });

      return true;
    } catch (error) {
      logger.error('Error saving match result:', error);
      return false;
    }
  }

  /**
   * Analyze and save a single grant-NGO match
   */
  public async analyzeMatch(
    ngoId: string,
    grantId: string,
    _accountability?: Accountability
  ): Promise<{ success: boolean; score?: number; analysis?: any }> {
    try {
      logger.info(`Starting grant match analysis: NGO ${ngoId} <-> Grant ${grantId}`);

      // Fetch data
      const [ngoData, grantData] = await Promise.all([
        this.getNGOData(ngoId),
        this.getGrantData(grantId)
      ]);

      if (!ngoData || !grantData) {
        throw new Error('Failed to fetch NGO or grant data');
      }

      // Perform AI analysis
      const analysis = await this.analyzeGrantNGOMatch(ngoData, grantData);
      if (!analysis) {
        throw new Error('Failed to analyze grant-NGO match');
      }

      // Save results
      const saved = await this.saveMatchResult(ngoId, grantId, analysis, grantData);
      if (!saved) {
        throw new Error('Failed to save match results');
      }

      logger.info(`Grant match analysis completed: Score ${analysis.total_score}/10, Recommendation: ${analysis.recommendation}`);

      return {
        success: true,
        score: analysis.total_score,
        analysis: analysis
      };
    } catch (error) {
      logger.error(error, 'Error in analyzeMatch:');
      return {
        success: false
      };
    }
  }

  /**
   * Analyze matches for all NGOs against a specific grant
   */
  public async analyzeGrantMatches(
    grantId: string,
    accountability?: Accountability
  ): Promise<{ success: boolean; matches_processed: number }> {
    try {
      logger.info(`Starting bulk match analysis for grant: ${grantId}`);

      // Get all active NGOs
      const ngosQuery = `
        SELECT id FROM ngos
        WHERE created_at IS NOT NULL
        ORDER BY created_at DESC
      `;

      const ngoResult = await this.db.raw(ngosQuery);
      const ngos = ngoResult.rows || [];

      let processedCount = 0;
      const batchSize = 5; // Process in small batches to avoid overload

      for (let i = 0; i < ngos.length; i += batchSize) {
        const batch = ngos.slice(i, i + batchSize);

        const batchPromises = batch.map((ngo: any) =>
          this.analyzeMatch(ngo.id, grantId, accountability)
        );

        await Promise.all(batchPromises);
        processedCount += batch.length;

        logger.info(`Processed ${processedCount}/${ngos.length} NGO matches for grant ${grantId}`);

        // Small delay between batches
        if (i + batchSize < ngos.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      logger.info(`Completed bulk match analysis for grant ${grantId}: ${processedCount} matches processed`);

      return {
        success: true,
        matches_processed: processedCount
      };
    } catch (error) {
      logger.error(error, 'Error in analyzeGrantMatches');
      return {
        success: false,
        matches_processed: 0
      };
    }
  }

  /**
   * Analyze matches for a specific NGO against all grants
   */
  public async analyzeNGOMatches(
    ngoId: string,
    accountability?: Accountability
  ): Promise<{ success: boolean; matches_processed: number }> {
    try {
      logger.info(`Starting bulk match analysis for NGO: ${ngoId}`);

      // Get all active grants
      const grantsQuery = `
        SELECT id FROM grants
        WHERE status = 'active'
        AND (deadline IS NULL OR deadline > CURRENT_DATE)
        ORDER BY created_at DESC
      `;

      const grantResult = await this.db.raw(grantsQuery);
      const grants = grantResult.rows || [];

      let processedCount = 0;
      const batchSize = 3; // Smaller batches for NGO-centric analysis

      for (let i = 0; i < grants.length; i += batchSize) {
        const batch = grants.slice(i, i + batchSize);

        const batchPromises = batch.map((grant: any) =>
          this.analyzeMatch(ngoId, grant.id, accountability)
        );

        await Promise.all(batchPromises);
        processedCount += batch.length;

        logger.info(`Processed ${processedCount}/${grants.length} grant matches for NGO ${ngoId}`);

        // Small delay between batches
        if (i + batchSize < grants.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      logger.info(`Completed bulk match analysis for NGO ${ngoId}: ${processedCount} matches processed`);

      return {
        success: true,
        matches_processed: processedCount
      };
    } catch (error) {
      logger.error(error, 'Error in analyzeNGOMatches');
      return {
        success: false,
        matches_processed: 0
      };
    }
  }
}