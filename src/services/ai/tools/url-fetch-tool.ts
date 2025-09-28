import { load } from 'cheerio';
import { generateText } from 'ai';
import { getGrantExtractionModel } from '../providers.js';
import { useLogger } from '../../../helpers/logger/index.js';

const logger = useLogger();

export interface URLContent {
  url: string;
  title: string;
  content: string;
  summary: string;
  contentType: 'grant' | 'article' | 'document' | 'repository' | 'funding' | 'general';
  keyInsights: string[];
  relevanceToUser: string;
  success: boolean;
}

/**
 * Analyze fetched content with AI to provide structured insights
 */
async function analyzeContentWithAI(url: string, title: string, rawContent: string, userContext?: string): Promise<{
  summary: string;
  contentType: URLContent['contentType'];
  keyInsights: string[];
  relevanceToUser: string;
}> {
  try {
    const analysisPrompt = `Analyze this webpage content and provide structured insights for a grant application assistant:

URL: ${url}
Title: ${title}
Content: ${rawContent.substring(0, 3000)}

User Context: ${userContext || 'General analysis for grant-seeking NGO'}

Please analyze and respond with EXACTLY this JSON format:
{
  "summary": "2-3 sentence summary of what this content is about",
  "contentType": "grant|article|document|repository|funding|general",
  "keyInsights": ["3-5 key points that would be relevant for NGOs or grant applications"],
  "relevanceToUser": "How this content could be useful for grant applications, NGO work, or funding"
}

Focus on identifying:
- Grant opportunities and funding information
- Requirements, deadlines, and eligibility criteria
- Best practices and guidance for NGOs
- Relevant policies, regulations, or compliance information

Respond only with the JSON object, no additional text.`;

    const result = await generateText({
      model: getGrantExtractionModel(),
      prompt: analysisPrompt,
      temperature: 0.3,
      maxRetries: 2
    });

    // Clean and parse the JSON response
    let cleanedText = result.text.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const analysis = JSON.parse(cleanedText);

    return {
      summary: analysis.summary || 'Content analysis not available',
      contentType: analysis.contentType || 'general',
      keyInsights: Array.isArray(analysis.keyInsights) ? analysis.keyInsights : [],
      relevanceToUser: analysis.relevanceToUser || 'Relevance could not be determined'
    };

  } catch (error) {
    logger.error('AI content analysis failed:', error);

    // Fallback analysis based on simple content detection
    const contentLower = rawContent.toLowerCase();
    let contentType: URLContent['contentType'] = 'general';

    if (contentLower.includes('grant') || contentLower.includes('funding')) {
      contentType = contentLower.includes('deadline') ? 'grant' : 'funding';
    } else if (url.includes('github.com')) {
      contentType = 'repository';
    } else if (contentLower.includes('article') || contentLower.includes('blog')) {
      contentType = 'article';
    }

    return {
      summary: `Content from ${new URL(url).hostname}: ${title}`,
      contentType,
      keyInsights: ['Content analysis unavailable - AI processing failed'],
      relevanceToUser: 'Manual review recommended'
    };
  }
}

/**
 * Intelligent URL content fetcher with AI analysis
 * Fetches, extracts, and analyzes content for grant application context
 */
export async function fetchURLContent(url: string, userContext?: string): Promise<URLContent> {
  try {
    const validUrl = new URL(url);
    logger.info(`🔗 Fetching: ${validUrl.href}`);

    const response = await fetch(validUrl.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AntragPlus/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);

    // Remove noise
    $('script, style, nav, footer, .ads').remove();

    // Extract title
    const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';

    // Extract content - try main content areas first
    let content = '';
    const selectors = ['main', 'article', '.content', '.main-content', '#content'];

    for (const selector of selectors) {
      const text = $(selector).text().trim();
      if (text.length > 200) {
        content = text;
        break;
      }
    }

    // Fallback to paragraphs
    if (!content) {
      content = $('p').map((_, el) => $(el).text()).get().join(' ');
    }

    // Final fallback
    if (!content) {
      content = $('body').text();
    }

    // Clean and limit
    content = content.replace(/\s+/g, ' ').trim().substring(0, 4000);

    // AI analysis of the content
    logger.info(`🤖 Analyzing content with AI for: ${validUrl.href}`);
    const analysis = await analyzeContentWithAI(validUrl.href, title, content, userContext);

    return {
      url: validUrl.href,
      title: title.substring(0, 100),
      content,
      summary: analysis.summary,
      contentType: analysis.contentType,
      keyInsights: analysis.keyInsights,
      relevanceToUser: analysis.relevanceToUser,
      success: true
    };

  } catch (error) {
    logger.error('URL fetch failed:', error);
    return {
      url,
      title: 'Error',
      content: '',
      summary: 'Failed to fetch and analyze URL content',
      contentType: 'general',
      keyInsights: [],
      relevanceToUser: 'Content not available due to fetch error',
      success: false
    };
  }
}

/**
 * Auto-detect URLs in text and fetch them with user context
 * Used by chat service for seamless URL processing
 */
export async function autoFetchURLsFromText(text: string, userContext?: string): Promise<URLContent[]> {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const urls = text.match(urlRegex);

  if (!urls) return [];

  logger.info(`🔍 Auto-detected ${urls.length} URL(s)`);

  // Limit to 2 URLs to prevent abuse
  const urlsToFetch = urls.slice(0, 2);

  const results = await Promise.allSettled(
    urlsToFetch.map(url => fetchURLContent(url.trim(), userContext))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<URLContent> =>
      r.status === 'fulfilled' && r.value.success
    )
    .map(r => r.value);
}