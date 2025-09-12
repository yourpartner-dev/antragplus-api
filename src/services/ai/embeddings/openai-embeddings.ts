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
    try {
      const response = await axios.post(
        `${this.baseUrl}/embeddings`,
        {
          input: text,
          model: this.model,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.data?.data?.[0]?.embedding) {
        throw new Error('Invalid response from OpenAI embeddings API');
      }

      return response.data.data[0].embedding;
    } catch (error) {
      logger.error(error, 'Error generating embedding:');
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      // OpenAI supports batch embeddings
      const response = await axios.post(
        `${this.baseUrl}/embeddings`,
        {
          input: texts,
          model: this.model,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.data?.data || !Array.isArray(response.data.data)) {
        throw new Error('Invalid response from OpenAI embeddings API');
      }

      // Sort by index to ensure correct order
      const sortedData = response.data.data.sort((a: any, b: any) => a.index - b.index);
      return sortedData.map((item: any) => item.embedding);
    } catch (error) {
      logger.error(error, 'Error generating batch embeddings:');
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
