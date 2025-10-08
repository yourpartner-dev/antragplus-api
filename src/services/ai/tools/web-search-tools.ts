import { z } from 'zod';
import { tool } from 'ai';
import { TavilyClient } from 'tavily';
import { useLogger } from '../../../helpers/logger/index.js';
import { useEnv } from '../../../helpers/env/index.js';

const logger = useLogger();
const env = useEnv();

// Initialize Tavily client with timeout configuration
const TAVILY_API_KEY = env['TAVILY_API_KEY'] as string;
const tavilyClient = new TavilyClient({
  apiKey: TAVILY_API_KEY || '',
  // Note: TavilyClient doesn't support timeout in constructor,
  // so we'll handle timeouts in the search calls
});

// Utility function to add timeout to Tavily requests
export async function tavilySearchWithTimeout(searchParams: any, timeoutMs = 30000) {
  return Promise.race([
    tavilyClient.search(searchParams),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Tavily search timed out')), timeoutMs)
    )
  ]);
}

// Export the Tavily client for use in other tools
export { tavilyClient };

export function getWebSearchTools() {
  return {
    searchWeb: tool({
      description: 'Search the web for ADDITIONAL information when internal database information is insufficient. IMPORTANT: Only use this tool if: 1) You have already checked internal grant documents/NGO data and found it incomplete, 2) You inform the user you are searching the web for additional context. This should be a LAST RESORT after checking internal sources.',
      inputSchema: z.object({
        query: z.string().describe('The search query - be specific and detailed for best results'),
        search_depth: z.enum(['basic', 'advanced']).default('basic').describe('Use basic for most queries, advanced only for comprehensive research'),
        max_results: z.number().min(1).max(10).default(5).describe('Number of results to retrieve (lower is faster)')
      }),
      execute: async ({ query, search_depth, max_results }) => {
        if (!TAVILY_API_KEY) {
          logger.warn('Tavily API key not configured');
          return {
            success: false,
            message: 'Web search is currently not available. Please configure TAVILY_API_KEY.',
            results: [],
            user_message: 'Web search is not available at the moment. I will use only internal database information.'
          };
        }

        try {
          logger.info(`Executing web search: "${query}"`);

          const searchResult = await tavilySearchWithTimeout({
            query,
            search_depth,
            max_results,
            include_answer: true,
            include_raw_content: false,
          }, 15000) as any; // Reduced to 15 second timeout

          // Process results
          const results = searchResult.results?.map((result: any) => ({
            title: result.title,
            url: result.url,
            content: result.content,
            score: result.score,
            published_date: result.published_date
          })) || [];

          logger.info(`Web search completed: ${results.length} results found`);

          return {
            success: true,
            query,
            answer: searchResult.answer || '',
            results,
            total_results: results.length
          };

        } catch (error: any) {
          logger.error(error, 'Web search failed');

          if (error.response?.status === 432) {
            return {
              success: false,
              message: 'Web search authentication failed. Please check API configuration.',
              results: []
            };
          }

          if (error.message === 'Tavily search timed out') {
            return {
              success: false,
              message: 'Web search timed out. The search service is taking too long to respond.',
              results: [],
              error: 'Timeout error',
              user_message: 'The web search took too long and timed out. I will continue using the information available in our database.'
            };
          }

          return {
            success: false,
            message: 'Web search temporarily unavailable. Please try again later.',
            results: [],
            error: error.message,
            user_message: 'Web search is temporarily unavailable. I will continue using the information available in our database.'
          };
        }
      },
    }),
  };
}