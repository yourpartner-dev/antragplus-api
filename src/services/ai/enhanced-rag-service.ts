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
          ngo_id,
          grant_id,
          application_id
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
          focus: web_search_focus
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
        filter: { ngo_id, grant_id, application_id }
      });

      return {
        ...fallbackContext,
        contextSources: { internal: fallbackContext },
        compliance_notes: []
      };
    }
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
      if (chunk.metadata?.ngo_id === enhancementData.ngo_info?.id) {
        boostedSimilarity += 0.1;
      }

      // Boost document extracts from grant documents
      if (chunk.source_table === 'document_extracts' && chunk.metadata?.document_type?.includes('grant')) {
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
    if (context.compliance_notes?.length > 0) {
      sections.push(`COMPLIANCE REQUIREMENTS:\n${context.compliance_notes.map(note => `- ${note}`).join('\n')}`);
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
    if (context.external_insights?.length > 0) {
      sections.push(`CURRENT EXTERNAL INSIGHTS:\n${context.external_insights.map((insight, i) => `${i + 1}. ${insight.title}\n${insight.content}`).join('\n\n')}`);
    }

    return sections.join('\n\n---\n\n');
  }
}

// Export singleton instance
export const enhancedRAGService = new EnhancedRAGService();