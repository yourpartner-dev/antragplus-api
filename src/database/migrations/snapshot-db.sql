-- public.embedding_queue definition

-- Drop table

-- DROP TABLE embedding_queue;

CREATE TABLE embedding_queue (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	source_table varchar(50) NOT NULL,
	source_id uuid NOT NULL,
	operation varchar(20) NOT NULL,
	priority int4 DEFAULT 5 NULL,
	retry_count int4 DEFAULT 0 NULL,
	max_retries int4 DEFAULT 3 NULL,
	status varchar(20) DEFAULT 'pending'::character varying NULL,
	error_message text NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	processed_at timestamptz NULL,
	CONSTRAINT embedding_queue_pkey PRIMARY KEY (id),
	CONSTRAINT embedding_queue_source_table_source_id_operation_key UNIQUE (source_table, source_id, operation)
);
CREATE INDEX idx_embedding_queue_source ON public.embedding_queue USING btree (source_table, source_id);
CREATE INDEX idx_embedding_queue_status_priority ON public.embedding_queue USING btree (status, priority);

-- Permissions

ALTER TABLE embedding_queue OWNER TO postgres;
GRANT ALL ON TABLE embedding_queue TO postgres;


-- public.embeddings definition

-- Drop table

-- DROP TABLE embeddings;

CREATE TABLE embeddings (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	source_table varchar(50) NOT NULL,
	source_id uuid NOT NULL,
	source_field varchar(100) NULL,
	chunk_index int4 DEFAULT 0 NULL,
	chunk_text text NOT NULL,
	embedding public.vector NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	CONSTRAINT embeddings_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_embeddings_metadata ON public.embeddings USING gin (metadata);
CREATE INDEX idx_embeddings_source ON public.embeddings USING btree (source_table, source_id);
CREATE INDEX idx_embeddings_vector ON public.embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists='100');

-- Table Triggers

create trigger update_embeddings_updated_at before
update
    on
    public.embeddings for each row execute function update_updated_at_column();

-- Permissions

ALTER TABLE embeddings OWNER TO postgres;
GRANT ALL ON TABLE embeddings TO postgres;


-- public.translation_groups definition

-- Drop table

-- DROP TABLE translation_groups;

CREATE TABLE translation_groups (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	CONSTRAINT translation_groups_pkey PRIMARY KEY (id)
);

-- Permissions

ALTER TABLE translation_groups OWNER TO postgres;
GRANT ALL ON TABLE translation_groups TO postgres;


-- public.yp_activity definition

-- Drop table

-- DROP TABLE yp_activity;

CREATE TABLE yp_activity (
	id serial4 NOT NULL,
	"action" varchar(45) NOT NULL,
	"user" uuid NULL,
	"timestamp" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
	ip varchar(50) NOT NULL,
	user_agent varchar(255) NULL,
	collection varchar(64) NOT NULL,
	item varchar(255) NOT NULL,
	"comment" text NULL,
	CONSTRAINT yp_activity_pkey PRIMARY KEY (id)
);

-- Permissions

ALTER TABLE yp_activity OWNER TO postgres;
GRANT ALL ON TABLE yp_activity TO postgres;


-- public.yp_folders definition

-- Drop table

-- DROP TABLE yp_folders;

CREATE TABLE yp_folders (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	parent uuid NULL,
	CONSTRAINT yp_folders_pkey PRIMARY KEY (id)
);

-- Permissions

ALTER TABLE yp_folders OWNER TO postgres;
GRANT ALL ON TABLE yp_folders TO postgres;


-- public.yp_migrations definition

-- Drop table

-- DROP TABLE yp_migrations;

CREATE TABLE yp_migrations (
	"version" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"timestamp" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT yp_migrations_pkey PRIMARY KEY (version)
);

-- Permissions

ALTER TABLE yp_migrations OWNER TO postgres;
GRANT ALL ON TABLE yp_migrations TO postgres;


-- public.yp_organizations definition

-- Drop table

-- DROP TABLE yp_organizations;

CREATE TABLE yp_organizations (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	company_name varchar(255) NULL,
	billing_address varchar(255) NULL,
	domain_name varchar(255) NULL,
	website_url varchar(255) NULL,
	contact_email varchar(255) NULL,
	contact_phone varchar(255) NULL,
	contact_name varchar(255) NULL,
	logo uuid NULL,
	registration_number varchar(255) NULL,
	status varchar(255) DEFAULT 'active'::character varying NOT NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
	metadata jsonb NULL,
	CONSTRAINT yp_organizations_pkey PRIMARY KEY (id)
);

-- Permissions

ALTER TABLE yp_organizations OWNER TO postgres;
GRANT ALL ON TABLE yp_organizations TO postgres;


-- public.yp_roles definition

-- Drop table

-- DROP TABLE yp_roles;

CREATE TABLE yp_roles (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	description text NULL,
	ip_access text NULL,
	enforce_tfa bool DEFAULT false NOT NULL,
	admin_access bool DEFAULT false NOT NULL,
	app_access bool DEFAULT true NOT NULL,
	CONSTRAINT yp_roles_pkey PRIMARY KEY (id)
);

-- Permissions

ALTER TABLE yp_roles OWNER TO postgres;
GRANT ALL ON TABLE yp_roles TO postgres;


-- public.yp_translations definition

-- Drop table

-- DROP TABLE yp_translations;

CREATE TABLE yp_translations (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	"language" varchar(10) NOT NULL,
	"key" varchar(255) NOT NULL,
	value varchar(255) NULL,
	"timestamp" timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	CONSTRAINT yp_translations_pkey PRIMARY KEY (id)
);

-- Permissions

ALTER TABLE yp_translations OWNER TO postgres;
GRANT ALL ON TABLE yp_translations TO postgres;


-- public.grants definition

-- Drop table

-- DROP TABLE grants;

CREATE TABLE grants (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	translation_group_id uuid NULL,
	"language" varchar(5) DEFAULT 'en-US'::character varying NULL,
	"name" varchar(255) NULL,
	description text NULL,
	provider varchar(255) NULL,
	category text NULL, -- Education, Healthcare, Environment, etc. (Updated to TEXT for AI flexibility)
	"type" text NULL, -- Project-based, Operating, Capacity Building, etc. (Updated to TEXT for AI flexibility)
	amount_min numeric(15, 2) NULL,
	amount_max numeric(15, 2) NULL,
	currency varchar(3) DEFAULT 'EUR'::character varying NULL,
	deadline date NULL,
	duration_months int4 NULL,
	eligibility_criteria text NULL,
	required_documents _text NULL,
	application_process text NULL,
	evaluation_criteria text NULL,
	reporting_requirements text NULL,
	status varchar(50) DEFAULT 'active'::character varying NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	updated_by uuid NULL,
	"location" text NULL, -- Geographic location where NGO should be (e.g. specific region in Germany or EU)
	reference_number text NULL, -- Official reference number for documentation and reference (Updated to TEXT for AI flexibility)
	contact_person text NULL, -- Person responsible for this grant (Updated to TEXT for AI flexibility)
	contact_number text NULL, -- Phone number of responsible person (Updated to TEXT for AI flexibility)
	contact_email text NULL, -- Email of reference person (Updated to TEXT for AI flexibility)
	company_size text NULL, -- Size of companies that can apply (Updated to TEXT for AI flexibility)
	funding_frequency text NULL, -- How often they fund NGOs (Updated to TEXT for AI flexibility)
	decision_timeline text NULL, -- When they will likely make a decision
	year_of_program_establishment int4 NULL, -- When the grant program was established
	CONSTRAINT grants_pkey PRIMARY KEY (id),
	CONSTRAINT grants_translation_group_id_fkey FOREIGN KEY (translation_group_id) REFERENCES translation_groups(id)
);
CREATE INDEX idx_grants_amount_range ON public.grants USING btree (amount_min, amount_max);
CREATE INDEX idx_grants_category ON public.grants USING btree (category);
CREATE INDEX idx_grants_deadline ON public.grants USING btree (deadline);
CREATE INDEX idx_grants_language ON public.grants USING btree (language);
CREATE INDEX idx_grants_metadata ON public.grants USING gin (metadata);
CREATE INDEX idx_grants_provider ON public.grants USING btree (provider);
CREATE INDEX idx_grants_search ON public.grants USING gin (to_tsvector('english'::regconfig, (((((((((((((name)::text || ' '::text) || COALESCE(description, ''::text)) || ' '::text) || (COALESCE(provider, ''::character varying))::text) || ' '::text) || COALESCE(category, (''::character varying)::text)) || ' '::text) || COALESCE(type, (''::character varying)::text)) || ' '::text) || COALESCE(eligibility_criteria, ''::text)) || ' '::text) || COALESCE(application_process, ''::text))));
CREATE INDEX idx_grants_status ON public.grants USING btree (status);
CREATE INDEX idx_grants_translation_group ON public.grants USING btree (translation_group_id);

-- Column comments

COMMENT ON COLUMN public.grants.category IS 'Education, Healthcare, Environment, etc. (Updated to TEXT for AI flexibility)';
COMMENT ON COLUMN public.grants."type" IS 'Project-based, Operating, Capacity Building, etc. (Updated to TEXT for AI flexibility)';
COMMENT ON COLUMN public.grants."location" IS 'Geographic location where NGO should be (e.g. specific region in Germany or EU)';
COMMENT ON COLUMN public.grants.reference_number IS 'Official reference number for documentation and reference (Updated to TEXT for AI flexibility)';
COMMENT ON COLUMN public.grants.contact_person IS 'Person responsible for this grant (Updated to TEXT for AI flexibility)';
COMMENT ON COLUMN public.grants.contact_number IS 'Phone number of responsible person (Updated to TEXT for AI flexibility)';
COMMENT ON COLUMN public.grants.contact_email IS 'Email of reference person (Updated to TEXT for AI flexibility)';
COMMENT ON COLUMN public.grants.company_size IS 'Size of companies that can apply (Updated to TEXT for AI flexibility)';
COMMENT ON COLUMN public.grants.funding_frequency IS 'How often they fund NGOs (Updated to TEXT for AI flexibility)';
COMMENT ON COLUMN public.grants.decision_timeline IS 'When they will likely make a decision';
COMMENT ON COLUMN public.grants.year_of_program_establishment IS 'When the grant program was established';

-- Table Triggers

create trigger update_grants_updated_at before
update
    on
    public.grants for each row execute function update_updated_at_column();

-- Permissions

ALTER TABLE grants OWNER TO postgres;
GRANT ALL ON TABLE grants TO postgres;


-- public.ngos definition

-- Drop table

-- DROP TABLE ngos;

CREATE TABLE ngos (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	organization_id uuid NOT NULL,
	translation_group_id uuid NULL,
	"language" varchar(5) DEFAULT 'en-US'::character varying NULL,
	about text NULL,
	"location" varchar(255) NULL,
	legal_entity varchar(100) NULL,
	field_of_work varchar(255) NULL,
	company_size varchar(50) NULL,
	tax_id varchar(100) NULL,
	funding_type varchar(255) NULL,
	application_size varchar(100) NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	updated_by uuid NULL,
	CONSTRAINT ngos_organization_id_key UNIQUE (organization_id),
	CONSTRAINT ngos_pkey PRIMARY KEY (id),
	CONSTRAINT ngos_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES yp_organizations(id) ON DELETE CASCADE,
	CONSTRAINT ngos_translation_group_id_fkey FOREIGN KEY (translation_group_id) REFERENCES translation_groups(id)
);
CREATE INDEX idx_ngos_field_of_work ON public.ngos USING btree (field_of_work);
CREATE INDEX idx_ngos_language ON public.ngos USING btree (language);
CREATE INDEX idx_ngos_metadata ON public.ngos USING gin (metadata);
CREATE INDEX idx_ngos_org_id ON public.ngos USING btree (organization_id);
CREATE INDEX idx_ngos_search ON public.ngos USING gin (to_tsvector('english'::regconfig, ((((COALESCE(about, ''::text) || ' '::text) || (COALESCE(field_of_work, ''::character varying))::text) || ' '::text) || (COALESCE(legal_entity, ''::character varying))::text)));
CREATE INDEX idx_ngos_translation_group ON public.ngos USING btree (translation_group_id);

-- Table Triggers

create trigger update_ngos_updated_at before
update
    on
    public.ngos for each row execute function update_updated_at_column();

-- Permissions

ALTER TABLE ngos OWNER TO postgres;
GRANT ALL ON TABLE ngos TO postgres;


-- public.yp_permissions definition

-- Drop table

-- DROP TABLE yp_permissions;

CREATE TABLE yp_permissions (
	id serial4 NOT NULL,
	"role" uuid NULL,
	collection varchar(64) NOT NULL,
	"action" varchar(10) NOT NULL,
	permissions json NULL,
	validation json NULL,
	fields text NULL,
	CONSTRAINT yp_permissions_pkey PRIMARY KEY (id),
	CONSTRAINT yp_permissions_role_foreign FOREIGN KEY ("role") REFERENCES yp_roles(id)
);

-- Permissions

ALTER TABLE yp_permissions OWNER TO postgres;
GRANT ALL ON TABLE yp_permissions TO postgres;


-- public.yp_revisions definition

-- Drop table

-- DROP TABLE yp_revisions;

CREATE TABLE yp_revisions (
	id serial4 NOT NULL,
	activity int4 NOT NULL,
	collection varchar(64) NOT NULL,
	item varchar(255) NOT NULL,
	"data" json NULL,
	delta json NULL,
	parent int4 NULL,
	CONSTRAINT yp_revisions_pkey PRIMARY KEY (id),
	CONSTRAINT yp_revisions_activity_foreign FOREIGN KEY (activity) REFERENCES yp_activity(id),
	CONSTRAINT yp_revisions_parent_foreign FOREIGN KEY (parent) REFERENCES yp_revisions(id)
);

-- Permissions

ALTER TABLE yp_revisions OWNER TO postgres;
GRANT ALL ON TABLE yp_revisions TO postgres;


-- public.yp_users definition

-- Drop table

-- DROP TABLE yp_users;

CREATE TABLE yp_users (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	first_name varchar(50) NULL,
	last_name varchar(50) NULL,
	email varchar(128) NOT NULL,
	"password" varchar(255) NULL,
	title varchar(50) NULL,
	description text NULL,
	tags json NULL,
	avatar uuid NULL,
	"language" varchar(8) DEFAULT 'en-US'::character varying NULL,
	theme varchar(20) DEFAULT 'auto'::character varying NULL,
	tfa_secret varchar(255) NULL,
	status varchar(16) DEFAULT 'active'::character varying NOT NULL,
	"role" uuid NULL,
	"token" varchar(255) NULL,
	last_access timestamptz NULL,
	last_page varchar(255) NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
	email_notifications bool DEFAULT true NOT NULL,
	provider varchar(255) DEFAULT 'default'::character varying NULL,
	external_identifier varchar(255) NULL,
	auth_data json NULL,
	metadata json NULL,
	organization_id uuid NULL,
	CONSTRAINT yp_users_email_unique UNIQUE (email),
	CONSTRAINT yp_users_pkey PRIMARY KEY (id),
	CONSTRAINT yp_users_organization_id_foreign FOREIGN KEY (organization_id) REFERENCES yp_organizations(id),
	CONSTRAINT yp_users_role_foreign FOREIGN KEY ("role") REFERENCES yp_roles(id)
);

-- Permissions

ALTER TABLE yp_users OWNER TO postgres;
GRANT ALL ON TABLE yp_users TO postgres;


-- public.ai_activity_logs definition

-- Drop table

-- DROP TABLE ai_activity_logs;

CREATE TABLE ai_activity_logs (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	user_id uuid NOT NULL,
	activity_type varchar(50) NOT NULL,
	entity_type varchar(50) NULL,
	entity_id uuid NULL,
	description text NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	ip_address varchar(45) NULL,
	user_agent text NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	CONSTRAINT ai_activity_logs_pkey PRIMARY KEY (id),
	CONSTRAINT ai_activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES yp_users(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_activity_created_at ON public.ai_activity_logs USING btree (created_at);
CREATE INDEX idx_ai_activity_type ON public.ai_activity_logs USING btree (activity_type);
CREATE INDEX idx_ai_entity ON public.ai_activity_logs USING btree (entity_type, entity_id);
CREATE INDEX idx_ai_user_activity ON public.ai_activity_logs USING btree (user_id, created_at DESC);
COMMENT ON TABLE public.ai_activity_logs IS 'Tracks AI-specific user interactions like chat sessions, document generation, suggestions, and votes. Separate from yp_activity which handles system CRUD operations.';

-- Permissions

ALTER TABLE ai_activity_logs OWNER TO postgres;
GRANT ALL ON TABLE ai_activity_logs TO postgres;


-- public.applications definition

-- Drop table

-- DROP TABLE applications;

CREATE TABLE applications (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	ngo_id uuid NOT NULL,
	grant_id uuid NOT NULL,
	translation_group_id uuid NULL,
	"language" varchar(5) DEFAULT 'en-US'::character varying NULL,
	title varchar(255) NULL,
	status varchar(50) DEFAULT 'draft'::character varying NULL,
	submission_date timestamptz NULL,
	decision_date timestamptz NULL,
	requested_amount numeric(15, 2) NULL,
	approved_amount numeric(15, 2) NULL,
	project_title varchar(255) NULL,
	project_description text NULL,
	problem_statement text NULL,
	target_audience text NULL,
	proposed_solution text NULL,
	expected_outcomes text NULL,
	budget_breakdown jsonb DEFAULT '{}'::jsonb NULL,
	timeline jsonb DEFAULT '{}'::jsonb NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	updated_by uuid NULL,
	CONSTRAINT applications_ngo_id_grant_id_key UNIQUE (ngo_id, grant_id),
	CONSTRAINT applications_pkey PRIMARY KEY (id),
	CONSTRAINT applications_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES grants(id) ON DELETE CASCADE,
	CONSTRAINT applications_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES ngos(id) ON DELETE CASCADE,
	CONSTRAINT applications_translation_group_id_fkey FOREIGN KEY (translation_group_id) REFERENCES translation_groups(id)
);
CREATE INDEX idx_applications_grant_id ON public.applications USING btree (grant_id);
CREATE INDEX idx_applications_language ON public.applications USING btree (language);
CREATE INDEX idx_applications_metadata ON public.applications USING gin (metadata);
CREATE INDEX idx_applications_ngo_id ON public.applications USING btree (ngo_id);
CREATE INDEX idx_applications_search ON public.applications USING gin (to_tsvector('english'::regconfig, (((((((((((((COALESCE(title, ''::character varying))::text || ' '::text) || (COALESCE(project_title, ''::character varying))::text) || ' '::text) || COALESCE(project_description, ''::text)) || ' '::text) || COALESCE(problem_statement, ''::text)) || ' '::text) || COALESCE(target_audience, ''::text)) || ' '::text) || COALESCE(proposed_solution, ''::text)) || ' '::text) || COALESCE(expected_outcomes, ''::text))));
CREATE INDEX idx_applications_status ON public.applications USING btree (status);
CREATE INDEX idx_applications_submission_date ON public.applications USING btree (submission_date);
CREATE INDEX idx_applications_translation_group ON public.applications USING btree (translation_group_id);

-- Table Triggers

create trigger update_applications_updated_at before
update
    on
    public.applications for each row execute function update_updated_at_column();

-- Permissions

ALTER TABLE applications OWNER TO postgres;
GRANT ALL ON TABLE applications TO postgres;


-- public.chats definition

-- Drop table

-- DROP TABLE chats;

CREATE TABLE chats (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	title text NOT NULL,
	ngo_id uuid NULL,
	application_id uuid NULL,
	grant_id uuid NULL,
	context_type varchar(50) NULL,
	visibility varchar(20) DEFAULT 'private'::character varying NULL,
	status varchar(20) DEFAULT 'active'::character varying NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NOT NULL,
	updated_by uuid NULL,
	CONSTRAINT chats_pkey PRIMARY KEY (id),
	CONSTRAINT chats_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
	CONSTRAINT chats_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES grants(id) ON DELETE CASCADE,
	CONSTRAINT chats_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES ngos(id) ON DELETE CASCADE
);
CREATE INDEX idx_chats_application_id ON public.chats USING btree (application_id);
CREATE INDEX idx_chats_context_type ON public.chats USING btree (context_type);
CREATE INDEX idx_chats_created_by ON public.chats USING btree (created_by);
CREATE INDEX idx_chats_grant_id ON public.chats USING btree (grant_id);
CREATE INDEX idx_chats_ngo_id ON public.chats USING btree (ngo_id);
CREATE INDEX idx_chats_status ON public.chats USING btree (status);

-- Table Triggers

create trigger update_chats_updated_at before
update
    on
    public.chats for each row execute function update_updated_at_column();

-- Permissions

ALTER TABLE chats OWNER TO postgres;
GRANT ALL ON TABLE chats TO postgres;


-- public.extracted_data definition

-- Drop table

-- DROP TABLE extracted_data;

CREATE TABLE extracted_data (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	chat_id uuid NOT NULL,
	entity_type varchar(50) NOT NULL,
	extracted_fields jsonb NOT NULL,
	confidence_scores jsonb DEFAULT '{}'::jsonb NULL,
	validation_status varchar(20) DEFAULT 'pending'::character varying NULL,
	entity_id uuid NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NOT NULL,
	CONSTRAINT extracted_data_chat_id_entity_type_key UNIQUE (chat_id, entity_type),
	CONSTRAINT extracted_data_pkey PRIMARY KEY (id),
	CONSTRAINT extracted_data_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX idx_extracted_data_chat_id ON public.extracted_data USING btree (chat_id);
CREATE INDEX idx_extracted_data_entity_type ON public.extracted_data USING btree (entity_type);
CREATE INDEX idx_extracted_data_validation_status ON public.extracted_data USING btree (validation_status);

-- Table Triggers

create trigger update_extracted_data_updated_at before
update
    on
    public.extracted_data for each row execute function update_updated_at_column();

-- Permissions

ALTER TABLE extracted_data OWNER TO postgres;
GRANT ALL ON TABLE extracted_data TO postgres;


-- public.grant_matches definition

-- Drop table

-- DROP TABLE grant_matches;

CREATE TABLE grant_matches (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	ngo_id uuid NOT NULL,
	grant_id uuid NOT NULL,
	match_score numeric(3, 2) NULL,
	match_status varchar(50) DEFAULT 'active'::character varying NULL,
	summary text NOT NULL,
	analysis text NOT NULL,
	matching_criteria jsonb DEFAULT '{}'::jsonb NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	expires_at timestamptz NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	matching_points _text DEFAULT '{}'::text[] NULL, -- Array of specific points explaining why this grant matches the NGO
	missing_points _text DEFAULT '{}'::text[] NULL, -- Array of specific requirements or criteria that the NGO is missing for this grant
	suggestions _text DEFAULT '{}'::text[] NULL, -- Array of actionable suggestions to improve the NGO's eligibility for this grant
	CONSTRAINT grant_matches_ngo_id_grant_id_key UNIQUE (ngo_id, grant_id),
	CONSTRAINT grant_matches_pkey PRIMARY KEY (id),
	CONSTRAINT grant_matches_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES grants(id) ON DELETE CASCADE,
	CONSTRAINT grant_matches_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES ngos(id) ON DELETE CASCADE
);
CREATE INDEX idx_grant_matches_expires ON public.grant_matches USING btree (expires_at);
CREATE INDEX idx_grant_matches_grant_id ON public.grant_matches USING btree (grant_id);
CREATE INDEX idx_grant_matches_matching_points ON public.grant_matches USING gin (matching_points);
CREATE INDEX idx_grant_matches_missing_points ON public.grant_matches USING gin (missing_points);
CREATE INDEX idx_grant_matches_ngo_id ON public.grant_matches USING btree (ngo_id);
CREATE INDEX idx_grant_matches_score ON public.grant_matches USING btree (match_score DESC);
CREATE INDEX idx_grant_matches_status ON public.grant_matches USING btree (match_status);
CREATE INDEX idx_grant_matches_suggestions ON public.grant_matches USING gin (suggestions);

-- Column comments

COMMENT ON COLUMN public.grant_matches.matching_points IS 'Array of specific points explaining why this grant matches the NGO';
COMMENT ON COLUMN public.grant_matches.missing_points IS 'Array of specific requirements or criteria that the NGO is missing for this grant';
COMMENT ON COLUMN public.grant_matches.suggestions IS 'Array of actionable suggestions to improve the NGO''s eligibility for this grant';

-- Table Triggers

create trigger update_grant_matches_updated_at before
update
    on
    public.grant_matches for each row execute function update_updated_at_column();

-- Permissions

ALTER TABLE grant_matches OWNER TO postgres;
GRANT ALL ON TABLE grant_matches TO postgres;


-- public.ngo_snippets definition

-- Drop table

-- DROP TABLE ngo_snippets;

CREATE TABLE ngo_snippets (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	ngo_id uuid NOT NULL,
	translation_group_id uuid NULL,
	"language" varchar(5) DEFAULT 'en-US'::character varying NULL,
	title varchar(255) NOT NULL,
	snippet_type varchar(50) NULL,
	"content" text NOT NULL,
	content_format varchar(20) DEFAULT 'text'::character varying NULL,
	is_active bool DEFAULT true NULL,
	is_global bool DEFAULT false NULL,
	usage_count int4 DEFAULT 0 NULL,
	tags _text NULL,
	display_order int4 DEFAULT 0 NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	updated_by uuid NULL,
	CONSTRAINT ngo_snippets_pkey PRIMARY KEY (id),
	CONSTRAINT ngo_snippets_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES ngos(id) ON DELETE CASCADE,
	CONSTRAINT ngo_snippets_translation_group_id_fkey FOREIGN KEY (translation_group_id) REFERENCES translation_groups(id)
);
CREATE INDEX idx_ngo_snippets_active ON public.ngo_snippets USING btree (is_active);
CREATE INDEX idx_ngo_snippets_global ON public.ngo_snippets USING btree (is_global);
CREATE INDEX idx_ngo_snippets_language ON public.ngo_snippets USING btree (language);
CREATE INDEX idx_ngo_snippets_ngo_id ON public.ngo_snippets USING btree (ngo_id);
CREATE INDEX idx_ngo_snippets_translation_group ON public.ngo_snippets USING btree (translation_group_id);
CREATE INDEX idx_ngo_snippets_type ON public.ngo_snippets USING btree (snippet_type);

-- Table Triggers

create trigger update_ngo_snippets_updated_at before
update
    on
    public.ngo_snippets for each row execute function update_updated_at_column();

-- Permissions

ALTER TABLE ngo_snippets OWNER TO postgres;
GRANT ALL ON TABLE ngo_snippets TO postgres;


-- public.rag_context_cache definition

-- Drop table

-- DROP TABLE rag_context_cache;

CREATE TABLE rag_context_cache (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	chat_id uuid NULL,
	session_id varchar(255) NULL,
	context_key varchar(255) NOT NULL,
	retrieved_chunks jsonb NOT NULL,
	query_embedding public.vector NULL,
	expires_at timestamptz NOT NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	CONSTRAINT rag_context_cache_chat_id_context_key_key UNIQUE (chat_id, context_key),
	CONSTRAINT rag_context_cache_pkey PRIMARY KEY (id),
	CONSTRAINT rag_context_cache_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX idx_rag_context_cache_chat_id ON public.rag_context_cache USING btree (chat_id);
CREATE INDEX idx_rag_context_cache_expires ON public.rag_context_cache USING btree (expires_at);
CREATE INDEX idx_rag_context_cache_query_vector ON public.rag_context_cache USING ivfflat (query_embedding vector_cosine_ops) WITH (lists='100');

-- Permissions

ALTER TABLE rag_context_cache OWNER TO postgres;
GRANT ALL ON TABLE rag_context_cache TO postgres;


-- public.yp_files definition

-- Drop table

-- DROP TABLE yp_files;

CREATE TABLE yp_files (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	"storage" varchar(255) NOT NULL,
	filename_disk varchar(255) NULL,
	filename_download varchar(255) NOT NULL,
	title varchar(255) NULL,
	"type" varchar(255) NULL,
	folder uuid NULL,
	uploaded_by uuid NULL,
	uploaded_on timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
	modified_by uuid NULL,
	modified_on timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
	charset varchar(50) NULL,
	filesize int4 DEFAULT 0 NOT NULL,
	width int4 NULL,
	height int4 NULL,
	duration int4 NULL,
	embed varchar(200) NULL,
	description text NULL,
	"location" text NULL,
	tags text NULL,
	metadata json NULL,
	organization_id uuid NULL,
	CONSTRAINT yp_files_pkey PRIMARY KEY (id),
	CONSTRAINT yp_files_folder_foreign FOREIGN KEY (folder) REFERENCES yp_folders(id),
	CONSTRAINT yp_files_modified_by_foreign FOREIGN KEY (modified_by) REFERENCES yp_users(id),
	CONSTRAINT yp_files_organization_id_foreign FOREIGN KEY (organization_id) REFERENCES yp_organizations(id),
	CONSTRAINT yp_files_uploaded_by_foreign FOREIGN KEY (uploaded_by) REFERENCES yp_users(id)
);

-- Permissions

ALTER TABLE yp_files OWNER TO postgres;
GRANT ALL ON TABLE yp_files TO postgres;


-- public.yp_notifications definition

-- Drop table

-- DROP TABLE yp_notifications;

CREATE TABLE yp_notifications (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	recipient uuid NOT NULL,
	sender uuid NULL,
	subject varchar(255) NOT NULL,
	message text NOT NULL,
	collection varchar(255) NULL,
	item varchar(255) NULL,
	CONSTRAINT yp_notifications_pkey PRIMARY KEY (id),
	CONSTRAINT yp_notifications_recipient_foreign FOREIGN KEY (recipient) REFERENCES yp_users(id),
	CONSTRAINT yp_notifications_sender_foreign FOREIGN KEY (sender) REFERENCES yp_users(id)
);

-- Permissions

ALTER TABLE yp_notifications OWNER TO postgres;
GRANT ALL ON TABLE yp_notifications TO postgres;


-- public.yp_sessions definition

-- Drop table

-- DROP TABLE yp_sessions;

CREATE TABLE yp_sessions (
	"token" varchar(64) NOT NULL,
	"user" uuid NOT NULL,
	expires timestamptz NOT NULL,
	ip varchar(255) NULL,
	user_agent varchar(255) NULL,
	next_token varchar(255) NULL,
	origin varchar(255) NULL,
	"share" uuid NULL,
	CONSTRAINT yp_sessions_pkey PRIMARY KEY (token),
	CONSTRAINT yp_sessions_user_foreign FOREIGN KEY ("user") REFERENCES yp_users(id)
);

-- Permissions

ALTER TABLE yp_sessions OWNER TO postgres;
GRANT ALL ON TABLE yp_sessions TO postgres;


-- public.yp_settings definition

-- Drop table

-- DROP TABLE yp_settings;

CREATE TABLE yp_settings (
	id serial4 NOT NULL,
	project_name varchar(100) DEFAULT 'YourPartner'::character varying NOT NULL,
	project_url varchar(255) NULL,
	project_color varchar(10) DEFAULT '#004edb'::character varying NULL,
	project_logo uuid NULL,
	public_favicon uuid NULL,
	auth_login_attempts int4 DEFAULT 25 NULL,
	auth_password_policy varchar(100) NULL,
	public_registration bool DEFAULT false NULL,
	public_registration_verify_email bool DEFAULT true NULL,
	public_registration_role uuid NULL,
	public_registration_email_filter json NULL,
	storage_asset_transform varchar(7) DEFAULT 'all'::character varying NULL,
	storage_asset_presets json NULL,
	storage_default_folder uuid NULL,
	default_language varchar(10) DEFAULT 'en-US'::character varying NULL,
	project_from_email varchar(255) DEFAULT 'noreply@yourpartner.com'::character varying NULL,
	organization_id uuid NULL,
	CONSTRAINT yp_settings_pkey PRIMARY KEY (id),
	CONSTRAINT yp_settings_organization_id_foreign FOREIGN KEY (organization_id) REFERENCES yp_organizations(id),
	CONSTRAINT yp_settings_project_logo_foreign FOREIGN KEY (project_logo) REFERENCES yp_files(id),
	CONSTRAINT yp_settings_public_favicon_foreign FOREIGN KEY (public_favicon) REFERENCES yp_files(id),
	CONSTRAINT yp_settings_public_registration_role_foreign FOREIGN KEY (public_registration_role) REFERENCES yp_roles(id),
	CONSTRAINT yp_settings_storage_default_folder_foreign FOREIGN KEY (storage_default_folder) REFERENCES yp_folders(id)
);

-- Permissions

ALTER TABLE yp_settings OWNER TO postgres;
GRANT ALL ON TABLE yp_settings TO postgres;


-- public.application_attachments definition

-- Drop table

-- DROP TABLE application_attachments;

CREATE TABLE application_attachments (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	application_id uuid NOT NULL,
	file_id uuid NULL,
	document_type varchar(50) NULL,
	"content" text NULL,
	content_format varchar(20) DEFAULT 'text'::character varying NULL,
	is_primary bool DEFAULT false NULL,
	display_order int4 DEFAULT 0 NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	CONSTRAINT application_attachments_application_id_file_id_key UNIQUE (application_id, file_id),
	CONSTRAINT application_attachments_pkey PRIMARY KEY (id),
	CONSTRAINT application_attachments_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
	CONSTRAINT application_attachments_file_id_fkey FOREIGN KEY (file_id) REFERENCES yp_files(id) ON DELETE CASCADE
);
CREATE INDEX idx_application_attachments_app_id ON public.application_attachments USING btree (application_id);
CREATE INDEX idx_application_attachments_file_id ON public.application_attachments USING btree (file_id);

-- Permissions

ALTER TABLE application_attachments OWNER TO postgres;
GRANT ALL ON TABLE application_attachments TO postgres;


-- public.application_content definition

-- Drop table

-- DROP TABLE application_content;

CREATE TABLE application_content (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
	title text NOT NULL,
	"content" text NULL,
	content_format varchar(20) DEFAULT 'text'::character varying NULL,
	kind varchar(20) DEFAULT 'text'::character varying NULL,
	ngo_id uuid NULL,
	application_id uuid NULL,
	created_by uuid NOT NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	updated_by uuid NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	CONSTRAINT application_content_pkey PRIMARY KEY (id),
	CONSTRAINT application_content_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
	CONSTRAINT application_content_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES ngos(id) ON DELETE CASCADE
);
CREATE INDEX idx_application_content_application_id ON public.application_content USING btree (application_id);
CREATE INDEX idx_application_content_created_by ON public.application_content USING btree (created_by);
CREATE INDEX idx_application_content_kind ON public.application_content USING btree (kind);
CREATE INDEX idx_application_content_ngo_id ON public.application_content USING btree (ngo_id);

-- Table Triggers

create trigger update_application_content_updated_at before
update
    on
    public.application_content for each row execute function update_updated_at_column();

-- Permissions

ALTER TABLE application_content OWNER TO postgres;
GRANT ALL ON TABLE application_content TO postgres;


-- public.application_content_suggestions definition

-- Drop table

-- DROP TABLE application_content_suggestions;

CREATE TABLE application_content_suggestions (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	application_content_id uuid NOT NULL,
	original_text text NOT NULL,
	suggested_text text NOT NULL,
	description text NULL,
	suggestion_type varchar(50) NULL,
	confidence_score numeric(3, 2) NULL,
	is_resolved bool DEFAULT false NULL,
	resolution_type varchar(20) NULL,
	created_by uuid NOT NULL,
	resolved_by uuid NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
	resolved_at timestamptz NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	CONSTRAINT application_content_suggestions_pkey PRIMARY KEY (id),
	CONSTRAINT application_content_suggestions_application_content_id_fkey FOREIGN KEY (application_content_id) REFERENCES application_content(id) ON DELETE CASCADE
);
CREATE INDEX idx_application_content_suggestions_content ON public.application_content_suggestions USING btree (application_content_id);
CREATE INDEX idx_application_content_suggestions_created_by ON public.application_content_suggestions USING btree (created_by);
CREATE INDEX idx_application_content_suggestions_resolved ON public.application_content_suggestions USING btree (is_resolved);

-- Permissions

ALTER TABLE application_content_suggestions OWNER TO postgres;
GRANT ALL ON TABLE application_content_suggestions TO postgres;


-- public.application_content_versions definition

-- Drop table

-- DROP TABLE application_content_versions;

CREATE TABLE application_content_versions (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	application_content_id uuid NOT NULL,
	version_number int4 NOT NULL,
	"content" text NULL,
	changes jsonb DEFAULT '{}'::jsonb NULL,
	file_url varchar(500) NULL,
	file_size int8 NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	CONSTRAINT application_content_versions_pkey PRIMARY KEY (id),
	CONSTRAINT application_content_versions_application_content_id_fkey FOREIGN KEY (application_content_id) REFERENCES application_content(id) ON DELETE CASCADE
);
CREATE INDEX idx_application_content_versions_content_id ON public.application_content_versions USING btree (application_content_id);

-- Permissions

ALTER TABLE application_content_versions OWNER TO postgres;
GRANT ALL ON TABLE application_content_versions TO postgres;


-- public.chat_messages definition

-- Drop table

-- DROP TABLE chat_messages;

CREATE TABLE chat_messages (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	chat_id uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NULL,
	parts jsonb NULL,
	attachments jsonb DEFAULT '[]'::jsonb NULL,
	context_type varchar(50) NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	CONSTRAINT chat_messages_pkey PRIMARY KEY (id),
	CONSTRAINT chat_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_messages_chat_id ON public.chat_messages USING btree (chat_id);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (created_at);

-- Permissions

ALTER TABLE chat_messages OWNER TO postgres;
GRANT ALL ON TABLE chat_messages TO postgres;


-- public.document_extracts definition

-- Drop table

-- DROP TABLE document_extracts;

CREATE TABLE document_extracts (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	file_id uuid NOT NULL,
	content_text text NOT NULL,
	word_count int4 DEFAULT 0 NULL,
	page_count int4 DEFAULT 0 NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	extracted_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	updated_by uuid NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	CONSTRAINT document_extracts_file_id_key UNIQUE (file_id),
	CONSTRAINT document_extracts_pkey PRIMARY KEY (id),
	CONSTRAINT document_extracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES yp_users(id) ON DELETE CASCADE,
	CONSTRAINT document_extracts_file_id_fkey FOREIGN KEY (file_id) REFERENCES yp_files(id) ON DELETE CASCADE,
	CONSTRAINT document_extracts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES yp_users(id) ON DELETE CASCADE
);
CREATE INDEX idx_document_extracts_content_text ON public.document_extracts USING gin (to_tsvector('english'::regconfig, content_text));
CREATE INDEX idx_document_extracts_created_by ON public.document_extracts USING btree (created_by);
CREATE INDEX idx_document_extracts_extracted_at ON public.document_extracts USING btree (extracted_at DESC);
CREATE INDEX idx_document_extracts_file ON public.document_extracts USING btree (file_id);
COMMENT ON TABLE public.document_extracts IS 'Stores complete extracted text from uploaded documents (PDF, Word, Excel) for full-context RAG retrieval. While embeddings store chunks, this table maintains the full document text for comprehensive AI responses about grant requirements, guidelines, and specifications.';

-- Permissions

ALTER TABLE document_extracts OWNER TO postgres;
GRANT ALL ON TABLE document_extracts TO postgres;


-- public.grant_documents definition

-- Drop table

-- DROP TABLE grant_documents;

CREATE TABLE grant_documents (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	grant_id uuid NOT NULL,
	file_id uuid NOT NULL,
	document_type varchar(50) NULL,
	is_required bool DEFAULT false NULL,
	display_order int4 DEFAULT 0 NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	CONSTRAINT grant_documents_grant_id_file_id_key UNIQUE (grant_id, file_id),
	CONSTRAINT grant_documents_pkey PRIMARY KEY (id),
	CONSTRAINT grant_documents_file_id_fkey FOREIGN KEY (file_id) REFERENCES yp_files(id) ON DELETE CASCADE,
	CONSTRAINT grant_documents_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES grants(id) ON DELETE CASCADE
);
CREATE INDEX idx_grant_documents_file_id ON public.grant_documents USING btree (file_id);
CREATE INDEX idx_grant_documents_grant_id ON public.grant_documents USING btree (grant_id);

-- Permissions

ALTER TABLE grant_documents OWNER TO postgres;
GRANT ALL ON TABLE grant_documents TO postgres;


-- public.grant_extraction_queue definition

-- Drop table

-- DROP TABLE grant_extraction_queue;

CREATE TABLE grant_extraction_queue (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	batch_id uuid NOT NULL,
	grant_id uuid NULL,
	file_id uuid NOT NULL,
	status varchar(20) DEFAULT 'pending'::character varying NULL,
	retry_count int4 DEFAULT 0 NULL,
	max_retries int4 DEFAULT 3 NULL,
	error_message text NULL,
	extracted_data jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	processed_at timestamptz NULL,
	created_by uuid NULL,
	CONSTRAINT grant_extraction_queue_batch_id_file_id_key UNIQUE (batch_id, file_id),
	CONSTRAINT grant_extraction_queue_pkey PRIMARY KEY (id),
	CONSTRAINT grant_extraction_queue_created_by_fkey FOREIGN KEY (created_by) REFERENCES yp_users(id),
	CONSTRAINT grant_extraction_queue_file_id_fkey FOREIGN KEY (file_id) REFERENCES yp_files(id) ON DELETE CASCADE,
	CONSTRAINT grant_extraction_queue_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES grants(id) ON DELETE CASCADE
);
CREATE INDEX idx_grant_extraction_queue_batch ON public.grant_extraction_queue USING btree (batch_id);
CREATE INDEX idx_grant_extraction_queue_created ON public.grant_extraction_queue USING btree (created_at);
CREATE INDEX idx_grant_extraction_queue_status ON public.grant_extraction_queue USING btree (status);
COMMENT ON TABLE public.grant_extraction_queue IS 'Queue for processing grant document uploads in batches. Tracks individual file processing status and aggregates results when all files in a batch are complete.';

-- Permissions

ALTER TABLE grant_extraction_queue OWNER TO postgres;
GRANT ALL ON TABLE grant_extraction_queue TO postgres;


-- public.message_votes definition

-- Drop table

-- DROP TABLE message_votes;

CREATE TABLE message_votes (
	chat_message_id uuid NOT NULL,
	user_id uuid NOT NULL,
	is_upvoted bool NOT NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	CONSTRAINT message_votes_pkey PRIMARY KEY (chat_message_id, user_id),
	CONSTRAINT message_votes_chat_message_id_fkey FOREIGN KEY (chat_message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
);
CREATE INDEX idx_message_votes_user ON public.message_votes USING btree (user_id);

-- Table Triggers

create trigger update_message_votes_updated_at before
update
    on
    public.message_votes for each row execute function update_updated_at_column();

-- Permissions

ALTER TABLE message_votes OWNER TO postgres;
GRANT ALL ON TABLE message_votes TO postgres;


-- public.ngo_documents definition

-- Drop table

-- DROP TABLE ngo_documents;

CREATE TABLE ngo_documents (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	ngo_id uuid NOT NULL,
	file_id uuid NOT NULL,
	metadata jsonb DEFAULT '{}'::jsonb NULL,
	created_at timestamptz DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	CONSTRAINT ngo_documents_pkey PRIMARY KEY (id),
	CONSTRAINT ngo_documents_file_id_fkey FOREIGN KEY (file_id) REFERENCES yp_files(id) ON DELETE CASCADE,
	CONSTRAINT ngo_documents_ngo_id_fkey FOREIGN KEY (ngo_id) REFERENCES ngos(id) ON DELETE CASCADE
);

-- Permissions

ALTER TABLE ngo_documents OWNER TO postgres;
GRANT ALL ON TABLE ngo_documents TO postgres;