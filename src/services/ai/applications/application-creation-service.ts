import { ModelMessage, streamText } from 'ai';
import { applicationCreationModel } from '../providers.js';
import { useLogger } from '../../../helpers/logger/index.js';
import { ItemsService } from '../../items.js';
import getDatabase from '../../../database/index.js';
import { enhancedRAGService } from '../enhanced-rag-service.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';
import type { Response } from 'express';

const logger = useLogger();

export interface ApplicationGenerationOptions {
  applicationId: string;
  userId: string;
  stream: Response;
  accountability: Accountability;
  schema: SchemaOverview;
}

export interface GenerationPhase {
  phase: string;
  progress: number;
  message: string;
}

export interface DocumentGeneration {
  title: string;
  content: string;
  kind: string;
  order: number;
}

const GRANT_APPLICATION_PROMPT = `You have access to:
- Grant requirements and guidelines
- NGO profile, capabilities, and documents
- Historical successful applications

TASK: Generate a complete, submission-ready grant application.

PROCESS:
1. EXTRACT: Identify all required documents from grant guidelines
2. MATCH: Align NGO strengths with grant priorities using database records
3. GENERATE: Create only required documents using grant's exact terminology
4. VALIDATE: Ensure all requirements met, flag any gaps

OUTPUT STRUCTURE:
# APPLICATION SUMMARY
- Grant: [name]
- Amount: [requested]
- Status: [X/Y requirements met]

# GENERATED DOCUMENTS
[Generate each required document with proper headings]

# MISSING ITEMS
[List with action required and source]

# SUBMIT VIA
[Method and deadline]

RULES:
- Use only factual data from database
- Mirror grant language exactly
- Generate documents in order of importance
- Include page numbers and word counts
- Flag any eligibility concerns immediately

Begin by querying grant requirements, then generate all necessary documents.`;

export class ApplicationCreationService extends ItemsService {
  override accountability: Accountability | null;
  override schema: SchemaOverview;

  constructor(options: { accountability: Accountability | null; schema: SchemaOverview }) {
    super('applications', options);
    this.accountability = options.accountability;
    this.schema = options.schema;
  }

  /**
   * Generate complete application with streaming progress
   */
  async generateApplication(options: ApplicationGenerationOptions): Promise<void> {
    const { applicationId, userId, stream, accountability } = options;
    const knex = getDatabase();

    try {
      logger.info(`Starting application generation for application ${applicationId}`);

      // Update application status to generating
      await this.updateGenerationStatus(applicationId, {
        status: 'generating',
        progress: 0,
        current_phase: 'initializing',
        started_at: new Date(),
        error: null
      });

      // Phase 1: Get application context
      this.streamPhase(stream, {
        phase: 'analyzing_application',
        progress: 5,
        message: 'Retrieving application details...'
      });

      const application = await knex('applications')
        .where('id', applicationId)
        .first();

      if (!application) {
        throw new Error('Application not found');
      }

      // Phase 2: Build comprehensive context
      this.streamPhase(stream, {
        phase: 'analyzing_grant',
        progress: 15,
        message: 'Analyzing grant requirements and guidelines...'
      });

      const context = await enhancedRAGService.buildCompleteApplicationContext(
        `Generate complete application for grant ${application.grant_id} and NGO ${application.ngo_id}`,
        {
          ngo_id: application.ngo_id,
          grant_id: application.grant_id,
          application_id: applicationId,
          include_web_search: true,
          prioritize_compliance: true
        }
      );

      this.streamPhase(stream, {
        phase: 'reviewing_ngo',
        progress: 25,
        message: 'Reviewing NGO profile and capabilities...'
      });

      // Phase 3: Generate application with Claude Opus
      this.streamPhase(stream, {
        phase: 'generating_content',
        progress: 35,
        message: 'Starting AI document generation...'
      });

      await this.streamApplicationGeneration({
        application,
        context,
        stream,
        userId
      });

      // Phase 4: Final validation and completion
      this.streamPhase(stream, {
        phase: 'validating',
        progress: 90,
        message: 'Validating generated documents...'
      });

      const generatedDocuments = await knex('application_content')
        .where('application_id', applicationId)
        .orderBy('created_at', 'desc');

      // Update final status
      await this.updateGenerationStatus(applicationId, {
        status: 'completed',
        progress: 100,
        current_phase: 'completed',
        completed_at: new Date(),
        requirements_met: generatedDocuments.map(doc => doc.kind),
        documents_generated: generatedDocuments.length
      });

      this.streamComplete(stream, {
        success: true,
        documents_generated: generatedDocuments.length,
        application_summary: {
          grant_name: context.grant_details?.info?.name,
          ngo_name: context.ngo_details?.info?.organization_name,
          requested_amount: application.requested_amount,
          status: `${generatedDocuments.length} documents generated`
        }
      });

      // Log activity
      await knex('ai_activity_logs').insert({
        user_id: userId,
        activity_type: 'application_generated',
        entity_type: 'applications',
        entity_id: applicationId,
        description: `Generated complete application with ${generatedDocuments.length} documents`,
        metadata: {
          grant_id: application.grant_id,
          ngo_id: application.ngo_id,
          documents_count: generatedDocuments.length,
          model: 'claude-opus-4-20250514'
        },
        ip_address: accountability?.ip || null,
        user_agent: accountability?.userAgent || null,
        created_at: new Date()
      });

    } catch (error) {
      logger.error(error, 'Error generating application');

      // Update error status
      await this.updateGenerationStatus(applicationId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        completed_at: new Date()
      });

      this.streamError(stream, {
        error: error instanceof Error ? error.message : 'Unknown error',
        phase: 'error'
      });
    } finally {
      stream.end();
    }
  }

  /**
   * Stream the AI generation process with real-time document creation
   */
  private async streamApplicationGeneration(options: {
    application: any;
    context: any;
    stream: Response;
    userId: string;
  }): Promise<void> {
    const { application, context, stream, userId } = options;

    // Build comprehensive system message
    const systemMessage = this.buildSystemMessage(context);

    // Build user message with specific requirements
    const userMessage = this.buildUserMessage(application, context);

    const messages: ModelMessage[] = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ];

    let currentDocument: any = null;
    let documentBuffer = '';
    let documentCounter = 0;

    // Stream with Claude Opus
    const result = await streamText({
      model: applicationCreationModel(),
      messages,
      temperature: 0.3, // Lower temperature for more consistent output
      onFinish: async () => {
        // Handle any remaining document content
        if (currentDocument && documentBuffer.trim()) {
          await this.saveDocument({
            applicationId: application.id,
            title: currentDocument.title,
            content: documentBuffer.trim(),
            kind: currentDocument.kind,
            userId,
            order: documentCounter
          });

          this.streamDocumentComplete(stream, {
            document: currentDocument.kind,
            title: currentDocument.title,
            id: 'generated',
            progress: 85
          });
        }
      }
    });

    // Process streaming response
    for await (const chunk of result.textStream) {
      // Parse chunk for document structure
      const lines = chunk.split('\n');

      for (const line of lines) {
        // Detect document start
        if (line.startsWith('## ') || line.startsWith('# ')) {
          // Save previous document if exists
          if (currentDocument && documentBuffer.trim()) {
            await this.saveDocument({
              applicationId: application.id,
              title: currentDocument.title,
              content: documentBuffer.trim(),
              kind: currentDocument.kind,
              userId,
              order: documentCounter
            });

            this.streamDocumentComplete(stream, {
              document: currentDocument.kind,
              title: currentDocument.title,
              id: 'generated',
              progress: 40 + (documentCounter * 10)
            });
          }

          // Start new document
          const title = line.replace(/^#+\s*/, '').trim();
          const kind = this.inferDocumentKind(title);

          currentDocument = { title, kind };
          documentBuffer = line + '\n';
          documentCounter++;

          this.streamDocumentStart(stream, {
            document: kind,
            title,
            progress: 35 + (documentCounter * 10)
          });

        } else if (currentDocument) {
          // Add content to current document
          documentBuffer += line + '\n';

          // Stream content in chunks
          if (line.trim()) {
            this.streamDocumentContent(stream, {
              document: currentDocument.kind,
              content: line,
              progress: 35 + (documentCounter * 10)
            });
          }
        }
      }
    }
  }

  /**
   * Build comprehensive system message with all context
   */
  private buildSystemMessage(context: any): string {
    let systemMessage = GRANT_APPLICATION_PROMPT + '\n\n';

    // Add grant details
    if (context.grant_details?.info) {
      systemMessage += `GRANT INFORMATION:
Name: ${context.grant_details.info.name}
Provider: ${context.grant_details.info.provider}
Deadline: ${context.grant_details.info.deadline}
Amount: €${context.grant_details.info.amount_min} - €${context.grant_details.info.amount_max}
Category: ${context.grant_details.info.category}
Language: ${context.grant_details.language_requirements}
Description: ${context.grant_details.info.description}

GRANT REQUIREMENTS:
${context.grant_details.requirements_matrix.join('\n')}

SUBMISSION GUIDELINES:
${context.grant_details.submission_guidelines.join('\n')}

FORMATTING REQUIREMENTS:
${context.grant_details.formatting_requirements.join('\n')}

`;
    }

    // Add NGO details
    if (context.ngo_details?.info) {
      systemMessage += `NGO INFORMATION:
Organization: ${context.ngo_details.info.organization_name}
Field of Work: ${context.ngo_details.info.field_of_work}
Company Size: ${context.ngo_details.info.company_size}
Location: ${context.ngo_details.info.location}
About: ${context.ngo_details.info.about}

NGO CAPABILITIES:
${context.ngo_details.capabilities.join('\n')}

TEAM EXPERTISE:
${context.ngo_details.team_expertise.join('\n')}

FINANCIAL TRACK RECORD:
- Total Applications: ${context.ngo_details.financial_track_record.total_applications}
- Success Rate: ${context.ngo_details.financial_track_record.success_rate}%
- Total Funding Awarded: €${context.ngo_details.financial_track_record.total_funding_awarded}

`;
    }

    // Add compliance matrix
    if (context.compliance_matrix) {
      systemMessage += `COMPLIANCE MATRIX:
Required Documents: ${context.compliance_matrix.required_documents.join(', ')}

Eligibility Status:
${context.compliance_matrix.eligibility_requirements.map((req: any) =>
  `- ${req.requirement}: ${req.status}`
).join('\n')}

`;
    }

    // Add historical examples
    if (context.historical_examples?.best_practices?.length > 0) {
      systemMessage += `BEST PRACTICES:
${context.historical_examples.best_practices.join('\n')}

`;
    }

    // Add existing application content if any
    if (context.application_status?.existing_content?.length > 0) {
      systemMessage += `EXISTING APPLICATION CONTENT:
${context.application_status.existing_content.map((content: any) =>
  `- ${content.title} (${content.kind})`
).join('\n')}

`;
    }

    // Add relevant knowledge
    if (context.chunks?.length > 0) {
      systemMessage += `RELEVANT KNOWLEDGE:
${context.chunks.slice(0, 8).map((chunk: any, i: number) =>
  `${i + 1}. [${chunk.source_table}] ${chunk.chunk_text.substring(0, 200)}...`
).join('\n')}

`;
    }

    // Add external insights
    if (context.external_insights?.length > 0) {
      systemMessage += `CURRENT EXTERNAL INSIGHTS:
${context.external_insights.slice(0, 3).map((insight: any, i: number) =>
  `${i + 1}. ${insight.title}\n${insight.content.substring(0, 300)}...`
).join('\n\n')}

`;
    }

    return systemMessage;
  }

  /**
   * Build specific user message for generation
   */
  private buildUserMessage(application: any, context: any): string {
    return `Generate a complete grant application for the following:

PROJECT DETAILS:
- Title: ${application.project_title}
- Description: ${application.project_description}
- Requested Amount: €${application.requested_amount}

SPECIFIC REQUIREMENTS FOR THIS GRANT:
${context.compliance_matrix?.required_documents?.map((doc: string) => `- ${doc}`).join('\n') || '- Standard application documents required'}

INSTRUCTIONS:
1. Generate ALL documents required by this specific grant
2. Use the exact terminology and structure from the grant guidelines
3. Align NGO strengths with grant priorities from the database
4. Ensure compliance with all formatting requirements
5. Flag any missing information or eligibility concerns
6. Use the NGO's proven track record and capabilities
7. Follow the language requirements (${context.grant_details?.language_requirements || 'German'})

Generate the application now, creating each required document section with proper headings like:
# PROJECT PROPOSAL
# BUDGET PLAN
# ORGANIZATION PROFILE
# TIMELINE AND MILESTONES

Each document should be comprehensive and ready for submission.`;
  }

  /**
   * Infer document kind from title
   */
  private inferDocumentKind(title: string): string {
    const titleLower = title.toLowerCase();

    if (titleLower.includes('proposal') || titleLower.includes('project description') || titleLower.includes('projektbeschreibung')) {
      return 'proposal';
    } else if (titleLower.includes('budget') || titleLower.includes('financial') || titleLower.includes('kosten')) {
      return 'budget';
    } else if (titleLower.includes('timeline') || titleLower.includes('schedule') || titleLower.includes('zeitplan') || titleLower.includes('milestone')) {
      return 'timeline';
    } else if (titleLower.includes('cover') || titleLower.includes('summary') || titleLower.includes('zusammenfassung')) {
      return 'cover_letter';
    } else if (titleLower.includes('organization') || titleLower.includes('organisation') || titleLower.includes('profile')) {
      return 'organization';
    } else {
      return 'text';
    }
  }

  /**
   * Save generated document to database
   */
  private async saveDocument(options: {
    applicationId: string;
    title: string;
    content: string;
    kind: string;
    userId: string;
    order: number;
  }): Promise<string> {
    const contentService = new ItemsService('application_content', {
      accountability: this.accountability,
      schema: this.schema
    });

    const document = await contentService.createOne({
      title: options.title,
      content: options.content,
      kind: options.kind,
      content_format: 'markdown',
      application_id: options.applicationId,
      created_by: options.userId,
      created_at: new Date()
    });

    logger.info(`Saved document: ${options.title} (${options.kind}) for application ${options.applicationId}`);
    return document as string;
  }

  /**
   * Update application generation status in metadata
   */
  private async updateGenerationStatus(applicationId: string, status: any): Promise<void> {
    const knex = getDatabase();

    const application = await knex('applications')
      .where('id', applicationId)
      .first();

    const metadata = application?.metadata || {};
    metadata.generation = { ...metadata.generation, ...status };

    await knex('applications')
      .where('id', applicationId)
      .update({
        metadata,
        updated_at: new Date()
      });
  }

  /**
   * Stream phase updates
   */
  private streamPhase(stream: Response, phase: GenerationPhase): void {
    stream.write(`data: ${JSON.stringify({
      type: 'phase',
      ...phase
    })}\n\n`);
  }

  /**
   * Stream document start
   */
  private streamDocumentStart(stream: Response, data: any): void {
    stream.write(`data: ${JSON.stringify({
      type: 'document_start',
      ...data
    })}\n\n`);
  }

  /**
   * Stream document content
   */
  private streamDocumentContent(stream: Response, data: any): void {
    stream.write(`data: ${JSON.stringify({
      type: 'document_content',
      ...data
    })}\n\n`);
  }

  /**
   * Stream document completion
   */
  private streamDocumentComplete(stream: Response, data: any): void {
    stream.write(`data: ${JSON.stringify({
      type: 'document_complete',
      ...data
    })}\n\n`);
  }

  /**
   * Stream completion
   */
  private streamComplete(stream: Response, data: any): void {
    stream.write(`data: ${JSON.stringify({
      type: 'complete',
      ...data
    })}\n\n`);
  }

  /**
   * Stream error
   */
  private streamError(stream: Response, data: any): void {
    stream.write(`data: ${JSON.stringify({
      type: 'error',
      ...data
    })}\n\n`);
  }
}