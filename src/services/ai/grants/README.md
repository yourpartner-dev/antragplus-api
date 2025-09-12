# Grant Extraction AI Service

This service handles automatic extraction of structured grant information from uploaded documents using AI.

## Overview

The grant extraction system processes uploaded grant documents (PDFs, Word docs) and automatically extracts structured information to populate the grants database. It uses a queue-based architecture to handle batch processing of multiple documents per grant.

## Architecture

```
File Upload → Document Parser → document_extracts → Grant Extraction Queue → AI Processing → grants table
```

1. **Document Upload**: Files uploaded via frontend
2. **Document Parsing**: Text extraction → stored in `document_extracts`
3. **Queue Processing**: `grant_extraction_queue` processes batches
4. **AI Extraction**: Reads from `document_extracts`, extracts structured data
5. **Grant Creation**: Populates `grants` table with extracted information

## Key Components

### GrantExtractionService
- **`extractGrantFromDocuments()`**: Reads text from `document_extracts`, runs AI analysis
- **`updateGrantWithExtractedData()`**: Updates grants table with structured data
- Uses OpenAI GPT models with structured output via Zod schema

### GrantExtractionQueue  
- Batch processing of uploaded files
- Waits for all files in batch to be parsed
- Runs AI extraction when batch complete
- Stores audit trail in `extracted_data` JSONB column

## AI Extraction Schema

The AI extracts these priority fields:

**Priority 1 (Essential):**
- `name` - Grant title
- `provider` - Funding organization  
- `description` - AI-generated structured content (3 mandatory topics)
- `deadline`, `amount_min/max`, `currency`

**Priority 2 (Important):**
- `category`, `type`, `eligibility_criteria`, `duration_months`, `status`

**Priority 3 (Detailed):**
- `application_process`, `evaluation_criteria`, `reporting_requirements`, `required_documents`

**Priority 4 (Metadata):**
- Contact info, reference numbers (stored in `metadata` JSONB)

## AI-Generated Description

The AI generates comprehensive descriptions covering exactly 3 mandatory topics:

1. **Thematic & Strategic Scope** - Focus areas, target groups, eligible activities
2. **Applicant Eligibility** - Legal requirements, geographic scope, exclusions  
3. **Financial Framework** - Funding type, grant sizes, eligible costs

## Database Tables

- **`grants`**: Main grant records with extracted data
- **`grant_documents`**: Links uploaded files to grants
- **`grant_extraction_queue`**: Processing queue with extracted data audit trail
- **`document_extracts`**: Raw text from uploaded documents

## Configuration

- **AI Model**: Uses Google Gemini for grant extraction via `GEMINI_MODEL` environment variable (default: gemini-1.5-pro-latest)
- **API Key**: Set via `GEMINI_API_KEY` environment variable
- **Context Window**: Gemini 2.5 Flash has large context window perfect for processing multiple documents
- **Queue Processing**: Runs every minute via scheduler
- **Batch Processing**: Groups files uploaded together
- **Max Retries**: 2 attempts for failed extractions
- **Lock Timeout**: 60 seconds for AI processing

## Usage

The service is triggered automatically when grant documents are uploaded. Manual processing can be initiated via the queue management system.

## Error Handling

- Missing document extracts → retry until available
- AI extraction failures → marked as failed with error details
- Batch failures → user notifications sent
- Full audit trail maintained in `extracted_data` column

## Monitoring

Track processing via:
- Queue status in `grant_extraction_queue` table
- AI activity logs in `ai_activity_logs` table
- Confidence scores and extraction metadata
- User notifications for success/failure states