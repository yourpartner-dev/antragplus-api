import { useLogger } from '../../../helpers/logger/index.js';
import type { Readable } from 'node:stream';
import { getStorage } from '../../../storage/index.js';
import getDatabase from '../../../database/index.js';
import mammoth from 'mammoth';
import XLSX from 'xlsx';
// Use createRequire to import pdf-parse and avoid debug mode issue
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const logger = useLogger();

export interface DocumentContent {
  text: string;
  metadata?: Record<string, any>;
  pageCount?: number;
  wordCount?: number;
}

export interface ParserOptions {
  maxSize?: number; // Max file size in bytes (default 50MB)
  maxTextLength?: number; // Max extracted text length (default 500k chars)
  chunkSize?: number; // Chunk size for streaming (default 64KB)
}

const DEFAULT_OPTIONS: ParserOptions = {
  maxSize: 50 * 1024 * 1024, // 50MB
  maxTextLength: 500000, // 500k characters
  chunkSize: 64 * 1024, // 64KB chunks
};

// Supported document types for text extraction
export const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
];

/**
 * Document parser service for extracting text from various file formats
 */
export class DocumentParser {
  private options: ParserOptions;

  constructor(options: Partial<ParserOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Check if a file type is supported for text extraction
   */
  isSupported(mimeType: string): boolean {
    return SUPPORTED_DOCUMENT_TYPES.includes(mimeType);
  }

  /**
   * Parse a document and extract text content
   */
  async parseDocument(
    storageLocation: string,
    filename: string,
    mimeType: string
  ): Promise<DocumentContent | null> {
    if (!this.isSupported(mimeType)) {
      logger.debug(`Unsupported document type for parsing: ${mimeType}`);
      return null;
    }

    logger.info(`Parsing document: ${filename} from storage: ${storageLocation} (${mimeType})`);

    try {
      const storage = await getStorage();
      const stream = await storage.location(storageLocation).read(filename);
      
      // Route to appropriate parser based on mime type
      switch (mimeType) {
        case 'application/pdf':
          return await this.parsePDF(stream);
        
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/msword':
          return await this.parseWord(stream);
        
        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        case 'application/vnd.ms-excel':
          return await this.parseExcel(stream);
        
        case 'text/plain':
        case 'text/csv':
        case 'text/markdown':
        case 'application/json':
          return await this.parseText(stream);
        
        default:
          logger.warn(`No parser available for mime type: ${mimeType}`);
          return null;
      }
    } catch (error) {
      logger.error(error, `Error parsing document: ${filename}`);
      return null;
    }
  }

  /**
   * Parse PDF documents
   */
  private async parsePDF(stream: Readable): Promise<DocumentContent> {
    try {
      // Use static import to avoid debug mode issue with dynamic imports
      
      // Convert stream to buffer for pdf-parse
      const chunks: Buffer[] = [];
      let totalSize = 0;

      for await (const chunk of stream) {
        totalSize += chunk.length;
        if (totalSize > this.options.maxSize!) {
          throw new Error(`PDF exceeds maximum size of ${this.options.maxSize} bytes`);
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks as Uint8Array[]);
      logger.info(`PDF buffer size: ${buffer.length} bytes`);
      
      if (buffer.length === 0) {
        throw new Error('PDF buffer is empty');
      }
      
      const data = await pdfParse(buffer);

      // Truncate if text is too long
      const text = data.text.length > this.options.maxTextLength!
        ? data.text.substring(0, this.options.maxTextLength!) + '...[truncated]'
        : data.text;

      const wordCount = text.split(/\s+/).filter((word: string) => word.length > 0).length;

      return {
        text,
        metadata: {
          parser: 'pdf-parse',
          version: data.version,
          info: data.info,
          originalLength: data.text.length,
          truncated: data.text.length > this.options.maxTextLength!,
        },
        pageCount: data.numpages,
        wordCount,
      };
    } catch (error) {
      logger.error(error, 'Error parsing PDF:');
      throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse Word documents
   */
  private async parseWord(stream: Readable): Promise<DocumentContent> {
    try {
      // Convert stream to buffer for mammoth
      const chunks: Buffer[] = [];
      let totalSize = 0;

      for await (const chunk of stream) {
        totalSize += chunk.length;
        if (totalSize > this.options.maxSize!) {
          throw new Error(`Word document exceeds maximum size of ${this.options.maxSize} bytes`);
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks as Uint8Array[]);
      const result = await mammoth.extractRawText({ buffer });

      // Truncate if text is too long
      const text = result.value.length > this.options.maxTextLength!
        ? result.value.substring(0, this.options.maxTextLength!) + '...[truncated]'
        : result.value;

      const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;

      // Log any conversion messages/warnings
      if (result.messages && result.messages.length > 0) {
        logger.debug('Mammoth conversion messages:', result.messages);
      }

      return {
        text,
        metadata: {
          parser: 'mammoth',
          originalLength: result.value.length,
          truncated: result.value.length > this.options.maxTextLength!,
          messages: result.messages,
        },
        wordCount,
      };
    } catch (error) {
      logger.error(error, 'Error parsing Word document:');
      throw new Error(`Failed to parse Word document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse Excel documents
   */
  private async parseExcel(stream: Readable): Promise<DocumentContent> {
    try {
      // Convert stream to buffer for xlsx
      const chunks: Buffer[] = [];
      let totalSize = 0;

      for await (const chunk of stream) {
        totalSize += chunk.length;
        if (totalSize > this.options.maxSize!) {
          throw new Error(`Excel document exceeds maximum size of ${this.options.maxSize} bytes`);
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks as Uint8Array[]);
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      // Extract text from all sheets
      let allText = '';
      let sheetCount = 0;

      for (const sheetName of workbook.SheetNames) {
        sheetCount++;
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to CSV format for text extraction
        if(worksheet) {
          const csvText = XLSX.utils.sheet_to_csv(worksheet);
          allText += `\n--- Sheet: ${sheetName} ---\n${csvText}\n`;
        }

        // Check text length limit
        if (allText.length > this.options.maxTextLength!) {
          allText = allText.substring(0, this.options.maxTextLength!) + '...[truncated]';
          break;
        }
      }

      const wordCount = allText.split(/\s+/).filter(word => word.length > 0).length;

      return {
        text: allText.trim(),
        metadata: {
          parser: 'xlsx',
          sheetCount,
          sheetNames: workbook.SheetNames,
          originalLength: allText.length,
          truncated: allText.length > this.options.maxTextLength!,
        },
        wordCount,
      };
    } catch (error) {
      logger.error(error, 'Error parsing Excel document:');
      throw new Error(`Failed to parse Excel document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse plain text files (including CSV, JSON, Markdown)
   */
  private async parseText(stream: Readable): Promise<DocumentContent> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;

      stream.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        
        // Check size limit
        if (totalSize > this.options.maxSize!) {
          stream.destroy();
          reject(new Error(`File exceeds maximum size of ${this.options.maxSize} bytes`));
          return;
        }
        
        chunks.push(chunk);
      });

      stream.on('end', () => {
        const text = Buffer.concat(chunks as Uint8Array[]).toString('utf-8');
        
        // Truncate if text is too long
        const truncatedText = text.length > this.options.maxTextLength! 
          ? text.substring(0, this.options.maxTextLength!) + '...[truncated]'
          : text;
        
        const wordCount = truncatedText.split(/\s+/).filter(word => word.length > 0).length;
        
        resolve({
          text: truncatedText,
          metadata: { 
            originalLength: text.length,
            truncated: text.length > this.options.maxTextLength!,
          },
          wordCount,
        });
      });

      stream.on('error', reject);
    });
  }

  /**
   * Store extracted content in the database
   */
  async storeExtractedContent(
    fileId: string,
    content: DocumentContent,
    userId?: string
  ): Promise<void> {
    const knex = getDatabase();
    
    try {
      // Store extracted content in database (let DB generate UUID)
      const [insertedRecord] = await knex('document_extracts').insert({
        file_id: fileId,
        content_text: content.text,
        word_count: content.wordCount || 0,
        page_count: content.pageCount || 0,
        metadata: content.metadata || {},
        extracted_at: new Date(),
        created_by: userId,
      }).onConflict('file_id').merge({
        content_text: content.text,
        word_count: content.wordCount || 0,
        page_count: content.pageCount || 0,
        metadata: content.metadata || {},
        extracted_at: new Date(),
        updated_by: userId,
      }).returning('id');

      // Queue for embedding generation using Redis queue
      if (content.text && content.text.length > 0) {
        try {
          const { getSchema } = await import('../../../helpers/utils/get-schema.js');
          const { QueueManager } = await import('../../queues/queue-manager.js');
          
          const schema = await getSchema();
          const queueManager = new QueueManager(schema, null);
          const embeddingQueue = queueManager.getEmbeddingQueue();
          
          // Use the correct document_extracts record ID, not the file_id
          const recordId = insertedRecord?.id;
          
          await embeddingQueue.addEmbeddingJobs([{
            source_table: 'document_extracts',
            source_id: recordId,
            operation: 'insert',
            priority: 5,
          }]);
          
          logger.info(`Queued embedding generation for document extract ${recordId} (file ${fileId})`);
        } catch (embeddingError) {
          // Don't fail document storage if embedding queue fails
          logger.error(embeddingError, `Failed to queue embedding for file ${fileId}:`);
        }
      }

      logger.info(`Stored extracted content for file ${fileId} with ${content.text.length} characters`);
    } catch (error) {
      logger.error(error, `Error storing extracted content for file ${fileId}:`);
      throw error;
    }
  }
}

// Export singleton instance
export const documentParser = new DocumentParser();