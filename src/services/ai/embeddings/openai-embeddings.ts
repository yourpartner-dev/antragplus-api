import { useLogger } from '../../../helpers/logger/index.js';
import { useEnv } from '../../../helpers/env/index.js';
import axios from 'axios';

const logger = useLogger();

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  generateBatchEmbeddings(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor() {
    const env = useEnv();
    
    this.apiKey = env['OPENAI_API_KEY'] as string || '';
    this.model = env['OPENAI_EMBEDDING_MODEL'] as string || 'text-embedding-3-small';
    this.baseUrl = env['OPENAI_API_BASE_URL'] as string || 'https://api.openai.com/v1';

    if (!this.apiKey) {
      throw new Error('OpenAI API key is required for embedding generation');
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // Validate input type
    if (!text || typeof text !== 'string') {
      const error = new Error(`Invalid embedding input: expected string, got ${typeof text}`);
      logger.error({ textType: typeof text, textValue: text }, error.message);
      throw error;
    }

    // Clean and validate text
    const cleanedText = this.cleanText(text);
    if (!cleanedText || cleanedText.length === 0) {
      const error = new Error('Invalid embedding input: text is empty after cleaning');
      logger.warn({ originalLength: text.length, originalPreview: text.substring(0, 100) }, error.message);
      throw error;
    }

    // Truncate to safe token limit (~8191 tokens = ~30000 chars for safety)
    const truncatedText = cleanedText.substring(0, 30000);
    if (truncatedText.length < cleanedText.length) {
      logger.warn(`Text truncated from ${cleanedText.length} to ${truncatedText.length} chars for embedding`);
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/embeddings`,
        {
          input: truncatedText,
          model: this.model,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 second timeout
        }
      );

      if (!response.data?.data?.[0]?.embedding) {
        throw new Error('Invalid response from OpenAI embeddings API');
      }

      return response.data.data[0].embedding;
    } catch (error: any) {
      // Detailed error logging for debugging
      if (error.response) {
        logger.error({
          status: error.response.status,
          statusText: error.response.statusText,
          errorData: error.response.data,
          textLength: truncatedText.length,
          textPreview: truncatedText.substring(0, 200),
          model: this.model,
          baseUrl: this.baseUrl
        }, 'OpenAI API error generating embedding');

        throw new Error(`OpenAI API ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      }

      logger.error(error, 'Unexpected error generating embedding');
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clean text for embedding generation
   * Removes null bytes, control characters, excessive whitespace
   */
  private cleanText(text: string): string {
    return text
      .replace(/\0/g, '') // Remove NULL bytes
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except \n, \r, \t
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim();
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    // Validate input is array
    if (!Array.isArray(texts)) {
      const error = new Error(`Invalid batch input: expected array, got ${typeof texts}`);
      logger.error({ textsType: typeof texts }, error.message);
      throw error;
    }

    if (texts.length === 0) {
      const error = new Error('Invalid batch input: empty array');
      logger.warn('Attempted to generate embeddings for empty array');
      throw error;
    }

    // Clean and validate all texts, track indices
    const validTexts: Array<{ index: number; text: string }> = [];
    const skippedIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];

      if (!text || typeof text !== 'string') {
        skippedIndices.push(i);
        logger.warn({ index: i, type: typeof text }, 'Skipping invalid text in batch');
        continue;
      }

      const cleanedText = this.cleanText(text);
      if (!cleanedText || cleanedText.length === 0) {
        skippedIndices.push(i);
        logger.warn({ index: i, originalLength: text.length }, 'Skipping empty text after cleaning');
        continue;
      }

      // Truncate to safe limit
      const truncatedText = cleanedText.substring(0, 30000);
      validTexts.push({ index: i, text: truncatedText });
    }

    // If no valid texts, throw error
    if (validTexts.length === 0) {
      const error = new Error(`No valid texts in batch of ${texts.length} (all empty or invalid)`);
      logger.error({ totalTexts: texts.length, skippedIndices }, error.message);
      throw error;
    }

    // Log if some texts were skipped
    if (skippedIndices.length > 0) {
      logger.warn({
        totalTexts: texts.length,
        validTexts: validTexts.length,
        skippedCount: skippedIndices.length,
        skippedIndices: skippedIndices.slice(0, 10) // Log first 10
      }, 'Some texts skipped in batch embedding');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/embeddings`,
        {
          input: validTexts.map(t => t.text),
          model: this.model,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000, // 60 second timeout for batches
        }
      );

      if (!response.data?.data || !Array.isArray(response.data.data)) {
        throw new Error('Invalid response from OpenAI embeddings API');
      }

      // Map embeddings back to original indices
      // OpenAI returns in request order, so we need to handle skipped indices
      const embeddings: number[][] = new Array(texts.length);
      const sortedData = response.data.data.sort((a: any, b: any) => a.index - b.index);

      for (let i = 0; i < sortedData.length; i++) {
        const originalIndex = validTexts[i]?.index;
        if (originalIndex !== undefined) {
          embeddings[originalIndex] = sortedData[i].embedding;
        }
      }

      // Fill skipped indices with empty arrays (caller should handle)
      for (const skippedIndex of skippedIndices) {
        embeddings[skippedIndex] = [];
      }

      return embeddings;
    } catch (error: any) {
      // Detailed error logging
      if (error.response) {
        logger.error({
          status: error.response.status,
          statusText: error.response.statusText,
          errorData: error.response.data,
          batchSize: validTexts.length,
          totalRequested: texts.length,
          skippedCount: skippedIndices.length,
          textLengths: validTexts.slice(0, 5).map(t => t.text.length), // First 5 lengths
          model: this.model,
          baseUrl: this.baseUrl
        }, 'OpenAI API error generating batch embeddings');

        throw new Error(`OpenAI API ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      }

      logger.error(error, 'Unexpected error generating batch embeddings');
      throw new Error(`Failed to generate batch embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Alternative embedding provider using sentence-transformers via Hugging Face
export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private apiUrl: string;

  constructor() {
    const env = useEnv();
    
    this.apiKey = env['HUGGINGFACE_API_KEY'] as string || '';
    this.model = env['HUGGINGFACE_EMBEDDING_MODEL'] as string || 'sentence-transformers/all-MiniLM-L6-v2';
    this.apiUrl = `https://api-inference.huggingface.co/models/${this.model}`;

    if (!this.apiKey) {
      throw new Error('Hugging Face API key is required for embedding generation');
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await axios.post(
        this.apiUrl,
        {
          inputs: text,
          options: { wait_for_model: true },
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!Array.isArray(response.data)) {
        throw new Error('Invalid response from Hugging Face API');
      }

      return response.data;
    } catch (error) {
      logger.error(error, 'Error generating embedding:');
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    // HuggingFace doesn't support batch in the same way, so we process sequentially
    // In production, you might want to implement parallel processing with rate limiting
    const embeddings: number[][] = [];
    
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text);
      embeddings.push(embedding);
    }

    return embeddings;
  }
}

// Factory function to get the appropriate embedding provider
export function getEmbeddingProvider(): EmbeddingProvider {
  const env = useEnv();
  const provider = env['EMBEDDING_PROVIDER'] as string || 'openai';

  switch (provider.toLowerCase()) {
    case 'openai':
      return new OpenAIEmbeddingProvider();
    case 'huggingface':
      return new HuggingFaceEmbeddingProvider();
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}

// Export singleton instance
export const embeddingProvider = getEmbeddingProvider();
