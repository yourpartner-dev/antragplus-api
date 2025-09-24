-- AntragPlus Database Schema
-- Compatible with PostgreSQL (YP default)
-- All tables include metadata JSONB column for flexibility

-- Translation Groups (for linking records across languages)
CREATE TABLE IF NOT EXISTS translation_groups (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- NGOs (extends existing yp_organizations table)
CREATE TABLE IF NOT EXISTS ngos (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES yp_organizations(id) ON DELETE CASCADE,
    translation_group_id UUID REFERENCES translation_groups(id),
    language VARCHAR(5) DEFAULT 'en-US', -- primary language for this record
    about TEXT,
    location VARCHAR(255),
    legal_entity VARCHAR(100), -- GmbH, e.V., etc.
    field_of_work VARCHAR(255), -- Accessible Health Services, Education, etc.
    company_size VARCHAR(50), -- 1-10, 11-50, 51-200, 201-500, 500+
    tax_id VARCHAR(100),
    funding_type VARCHAR(255), -- Type of funding they typically apply for
    application_size VARCHAR(100), -- Typical application size range
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    UNIQUE(organization_id)
);

-- Grants
CREATE TABLE IF NOT EXISTS grants (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    translation_group_id UUID REFERENCES translation_groups(id),
    language VARCHAR(5) DEFAULT 'en-US', -- primary language for this record
    name VARCHAR(255),
    description TEXT,
    provider VARCHAR(255), -- Organization providing the grant
    category TEXT, -- Education, Healthcare, Environment, etc.
    type TEXT, -- Project-based, Operating, Capacity Building, etc.
    amount_min DECIMAL(15,2),
    amount_max DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'EUR',
    deadline DATE,
    duration_months INTEGER,
    eligibility_criteria TEXT,
    required_documents TEXT[], -- Array of required document types
    application_process TEXT,
    evaluation_criteria TEXT,
    reporting_requirements TEXT,
    status VARCHAR(50) DEFAULT 'active', -- active, closed, upcoming, archived
    
    -- New fields for grant location and contact information
    location TEXT, -- Geographic location where NGO should be (e.g. specific region in Germany or EU)
    reference_number TEXT, -- Official reference number for documentation and reference
    contact_person TEXT, -- Person responsible for this grant
    contact_number TEXT, -- Phone number of responsible person
    contact_email TEXT, -- Email of reference person
    company_size TEXT, -- Size of companies that can apply (1-10, 11-50, etc.)
    
    -- Timeline-related fields
    funding_frequency TEXT, -- How often they fund NGOs (annually, quarterly, etc.)
    decision_timeline TEXT, -- When they will likely make a decision
    year_of_program_establishment INTEGER, -- When the grant program was established
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID
);

-- Applications (linking NGOs to grants)
CREATE TABLE IF NOT EXISTS applications (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    ngo_id UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    grant_id UUID NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
    translation_group_id UUID REFERENCES translation_groups(id),
    language VARCHAR(5) DEFAULT 'en-US', -- primary language for this record
    title VARCHAR(255),
    status VARCHAR(50) DEFAULT 'draft', -- draft, submitted, in_review, approved, rejected, withdrawn
    submission_date TIMESTAMP WITH TIME ZONE,
    decision_date TIMESTAMP WITH TIME ZONE,
    requested_amount DECIMAL(15,2),
    approved_amount DECIMAL(15,2),
    project_title VARCHAR(255),
    project_description TEXT,
    problem_statement TEXT,
    target_audience TEXT,
    proposed_solution TEXT,
    expected_outcomes TEXT,
    budget_breakdown JSONB DEFAULT '{}',
    timeline JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    UNIQUE(ngo_id, grant_id)
);

-- Application Attachments (junction table linking applications to uploaded reference files)
-- These are uploaded documents (PDFs, Word docs, etc.) that support the application
-- Stored in yp_files system, referenced here
CREATE TABLE IF NOT EXISTS application_attachments (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    file_id UUID REFERENCES yp_files(id) ON DELETE CASCADE, -- Made nullable to support content-only documents
    document_type VARCHAR(50), -- application_form, budget, project_plan, supporting, etc.
    content TEXT, -- Can store document content directly (for generated/draft documents)
    content_format VARCHAR(20) DEFAULT 'text', -- text, markdown, json, html
    is_primary BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    UNIQUE(application_id, file_id)
);

-- Grant Documents (junction table linking grants to files)
CREATE TABLE IF NOT EXISTS grant_documents (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    grant_id UUID NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES yp_files(id) ON DELETE CASCADE,
    document_type VARCHAR(50), -- guidelines, template, example, requirements, etc.
    is_required BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    UNIQUE(grant_id, file_id)
);

-- NGO Documents (junction table linking NGOs to files)
CREATE TABLE IF NOT EXISTS ngo_documents (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    ngo_id UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES yp_files(id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID
);


-- Application Content (for AI-generated/edited application content - compatible with Vercel AI SDK)
-- This is the actual application text/content that AI helps create and edit
-- Has versions, suggestions, and can be exported to PDF
-- Always belongs to an application (required application_id)
CREATE TABLE IF NOT EXISTS application_content (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    content_format VARCHAR(20) DEFAULT 'text', -- text, markdown, json, html
    kind VARCHAR(20) DEFAULT 'text', -- text, code, image, sheet (matching Vercel schema)
    ngo_id UUID REFERENCES ngos(id) ON DELETE CASCADE,
    application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
    created_by UUID NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID,
    metadata JSONB DEFAULT '{}',
    PRIMARY KEY (id)
);


-- Application Content Versions (for tracking changes to AI-generated content)
CREATE TABLE IF NOT EXISTS application_content_versions (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    application_content_id UUID NOT NULL REFERENCES application_content(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    content TEXT,
    changes JSONB DEFAULT '{}', -- Track what changed
    file_url VARCHAR(500),
    file_size BIGINT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID
);

-- Chats (conversation containers)
CREATE TABLE IF NOT EXISTS chats (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    title TEXT NOT NULL,
    ngo_id UUID REFERENCES ngos(id) ON DELETE CASCADE,
    application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
    grant_id UUID REFERENCES grants(id) ON DELETE CASCADE,
    context_type VARCHAR(50), -- application_edit, ngo_onboarding, grant_discovery, document_generation
    visibility VARCHAR(20) DEFAULT 'private', -- private, organization, public
    status VARCHAR(20) DEFAULT 'active', -- active, archived, deleted
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    updated_by UUID
);

-- Chat Messages (for AI Assistant interactions)
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, -- user, assistant, system
    content TEXT, -- For text messages
    parts JSONB, -- For structured message parts (compatible with Vercel AI SDK)
    attachments JSONB DEFAULT '[]', -- File attachments, images, etc.
    context_type VARCHAR(50), -- Specific context for this message
    metadata JSONB DEFAULT '{}', -- Can store extracted data, processing steps, tool calls, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID
);

-- Grant Matches (AI-generated matches between NGOs and grants)
CREATE TABLE IF NOT EXISTS grant_matches (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    ngo_id UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    grant_id UUID NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
    match_score DECIMAL(3,2), -- 0.00 to 1.00 confidence score
    match_status VARCHAR(50) DEFAULT 'active', -- active, expired, dismissed, applied
    summary TEXT NOT NULL, -- AI-generated summary of why this is a match
    analysis TEXT NOT NULL, -- Detailed AI analysis with potential HTML/icons
    matching_criteria JSONB DEFAULT '{}', -- Store which fields/criteria matched
    matching_points TEXT[] DEFAULT '{}', -- Array of specific points explaining why this grant matches the NGO
    missing_points TEXT[] DEFAULT '{}', -- Array of specific requirements or criteria that the NGO is missing
    suggestions TEXT[] DEFAULT '{}', -- Array of actionable suggestions to improve eligibility
    metadata JSONB DEFAULT '{}',
    expires_at TIMESTAMP WITH TIME ZONE, -- When this match recommendation expires
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    UNIQUE(ngo_id, grant_id)
);

-- NGO Snippets (reusable text templates for applications)
CREATE TABLE IF NOT EXISTS ngo_snippets (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    ngo_id UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    translation_group_id UUID REFERENCES translation_groups(id),
    language VARCHAR(5) DEFAULT 'en-US', -- primary language for this record
    title VARCHAR(255) NOT NULL,
    snippet_type VARCHAR(50), -- header, footer, about, contact, legal, custom, etc.
    content TEXT NOT NULL, -- Can store plain text, markdown, or JSON (for rich text editors)
    content_format VARCHAR(20) DEFAULT 'text', -- text, markdown, json, html
    is_active BOOLEAN DEFAULT true,
    is_global BOOLEAN DEFAULT false, -- if true, available to all NGOs (for system templates)
    usage_count INTEGER DEFAULT 0, -- Track how often it's used
    tags TEXT[], -- Array of tags for categorization
    display_order INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID
);

-- Application Content Suggestions (AI suggestions for application content improvements)
CREATE TABLE IF NOT EXISTS application_content_suggestions (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    application_content_id UUID NOT NULL REFERENCES application_content(id) ON DELETE CASCADE,
    original_text TEXT NOT NULL,
    suggested_text TEXT NOT NULL,
    description TEXT,
    suggestion_type VARCHAR(50), -- grammar, style, content, structure, etc.
    confidence_score DECIMAL(3,2), -- 0.00 to 1.00
    is_resolved BOOLEAN DEFAULT false,
    resolution_type VARCHAR(20), -- accepted, rejected, modified
    created_by UUID NOT NULL,
    resolved_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'
);

-- Message Votes (for rating AI responses)
CREATE TABLE IF NOT EXISTS message_votes (
    chat_message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    is_upvoted BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_message_id, user_id)
);

-- Extracted Data (temporary storage for AI-extracted information before entity creation)
CREATE TABLE IF NOT EXISTS extracted_data (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL, -- ngo, grant, application
    extracted_fields JSONB NOT NULL, -- All extracted data
    confidence_scores JSONB DEFAULT '{}', -- Confidence for each field
    validation_status VARCHAR(20) DEFAULT 'pending', -- pending, validated, rejected
    entity_id UUID, -- ID of created entity (ngo_id, grant_id, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL,
    UNIQUE(chat_id, entity_type)
);

-- Enable pgvector extension for vector storage
CREATE EXTENSION IF NOT EXISTS vector;

-- Embeddings (for RAG - stores vectorized chunks of ALL content: NGOs, grants, applications, documents, etc.)
CREATE TABLE IF NOT EXISTS embeddings (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    source_table VARCHAR(50) NOT NULL, -- ngos, grants, applications, application_content, chat_messages, etc.
    source_id UUID NOT NULL, -- ID from the source table
    source_field VARCHAR(100), -- which field was embedded (description, about, content, etc.)
    chunk_index INTEGER DEFAULT 0, -- For ordering chunks from same source
    chunk_text TEXT NOT NULL, -- The actual text chunk
    embedding vector(1536), -- OpenAI ada-002 embeddings are 1536 dimensions
    metadata JSONB DEFAULT '{}', -- Additional context (ngo_id, grant_id, language, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- RAG Context Cache (for storing retrieved context per chat/session)
CREATE TABLE IF NOT EXISTS rag_context_cache (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
    session_id VARCHAR(255), -- For non-chat contexts
    context_key VARCHAR(255) NOT NULL, -- Cache key for Redis
    retrieved_chunks JSONB NOT NULL, -- Array of retrieved chunks with scores
    query_embedding vector(1536), -- The query that generated this context
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chat_id, context_key)
);

-- Embedding Queue (tracks what needs to be embedded/re-embedded)
CREATE TABLE IF NOT EXISTS embedding_queue (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    source_table VARCHAR(50) NOT NULL,
    source_id UUID NOT NULL,
    operation VARCHAR(20) NOT NULL, -- insert, update, delete
    priority INTEGER DEFAULT 5, -- 1-10, lower is higher priority
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(source_table, source_id, operation)
);


-- Indexes for performance
CREATE INDEX idx_ngos_org_id ON ngos(organization_id);
CREATE INDEX idx_ngos_field_of_work ON ngos(field_of_work);
CREATE INDEX idx_grants_status ON grants(status);
CREATE INDEX idx_grants_deadline ON grants(deadline);
CREATE INDEX idx_grants_category ON grants(category);
CREATE INDEX idx_grants_provider ON grants(provider);
CREATE INDEX idx_grants_amount_range ON grants(amount_min, amount_max);
CREATE INDEX idx_applications_ngo_id ON applications(ngo_id);
CREATE INDEX idx_applications_grant_id ON applications(grant_id);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_submission_date ON applications(submission_date);
CREATE INDEX idx_application_attachments_app_id ON application_attachments(application_id);
CREATE INDEX idx_application_attachments_file_id ON application_attachments(file_id);
CREATE INDEX idx_grant_documents_grant_id ON grant_documents(grant_id);
CREATE INDEX idx_grant_documents_file_id ON grant_documents(file_id);
CREATE INDEX idx_application_content_versions_content_id ON application_content_versions(application_content_id);
CREATE INDEX idx_chats_ngo_id ON chats(ngo_id);
CREATE INDEX idx_chats_application_id ON chats(application_id);
CREATE INDEX idx_chats_grant_id ON chats(grant_id);
CREATE INDEX idx_chats_created_by ON chats(created_by);
CREATE INDEX idx_chats_context_type ON chats(context_type);
CREATE INDEX idx_chats_status ON chats(status);
CREATE INDEX idx_chat_messages_chat_id ON chat_messages(chat_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX idx_grant_matches_ngo_id ON grant_matches(ngo_id);
CREATE INDEX idx_grant_matches_grant_id ON grant_matches(grant_id);
CREATE INDEX idx_grant_matches_status ON grant_matches(match_status);
CREATE INDEX idx_grant_matches_score ON grant_matches(match_score DESC);
CREATE INDEX idx_grant_matches_expires ON grant_matches(expires_at);
CREATE INDEX idx_grant_matches_matching_points ON grant_matches USING gin(matching_points);
CREATE INDEX idx_grant_matches_missing_points ON grant_matches USING gin(missing_points);
CREATE INDEX idx_grant_matches_suggestions ON grant_matches USING gin(suggestions);
CREATE INDEX idx_ngo_snippets_ngo_id ON ngo_snippets(ngo_id);
CREATE INDEX idx_ngo_snippets_type ON ngo_snippets(snippet_type);
CREATE INDEX idx_ngo_snippets_active ON ngo_snippets(is_active);
CREATE INDEX idx_ngo_snippets_global ON ngo_snippets(is_global);
CREATE INDEX idx_application_content_ngo_id ON application_content(ngo_id);
CREATE INDEX idx_application_content_application_id ON application_content(application_id);
CREATE INDEX idx_application_content_created_by ON application_content(created_by);
CREATE INDEX idx_application_content_kind ON application_content(kind);
CREATE INDEX idx_application_content_suggestions_content ON application_content_suggestions(application_content_id);
CREATE INDEX idx_application_content_suggestions_resolved ON application_content_suggestions(is_resolved);
CREATE INDEX idx_application_content_suggestions_created_by ON application_content_suggestions(created_by);
CREATE INDEX idx_message_votes_user ON message_votes(user_id);
CREATE INDEX idx_extracted_data_chat_id ON extracted_data(chat_id);
CREATE INDEX idx_extracted_data_entity_type ON extracted_data(entity_type);
CREATE INDEX idx_extracted_data_validation_status ON extracted_data(validation_status);

-- Vector similarity search indexes (using ivfflat for better performance)
CREATE INDEX idx_embeddings_vector ON embeddings 
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
CREATE INDEX idx_rag_context_cache_query_vector ON rag_context_cache 
    USING ivfflat (query_embedding vector_cosine_ops)
    WITH (lists = 100);

-- Regular indexes for embeddings
CREATE INDEX idx_embeddings_source ON embeddings(source_table, source_id);
CREATE INDEX idx_embeddings_metadata ON embeddings USING gin(metadata);
CREATE INDEX idx_rag_context_cache_chat_id ON rag_context_cache(chat_id);
CREATE INDEX idx_rag_context_cache_expires ON rag_context_cache(expires_at);
CREATE INDEX idx_embedding_queue_status_priority ON embedding_queue(status, priority);
CREATE INDEX idx_embedding_queue_source ON embedding_queue(source_table, source_id);

-- Full text search indexes for comprehensive searching
CREATE INDEX idx_ngos_search ON ngos USING gin(
    to_tsvector('english', 
        COALESCE(about, '') || ' ' || 
        COALESCE(field_of_work, '') || ' ' ||
        COALESCE(legal_entity, '')
    )
);

CREATE INDEX idx_grants_search ON grants USING gin(
    to_tsvector('english', 
        name || ' ' || 
        COALESCE(description, '') || ' ' || 
        COALESCE(provider, '') || ' ' ||
        COALESCE(category, '') || ' ' ||
        COALESCE(type, '') || ' ' ||
        COALESCE(eligibility_criteria, '') || ' ' ||
        COALESCE(application_process, '')
    )
);

CREATE INDEX idx_applications_search ON applications USING gin(
    to_tsvector('english', 
        COALESCE(title, '') || ' ' || 
        COALESCE(project_title, '') || ' ' ||
        COALESCE(project_description, '') || ' ' ||
        COALESCE(problem_statement, '') || ' ' ||
        COALESCE(target_audience, '') || ' ' ||
        COALESCE(proposed_solution, '') || ' ' ||
        COALESCE(expected_outcomes, '')
    )
);

-- JSONB indexes for metadata searching
CREATE INDEX idx_applications_metadata ON applications USING gin(metadata);
CREATE INDEX idx_grants_metadata ON grants USING gin(metadata);
CREATE INDEX idx_ngos_metadata ON ngos USING gin(metadata);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update trigger to relevant tables
CREATE TRIGGER update_ngos_updated_at BEFORE UPDATE ON ngos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_grants_updated_at BEFORE UPDATE ON grants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_applications_updated_at BEFORE UPDATE ON applications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chats_updated_at BEFORE UPDATE ON chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_grant_matches_updated_at BEFORE UPDATE ON grant_matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ngo_snippets_updated_at BEFORE UPDATE ON ngo_snippets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_application_content_updated_at BEFORE UPDATE ON application_content
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_message_votes_updated_at BEFORE UPDATE ON message_votes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_extracted_data_updated_at BEFORE UPDATE ON extracted_data
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_embeddings_updated_at BEFORE UPDATE ON embeddings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes for translation group lookups
CREATE INDEX idx_ngos_translation_group ON ngos(translation_group_id);
CREATE INDEX idx_grants_translation_group ON grants(translation_group_id);
CREATE INDEX idx_applications_translation_group ON applications(translation_group_id);
CREATE INDEX idx_ngo_snippets_translation_group ON ngo_snippets(translation_group_id);

-- Indexes for language lookups
CREATE INDEX idx_ngos_language ON ngos(language);
CREATE INDEX idx_grants_language ON grants(language);
CREATE INDEX idx_applications_language ON applications(language);
CREATE INDEX idx_ngo_snippets_language ON ngo_snippets(language);

-- AI Activity Logs (for tracking AI-specific user interactions and history)
-- This is separate from yp_activity which tracks system-level CRUD operations
CREATE TABLE IF NOT EXISTS ai_activity_logs (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES yp_users(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL, -- chat_created, application_content_created, suggestion_applied, vote_cast, embedding_generated, etc.
    entity_type VARCHAR(50), -- chats, application_content, chat_messages, application_content_suggestions, ngos, grants, applications
    entity_id UUID,
    description TEXT,
    metadata JSONB DEFAULT '{}', -- Store additional context like model used, token count, response time, etc.
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- AI Activity logs indexes for performance
CREATE INDEX idx_ai_user_activity ON ai_activity_logs(user_id, created_at DESC);
CREATE INDEX idx_ai_activity_type ON ai_activity_logs(activity_type);
CREATE INDEX idx_ai_entity ON ai_activity_logs(entity_type, entity_id);
CREATE INDEX idx_ai_activity_created_at ON ai_activity_logs(created_at);

-- Comment for clarity
COMMENT ON TABLE ai_activity_logs IS 'Tracks AI-specific user interactions like chat sessions, application content generation, suggestions, and votes. Separate from yp_activity which handles system CRUD operations.';

-- ============================================
-- Document Extracts Table
-- ============================================
-- Stores parsed text content from uploaded files (PDFs, Word docs, Excel sheets)
-- This enables full-text search and provides context for AI responses about grant requirements, application guidelines, etc.

CREATE TABLE IF NOT EXISTS document_extracts (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    file_id UUID NOT NULL REFERENCES yp_files(id) ON DELETE CASCADE UNIQUE, -- One extract per file
    content_text TEXT NOT NULL, -- Full extracted text from the document
    word_count INTEGER DEFAULT 0,
    page_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}', -- Can store document structure, headings, tables, etc.
    extracted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES yp_users(id) ON DELETE CASCADE,
    updated_by UUID REFERENCES yp_users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for document_extracts
CREATE INDEX idx_document_extracts_file ON document_extracts(file_id);
CREATE INDEX idx_document_extracts_created_by ON document_extracts(created_by);
CREATE INDEX idx_document_extracts_extracted_at ON document_extracts(extracted_at DESC);
-- Full-text search index for content
CREATE INDEX idx_document_extracts_content_text ON document_extracts USING gin(to_tsvector('english', content_text));

-- Comment for clarity
COMMENT ON TABLE document_extracts IS 'Stores complete extracted text from uploaded documents (PDF, Word, Excel) for full-context RAG retrieval. While embeddings store chunks, this table maintains the full document text for comprehensive AI responses about grant requirements, guidelines, and specifications.';

-- ============================================
-- Grant Extraction Queue Table
-- ============================================
-- Queue for batch processing grant documents
CREATE TABLE IF NOT EXISTS grant_extraction_queue (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    batch_id UUID NOT NULL, -- Groups files uploaded together
    grant_id UUID REFERENCES grants(id) ON DELETE CASCADE, -- Will be populated after extraction
    file_id UUID NOT NULL REFERENCES yp_files(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    error_message TEXT,
    extracted_data JSONB, -- Store extracted grant data per file
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES yp_users(id),
    UNIQUE(batch_id, file_id)
);

-- Indexes for grant extraction queue
CREATE INDEX idx_grant_extraction_queue_batch ON grant_extraction_queue(batch_id);
CREATE INDEX idx_grant_extraction_queue_status ON grant_extraction_queue(status);
CREATE INDEX idx_grant_extraction_queue_created ON grant_extraction_queue(created_at);

COMMENT ON TABLE grant_extraction_queue IS 'Queue for processing grant document uploads in batches. Tracks individual file processing status and aggregates results when all files in a batch are complete.';
