import { RAGService, RAGContext, RAGSearchOptions } from '../rag-service.js';
import { TavilyClient } from 'tavily';
import { useLogger } from '../../helpers/logger/index.js';
import { useEnv } from '../../helpers/env/index.js';
import getDatabase from '../../database/index.js';

const logger = useLogger();
const env = useEnv();

export interface GrantApplicationContext extends RAGContext {
  grant_info?: any;
  ngo_info?: any;
  application_info?: any;
  external_insights?: any[];
  compliance_notes?: string[];
  contextSources: {
    internal: RAGContext;
    external?: any;
  };
}

export interface CompleteApplicationContext extends GrantApplicationContext {
  grant_details: {
    info: any;
    documents: any[];
    requirements_matrix: string[];
    submission_guidelines: string[];
    language_requirements: string;
    formatting_requirements: string[];
    deadlines: any[];
  };
  ngo_details: {
    info: any;
    documents: any[];
    past_applications: any[];
    capabilities: string[];
    team_expertise: string[];
    financial_track_record: any;
  };
  application_status: {
    existing_content: any[];
    attachments: any[];
    completion_status: any;
    draft_versions: any[];
  };
  historical_examples: {
    successful_applications: any[];
    similar_grants: any[];
    best_practices: string[];
  };
  compliance_matrix: {
    required_documents: string[];
    eligibility_requirements: { requirement: string; status: 'met' | 'not_met' | 'unknown' }[];
    formatting_constraints: any[];
    submission_requirements: string[];
  };
}

export class EnhancedRAGService extends RAGService {
  private tavilyClient: TavilyClient | null = null;
  private db = getDatabase();

  constructor() {
    super();

    // Initialize Tavily if available
    const apiKey = env['TAVILY_API_KEY'] as string;
    if (apiKey) {
      this.tavilyClient = new TavilyClient({ apiKey });
    }
  }

  /**
   * Build comprehensive context for grant application work
   * Combines internal knowledge with external web search
   */
  async buildGrantApplicationContext(
    query: string,
    options: {
      chatId?: string;
      ngo_id?: string;
      grant_id?: string;
      application_id?: string;
      include_web_search?: boolean;
      web_search_focus?: string;
      prioritize_compliance?: boolean;
    } = {}
  ): Promise<GrantApplicationContext> {
    const {
      chatId,
      ngo_id,
      grant_id,
      application_id,
      include_web_search = true,
      web_search_focus,
      prioritize_compliance = true
    } = options;

    try {
      logger.info(`Building grant application context for: "${query}"`);

      // 1. Build internal context using existing RAG
      const ragOptions: RAGSearchOptions = {
        limit: 15,
        threshold: 0.6,
        filter: {
          ngo_id: ngo_id as string,
          grant_id: grant_id as string,
          application_id: application_id as string
        },
        includeMetadata: true,
        boostRecent: true
      };

      const internalContext = await this.buildContext(query, chatId, ragOptions);

      // 2. Get entity information
      const [grantInfo, ngoInfo, applicationInfo] = await Promise.all([
        grant_id ? this.getGrantInfo(grant_id) : null,
        ngo_id ? this.getNGOInfo(ngo_id) : null,
        application_id ? this.getApplicationInfo(application_id) : null
      ]);

      // 3. Build external context if web search enabled
      let externalInsights: any[] = [];
      if (include_web_search && this.tavilyClient) {
        externalInsights = await this.buildExternalContext(query, {
          grant_info: grantInfo,
          ngo_info: ngoInfo,
          ...(web_search_focus && { focus: web_search_focus })
        });
      }

      // 4. Generate compliance notes if prioritized
      let complianceNotes: string[] = [];
      if (prioritize_compliance && grantInfo) {
        complianceNotes = await this.generateComplianceNotes(grantInfo, ngoInfo, query);
      }

      // 5. Re-rank and enhance internal context based on grant relevance
      const enhancedContext = await this.enhanceInternalContext(
        internalContext,
        { grant_info: grantInfo, ngo_info: ngoInfo, query }
      );

      const result: GrantApplicationContext = {
        ...enhancedContext,
        grant_info: grantInfo,
        ngo_info: ngoInfo,
        application_info: applicationInfo,
        external_insights: externalInsights,
        compliance_notes: complianceNotes,
        contextSources: {
          internal: internalContext,
          external: externalInsights.length > 0 ? { results: externalInsights } : undefined
        }
      };

      logger.info(`Grant context built: ${result.chunks.length} internal + ${externalInsights.length} external insights`);
      return result;

    } catch (error) {
      logger.error(error, 'Error building grant application context');
      // Fallback to basic internal context
      const fallbackContext = await this.buildContext(query, chatId, {
        filter: { ngo_id: ngo_id as string, grant_id: grant_id as string, application_id: application_id as string }
      });

      return {
        ...fallbackContext,
        contextSources: { internal: fallbackContext },
        compliance_notes: []
      };
    }
  }

  /**
   * Build complete comprehensive context specifically for application generation
   * This gathers ALL available data for comprehensive application creation
   */
  async buildCompleteApplicationContext(
    query: string,
    options: {
      ngo_id: string;
      grant_id: string;
      application_id: string;
      include_web_search?: boolean;
      prioritize_compliance?: boolean;
    }
  ): Promise<CompleteApplicationContext> {
    const {
      ngo_id,
      grant_id,
      application_id,
      include_web_search = true,
      prioritize_compliance = true
    } = options;

    try {
      logger.info(`Building COMPLETE application context for application ${application_id}`);

      // 1. Start with basic grant application context
      const baseContext = await this.buildGrantApplicationContext(query, {
        ngo_id,
        grant_id,
        application_id,
        include_web_search,
        prioritize_compliance
      });

      // 2. Get comprehensive grant details
      const grantDetails = await this.getCompleteGrantDetails(grant_id);

      // 3. Get comprehensive NGO details
      const ngoDetails = await this.getCompleteNGODetails(ngo_id);

      // 4. Get current application status and content
      const applicationStatus = await this.getApplicationStatus(application_id);

      // 5. Get historical examples and best practices
      const historicalExamples = await this.getHistoricalExamples(grant_id, ngo_id);

      // 6. Build detailed compliance matrix
      const complianceMatrix = await this.buildComplianceMatrix(grantDetails, ngoDetails);

      const result: CompleteApplicationContext = {
        ...baseContext,
        grant_details: grantDetails,
        ngo_details: ngoDetails,
        application_status: applicationStatus,
        historical_examples: historicalExamples,
        compliance_matrix: complianceMatrix
      };

      logger.info(`Complete application context built with ${result.grant_details.documents.length} grant docs, ${result.ngo_details.past_applications.length} past applications, ${result.compliance_matrix.required_documents.length} requirements`);
      return result;

    } catch (error) {
      logger.error(error, 'Error building complete application context');

      // Fallback to basic context
      const fallbackContext = await this.buildGrantApplicationContext(query, {
        ngo_id,
        grant_id,
        application_id,
        include_web_search: false,
        prioritize_compliance: false
      });

      return {
        ...fallbackContext,
        grant_details: {
          info: fallbackContext.grant_info || {},
          documents: [],
          requirements_matrix: [],
          submission_guidelines: [],
          language_requirements: '',
          formatting_requirements: [],
          deadlines: []
        },
        ngo_details: {
          info: fallbackContext.ngo_info || {},
          documents: [],
          past_applications: [],
          capabilities: [],
          team_expertise: [],
          financial_track_record: {}
        },
        application_status: {
          existing_content: [],
          attachments: [],
          completion_status: {},
          draft_versions: []
        },
        historical_examples: {
          successful_applications: [],
          similar_grants: [],
          best_practices: []
        },
        compliance_matrix: {
          required_documents: [],
          eligibility_requirements: [],
          formatting_constraints: [],
          submission_requirements: []
        }
      };
    }
  }

  /**
   * Get complete grant details including all documents and requirements
   */
  private async getCompleteGrantDetails(grantId: string): Promise<any> {
    try {
      // Get basic grant info
      const grant = await this.db('grants')
        .where('id', grantId)
        .first();

      if (!grant) {
        return {
          info: {},
          documents: [],
          requirements_matrix: [],
          submission_guidelines: [],
          language_requirements: '',
          formatting_requirements: [],
          deadlines: []
        };
      }

      // Get all grant documents with extracted content
      const documents = await this.db('grant_documents')
        .join('yp_files', 'grant_documents.file_id', 'yp_files.id')
        .leftJoin('document_extracts', 'yp_files.id', 'document_extracts.file_id')
        .where('grant_documents.grant_id', grantId)
        .select(
          'yp_files.*',
          'document_extracts.content_text',
          'grant_documents.document_type',
          'grant_documents.metadata'
        );

      // Extract requirements from document content
      const requirements_matrix = this.extractRequirementsFromDocuments(documents);
      const submission_guidelines = this.extractSubmissionGuidelines(documents);
      const formatting_requirements = this.extractFormattingRequirements(documents);

      // Get all deadlines
      const deadlines = [{
        type: 'application_deadline',
        date: grant.deadline,
        description: 'Final application submission deadline'
      }];

      return {
        info: grant,
        documents,
        requirements_matrix,
        submission_guidelines,
        language_requirements: grant.language || 'de-DE',
        formatting_requirements,
        deadlines
      };

    } catch (error) {
      logger.error(error, 'Error getting complete grant details');
      return {
        info: {},
        documents: [],
        requirements_matrix: [],
        submission_guidelines: [],
        language_requirements: '',
        formatting_requirements: [],
        deadlines: []
      };
    }
  }

  /**
   * Get complete NGO details including all documents and capabilities
   */
  private async getCompleteNGODetails(ngoId: string): Promise<any> {
    try {
      // Get basic NGO info
      const ngo = await this.db('ngos')
        .join('yp_organizations', 'ngos.organization_id', 'yp_organizations.id')
        .where('ngos.id', ngoId)
        .select('ngos.*', 'yp_organizations.name as organization_name')
        .first();

      if (!ngo) {
        return {
          info: {},
          documents: [],
          past_applications: [],
          capabilities: [],
          team_expertise: [],
          financial_track_record: {}
        };
      }

      // Get all NGO documents
      const documents = await this.db('ngo_documents')
        .join('yp_files', 'ngo_documents.file_id', 'yp_files.id')
        .leftJoin('document_extracts', 'yp_files.id', 'document_extracts.file_id')
        .where('ngo_documents.ngo_id', ngoId)
        .select(
          'yp_files.*',
          'document_extracts.content_text',
          'ngo_documents.metadata'
        );

      // Get recent past applications (limited to 5 for performance - AI can fetch more via tool if needed)
      const pastApplications = await this.db('applications')
        .leftJoin('grants', 'applications.grant_id', 'grants.id')
        .where('applications.ngo_id', ngoId)
        .where('applications.status', '!=', 'draft')
        .select(
          'applications.*',
          'grants.name as grant_name',
          'grants.provider as grant_provider',
          'grants.category as grant_category'
        )
        .orderBy('applications.created_at', 'desc')
        .limit(5);

      // Extract capabilities from NGO data
      const capabilities = this.extractNGOCapabilities(ngo, documents);
      const teamExpertise = this.extractTeamExpertise(ngo, documents);
      const financialTrackRecord = this.buildFinancialTrackRecord(pastApplications);

      return {
        info: ngo,
        documents,
        past_applications: pastApplications,
        capabilities,
        team_expertise: teamExpertise,
        financial_track_record: financialTrackRecord
      };

    } catch (error) {
      logger.error(error, 'Error getting complete NGO details');
      return {
        info: {},
        documents: [],
        past_applications: [],
        capabilities: [],
        team_expertise: [],
        financial_track_record: {}
      };
    }
  }

  /**
   * Get current application status and existing content
   */
  private async getApplicationStatus(applicationId: string): Promise<any> {
    try {
      // Get existing application content
      const existingContent = await this.db('application_content')
        .where('application_id', applicationId)
        .orderBy('created_at', 'desc');

      // Get application attachments with both direct content and extracted content
      const attachments = await this.db('application_attachments')
        .join('yp_files', 'application_attachments.file_id', 'yp_files.id')
        .leftJoin('document_extracts', 'yp_files.id', 'document_extracts.file_id')
        .where('application_attachments.application_id', applicationId)
        .select(
          'yp_files.*',
          'application_attachments.document_type',
          'application_attachments.metadata',
          'application_attachments.content as direct_content', // Direct text content
          'application_attachments.content_format',
          'document_extracts.content_text as extracted_content', // Extracted from file
          'document_extracts.word_count',
          'document_extracts.page_count'
        );

      // Get draft versions through application_content join
      const draftVersions = await this.db('application_content_versions')
        .join('application_content', 'application_content_versions.application_content_id', 'application_content.id')
        .where('application_content.application_id', applicationId)
        .select('application_content_versions.*')
        .orderBy('application_content_versions.created_at', 'desc');

      // Calculate completion status
      const completionStatus = {
        documents_created: existingContent.length,
        attachments_uploaded: attachments.length,
        versions_saved: draftVersions.length,
        last_updated: existingContent.length > 0 ? existingContent[0].updated_at : null
      };

      return {
        existing_content: existingContent,
        attachments,
        completion_status: completionStatus,
        draft_versions: draftVersions
      };

    } catch (error) {
      logger.error(error, 'Error getting application status');
      return {
        existing_content: [],
        attachments: [],
        completion_status: {},
        draft_versions: []
      };
    }
  }

  /**
   * Get historical examples and best practices
   */
  private async getHistoricalExamples(grantId: string, ngoId: string): Promise<any> {
    try {
      // Get successful applications for this grant and NGO
      const successfulApplications = await this.db('applications')
        .join('ngos', 'applications.ngo_id', 'ngos.id')
        .join('yp_organizations', 'ngos.organization_id', 'yp_organizations.id')
        .where('applications.grant_id', grantId)
        .where('applications.ngo_id', ngoId)
        .where('applications.status', 'approved')
        .select(
          'applications.*',
          'yp_organizations.name as ngo_name'
        )
        .limit(5);

      // Get similar grants (same category/provider)
      const grant = await this.db('grants').where('id', grantId).first();
      const similarGrants = grant ? await this.db('grants')
        .where('category', grant.category)
        .where('provider', grant.provider)
        .where('id', '!=', grantId)
        .where('status', 'active')
        .limit(3) : [];

      // Extract best practices
      const bestPractices = this.extractBestPractices(successfulApplications, similarGrants);

      return {
        successful_applications: successfulApplications,
        similar_grants: similarGrants,
        best_practices: bestPractices
      };

    } catch (error) {
      logger.error(error, 'Error getting historical examples');
      return {
        successful_applications: [],
        similar_grants: [],
        best_practices: []
      };
    }
  }

  /**
   * Build detailed compliance matrix
   */
  private async buildComplianceMatrix(grantDetails: any, ngoDetails: any): Promise<any> {
    try {
      // Extract required documents from grant
      const requiredDocuments = this.extractRequiredDocuments(grantDetails);

      // Check eligibility requirements
      const eligibilityRequirements = this.checkEligibilityRequirements(grantDetails, ngoDetails);

      // Extract formatting constraints
      const formattingConstraints = grantDetails.formatting_requirements || [];

      // Extract submission requirements
      const submissionRequirements = grantDetails.submission_guidelines || [];

      return {
        required_documents: requiredDocuments,
        eligibility_requirements: eligibilityRequirements,
        formatting_constraints: formattingConstraints,
        submission_requirements: submissionRequirements
      };

    } catch (error) {
      logger.error(error, 'Error building compliance matrix');
      return {
        required_documents: [],
        eligibility_requirements: [],
        formatting_constraints: [],
        submission_requirements: []
      };
    }
  }

  /**
   * Extract requirements from grant documents
   */
  private extractRequirementsFromDocuments(documents: any[]): string[] {
    const requirements: string[] = [];

    documents.forEach(doc => {
      if (doc.content_text) {
        // Look for requirement patterns
        const content = doc.content_text.toLowerCase();

        if (content.includes('must submit') || content.includes('required documents')) {
          requirements.push(`Document requirement found in ${doc.filename_download}`);
        }

        if (content.includes('eligibility')) {
          requirements.push(`Eligibility criteria specified in ${doc.filename_download}`);
        }

        if (content.includes('deadline') || content.includes('submission')) {
          requirements.push(`Submission requirements in ${doc.filename_download}`);
        }
      }
    });

    return requirements;
  }

  /**
   * Extract submission guidelines
   */
  private extractSubmissionGuidelines(documents: any[]): string[] {
    const guidelines: string[] = [];

    documents.forEach(doc => {
      if (doc.content_text) {
        const content = doc.content_text;

        // Look for submission-related content
        if (content.toLowerCase().includes('submit')) {
          guidelines.push(`Submission process outlined in ${doc.filename_download}`);
        }

        if (content.toLowerCase().includes('application form')) {
          guidelines.push(`Application form requirements in ${doc.filename_download}`);
        }
      }
    });

    return guidelines;
  }

  /**
   * Extract formatting requirements
   */
  private extractFormattingRequirements(documents: any[]): string[] {
    const requirements: string[] = [];

    documents.forEach(doc => {
      if (doc.content_text) {
        const content = doc.content_text.toLowerCase();

        if (content.includes('page limit') || content.includes('word limit')) {
          requirements.push(`Page/word limits specified in ${doc.filename_download}`);
        }

        if (content.includes('font') || content.includes('format')) {
          requirements.push(`Formatting requirements in ${doc.filename_download}`);
        }
      }
    });

    return requirements;
  }

  /**
   * Extract NGO capabilities
   */
  private extractNGOCapabilities(ngo: any, documents: any[]): string[] {
    const capabilities: string[] = [];

    if (ngo.field_of_work) {
      capabilities.push(`Expertise in ${ngo.field_of_work}`);
    }

    if (ngo.company_size) {
      capabilities.push(`Organization size: ${ngo.company_size}`);
    }

    // Extract from documents
    documents.forEach(doc => {
      if (doc.content_text && doc.document_type === 'capabilities') {
        capabilities.push(`Documented capability in ${doc.filename_download}`);
      }
    });

    return capabilities;
  }

  /**
   * Extract team expertise
   */
  private extractTeamExpertise(ngo: any, documents: any[]): string[] {
    const expertise: string[] = [];

    // Include all NGO profile data - let AI decide what's relevant
    if (ngo) {
      expertise.push(`NGO Profile: ${JSON.stringify(ngo)}`);
    }

    // Include all document extracts - let AI decide what's relevant for team
    documents.forEach(doc => {
      expertise.push(`Document: ${doc.filename_download} - Type: ${doc.document_type} - Content: ${doc.extract_text || doc.summary || 'No content available'}`);
    });

    return expertise;
  }

  /**
   * Build financial track record
   */
  private buildFinancialTrackRecord(pastApplications: any[]): any {
    const approved = pastApplications.filter(app => app.status === 'approved');
    const totalAwarded = approved.reduce((sum, app) => sum + (app.requested_amount || 0), 0);

    return {
      total_applications: pastApplications.length,
      approved_applications: approved.length,
      success_rate: pastApplications.length > 0 ? (approved.length / pastApplications.length) * 100 : 0,
      total_funding_awarded: totalAwarded,
      average_award_size: approved.length > 0 ? totalAwarded / approved.length : 0
    };
  }

  /**
   * Extract best practices from successful applications
   */
  private extractBestPractices(successfulApplications: any[], similarGrants: any[]): string[] {
    const practices: string[] = [];

    if (successfulApplications.length > 0) {
      practices.push(`${successfulApplications.length} successful applications found for this grant`);
      practices.push('Focus on alignment with grant priorities');
      practices.push('Ensure comprehensive budget documentation');
    }

    if (similarGrants.length > 0) {
      practices.push(`${similarGrants.length} similar grants available for reference`);
    }

    practices.push('Use specific, measurable outcomes');
    practices.push('Provide clear timeline and milestones');

    return practices;
  }

  /**
   * Extract required documents from grant details
   */
  private extractRequiredDocuments(grantDetails: any): string[] {
    const required: string[] = [];

    // Standard requirements
    required.push('Project proposal');
    required.push('Budget plan');
    required.push('Organization profile');

    // Extract from grant documents
    grantDetails.documents?.forEach((doc: any) => {
      if (doc.content_text?.toLowerCase().includes('required') ||
          doc.content_text?.toLowerCase().includes('must submit')) {
        required.push(`Additional requirements per ${doc.filename_download}`);
      }
    });

    return required;
  }

  /**
   * Check eligibility requirements
   */
  private checkEligibilityRequirements(grantDetails: any, ngoDetails: any): any[] {
    const requirements = [];

    // Check basic requirements
    if (grantDetails.info?.company_size && ngoDetails.info?.company_size) {
      requirements.push({
        requirement: 'Organization size compatibility',
        status: grantDetails.info.company_size === ngoDetails.info.company_size ? 'met' : 'not_met'
      });
    }

    if (grantDetails.info?.location && ngoDetails.info?.location) {
      const locationMatch = ngoDetails.info.location.toLowerCase()
        .includes(grantDetails.info.location.toLowerCase());
      requirements.push({
        requirement: 'Geographic eligibility',
        status: locationMatch ? 'met' : 'unknown'
      });
    }

    requirements.push({
      requirement: 'Legal entity status',
      status: 'unknown'
    });

    return requirements;
  }

  /**
   * Build external context using web search
   */
  private async buildExternalContext(
    query: string,
    context: {
      grant_info?: any;
      ngo_info?: any;
      focus?: string;
    }
  ): Promise<any[]> {
    if (!this.tavilyClient) {
      return [];
    }

    try {
      // Build enhanced search query
      let searchQuery = query;

      if (context.focus) {
        searchQuery = `${query} ${context.focus}`;
      }

      if (context.grant_info?.category) {
        searchQuery += ` ${context.grant_info.category} grants funding`;
      }

      if (context.ngo_info?.field_of_work) {
        searchQuery += ` ${context.ngo_info.field_of_work}`;
      }

      // Add current year and best practices
      searchQuery += ' 2024 2025 best practices requirements guidelines';

      const searchResult = await this.tavilyClient.search({
        query: searchQuery,
        search_depth: 'advanced',
        max_results: 6,
        include_answer: true,
        include_raw_content: false
      });

      return searchResult.results?.map((result: any) => ({
        title: result.title,
        url: result.url,
        content: result.content,
        source: 'web_search',
        relevance: result.score,
        published_date: result.published_date,
        summary: searchResult.answer
      })) || [];

    } catch (error) {
      logger.error(error, 'Error building external context');
      return [];
    }
  }

  /**
   * Generate compliance notes based on grant requirements
   */
  private async generateComplianceNotes(
    grantInfo: any,
    ngoInfo: any,
    query: string
  ): Promise<string[]> {
    const notes: string[] = [];

    if (!grantInfo) return notes;

    // Add query context for focused compliance checking
    notes.push(`Compliance analysis for: ${query}`);

    // Check basic eligibility
    if (grantInfo.company_size && ngoInfo?.company_size) {
      if (grantInfo.company_size !== ngoInfo.company_size) {
        notes.push(`Company size mismatch: Grant requires ${grantInfo.company_size}, NGO is ${ngoInfo.company_size}`);
      }
    }

    // Check location requirements
    if (grantInfo.location && ngoInfo?.location) {
      // Simple check - in real implementation would use more sophisticated matching
      if (!ngoInfo.location.toLowerCase().includes(grantInfo.location.toLowerCase().split(' ')[0])) {
        notes.push(`Location requirement: Grant focuses on ${grantInfo.location}, verify NGO eligibility`);
      }
    }

    // Check deadline urgency
    if (grantInfo.deadline) {
      const deadline = new Date(grantInfo.deadline);
      const today = new Date();
      const daysLeft = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 3600 * 24));

      if (daysLeft < 30) {
        notes.push(`URGENT: Application deadline in ${daysLeft} days (${grantInfo.deadline})`);
      } else if (daysLeft < 60) {
        notes.push(`Application deadline approaching: ${daysLeft} days remaining`);
      }
    }

    // Check required documents
    if (grantInfo.required_documents?.length > 0) {
      notes.push(`Required documents: ${grantInfo.required_documents.join(', ')}`);
    }

    return notes;
  }

  /**
   * Enhance internal context with grant-specific ranking
   */
  private async enhanceInternalContext(
    context: RAGContext,
    enhancementData: {
      grant_info?: any;
      ngo_info?: any;
      query: string;
    }
  ): Promise<RAGContext> {
    // Re-rank chunks based on grant relevance
    const enhancedChunks = context.chunks.map(chunk => {
      let boostedSimilarity = chunk.similarity;

      // Boost grant-related content
      if (chunk.source_table === 'grants' && enhancementData.grant_info?.id === chunk.source_id) {
        boostedSimilarity += 0.2;
      }

      // Boost NGO-specific content
      if (chunk['metadata']?.['ngo_id'] === enhancementData.ngo_info?.id) {
        boostedSimilarity += 0.1;
      }

      // Boost document extracts from grant documents
      if (chunk.source_table === 'document_extracts' && chunk['metadata']?.['document_type']?.includes('grant')) {
        boostedSimilarity += 0.15;
      }

      return {
        ...chunk,
        similarity: Math.min(boostedSimilarity, 1.0) // Cap at 1.0
      };
    });

    // Re-sort by enhanced similarity
    enhancedChunks.sort((a, b) => b.similarity - a.similarity);

    return {
      ...context,
      chunks: enhancedChunks
    };
  }

  /**
   * Get comprehensive grant information
   */
  private async getGrantInfo(grantId: string): Promise<any> {
    try {
      const grant = await this.db('grants')
        .where('id', grantId)
        .first();

      if (!grant) return null;

      // Get associated documents
      const documents = await this.db('grant_documents')
        .join('yp_files', 'grant_documents.file_id', 'yp_files.id')
        .leftJoin('document_extracts', 'yp_files.id', 'document_extracts.file_id')
        .where('grant_documents.grant_id', grantId)
        .select('yp_files.*', 'document_extracts.content_text', 'grant_documents.document_type');

      return {
        ...grant,
        documents
      };
    } catch (error) {
      logger.error(error, 'Error getting grant info');
      return null;
    }
  }

  /**
   * Get comprehensive NGO information
   */
  private async getNGOInfo(ngoId: string): Promise<any> {
    try {
      const ngo = await this.db('ngos')
        .join('yp_organizations', 'ngos.organization_id', 'yp_organizations.id')
        .where('ngos.id', ngoId)
        .select('ngos.*', 'yp_organizations.name as organization_name')
        .first();

      if (!ngo) return null;

      // Get past applications for context
      const pastApplications = await this.db('applications')
        .where('ngo_id', ngoId)
        .where('status', '!=', 'draft')
        .limit(5)
        .orderBy('created_at', 'desc');

      return {
        ...ngo,
        past_applications: pastApplications
      };
    } catch (error) {
      logger.error(error, 'Error getting NGO info');
      return null;
    }
  }

  /**
   * Get application information
   */
  private async getApplicationInfo(applicationId: string): Promise<any> {
    try {
      const application = await this.db('applications')
        .where('id', applicationId)
        .first();

      if (!application) return null;

      // Get application content
      const content = await this.db('application_content')
        .where('application_id', applicationId)
        .orderBy('created_at', 'desc');

      return {
        ...application,
        content
      };
    } catch (error) {
      logger.error(error, 'Error getting application info');
      return null;
    }
  }

  /**
   * Format context for AI consumption
   */
  formatContextForAI(context: GrantApplicationContext): string {
    const sections: string[] = [];

    // Add compliance notes first (high priority)
    if (context.compliance_notes && context.compliance_notes.length > 0) {
      sections.push(`COMPLIANCE REQUIREMENTS:\n${context.compliance_notes?.map(note => `- ${note}`).join('\n')}`);
    }

    // Add grant information
    if (context.grant_info) {
      sections.push(`GRANT INFORMATION:\nName: ${context.grant_info.name}\nProvider: ${context.grant_info.provider}\nDeadline: ${context.grant_info.deadline}\nAmount: €${context.grant_info.amount_min} - €${context.grant_info.amount_max}\nDescription: ${context.grant_info.description}`);
    }

    // Add NGO context
    if (context.ngo_info) {
      sections.push(`NGO INFORMATION:\nName: ${context.ngo_info.organization_name}\nField: ${context.ngo_info.field_of_work}\nSize: ${context.ngo_info.company_size}\nAbout: ${context.ngo_info.about}`);
    }

    // Add most relevant internal chunks
    if (context.chunks.length > 0) {
      const topChunks = context.chunks.slice(0, 8);
      sections.push(`RELEVANT INTERNAL KNOWLEDGE:\n${topChunks.map((chunk, i) => `${i + 1}. [${chunk.source_table}] ${chunk.chunk_text}`).join('\n\n')}`);
    }

    // Add external insights
    if (context.external_insights && context.external_insights.length > 0) {
      sections.push(`CURRENT EXTERNAL INSIGHTS:\n${context.external_insights?.map((insight, i) => `${i + 1}. ${insight.title}\n${insight.content}`).join('\n\n')}`);
    }

    return sections.join('\n\n---\n\n');
  }
}

// Export singleton instance
export const enhancedRAGService = new EnhancedRAGService();