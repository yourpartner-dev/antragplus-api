import { generateText } from 'ai';
import { getGrantExtractionModel } from '../providers.js';
import { useLogger } from '../../../helpers/logger/index.js';
import { CheerioCrawler } from 'crawlee';
import type { CheerioAPI } from 'cheerio';
import Sitemapper from 'sitemapper';

const logger = useLogger();

interface PageContent {
  url: string;
  pageType: string;
  content: string;
  structuredData?: any;
  success: boolean;
  title?: string;
  metadata?: any;
}

export interface NGOInfo {
  company_name?: string;
  about?: string;
  location?: string;
  contact_email?: string;
  contact_phone?: string;
  legal_entity?: string;
  field_of_work?: string;
  company_size?: string;
  registration_number?: string;
  tax_id?: string;
  website_url?: string;
  contact_name?: string;
  domain_name?: string;
  billing_address?: string;
  confidence?: {
    overall: number;
    source_quality: string;
  };
}

export interface NGOExtractionResult {
  success: boolean;
  extractedInfo?: NGOInfo;
  confidence?: number;
  method: string;
  message: string;
  error?: string;
  pagesCrawled?: number;
}

/**
 * Production-Ready NGO Website Fetcher using Crawlee + Cheerio
 *
 * Based on research of best practices for website crawling and NGO data extraction
 * Uses professional crawling framework with proper DOM parsing and structured data extraction
 */
export class NGOWebsiteFetcher {
  private maxPages = 15;
  private maxConcurrency = 3;
  private requestTimeoutSecs = 30;
  private crawlDelay = 500; // Base delay between requests
  private pageContents: PageContent[] = [];

  /**
   * Main extraction method - fetches website and extracts NGO information
   */
  async extractNGOInformation(baseUrl: string): Promise<NGOExtractionResult> {
    try {
      logger.info(`Starting production NGO extraction for: ${baseUrl}`);

      // Reset state for each extraction
      this.pageContents = [];

      // STEP 1: Smart page discovery using multiple strategies
      const relevantPages = await this.discoverPages(baseUrl);
      logger.info(`Discovered ${relevantPages.length} relevant pages`);

      if (relevantPages.length === 0) {
        return {
          success: false,
          method: 'crawlee_production',
          message: 'Could not discover any relevant pages to crawl',
          error: 'No accessible pages found',
          pagesCrawled: 0
        };
      }

      // STEP 2: Professional crawling with Crawlee + Cheerio
      await this.crawlPagesWithCrawlee(relevantPages);
      const successfulPages = this.pageContents.filter(p => p.success);

      logger.info(`Successfully crawled ${successfulPages.length}/${relevantPages.length} pages`);

      if (successfulPages.length === 0) {
        return {
          success: false,
          method: 'crawlee_production',
          message: 'Could not extract content from any pages',
          error: 'All page crawling failed',
          pagesCrawled: 0
        };
      }

      // STEP 3: Process all content with advanced techniques
      const extractedInfo = await this.processAllContent(successfulPages, baseUrl);

      // STEP 4: Calculate confidence score
      const confidence = this.calculateConfidenceScore(extractedInfo, successfulPages);

      return {
        success: true,
        extractedInfo: {
          ...extractedInfo,
          confidence: {
            overall: confidence,
            source_quality: this.assessSourceQuality(successfulPages)
          }
        },
        confidence,
        method: 'crawlee_production',
        message: `Professional extraction completed with ${Math.round(confidence * 100)}% confidence from ${successfulPages.length} pages`,
        pagesCrawled: successfulPages.length
      };

    } catch (error) {
      logger.error(error, `Production NGO extraction failed for ${baseUrl}`);
      return {
        success: false,
        method: 'crawlee_production',
        message: 'Failed to extract NGO information',
        error: error instanceof Error ? error.message : 'Unknown error',
        pagesCrawled: this.pageContents.filter(p => p.success).length
      };
    }
  }

  /**
   * LAYER 1-3: Smart page discovery using multiple strategies
   */
  async discoverPages(baseUrl: string): Promise<string[]> {
    const pages = new Set<string>();

    // Always include homepage
    pages.add(baseUrl);

    // LAYER 1: Try sitemap first (fastest, most accurate)
    try {
      const sitemapPages = await this.tryFetchSitemap(baseUrl);
      if (sitemapPages.length > 0) {
        logger.info(`Found ${sitemapPages.length} pages from sitemap`);
        sitemapPages.forEach(url => pages.add(url));
        return this.filterRelevantPages(Array.from(pages));
      }
    } catch (error) {
      logger.info('Sitemap discovery failed, trying common pages');
    }

    // LAYER 2: Common page patterns (German + English)
    const commonPages = await this.tryCommonPages(baseUrl);
    commonPages.forEach(url => pages.add(url));
    logger.info(`Found ${commonPages.length} pages from common patterns`);

    if (pages.size > 5) {
      return this.filterRelevantPages(Array.from(pages));
    }

    // LAYER 3: Intelligent crawling (last resort) - would be implemented with Crawlee's auto-discovery
    logger.info('Using basic page set for crawling');
    return this.filterRelevantPages(Array.from(pages));
  }

  /**
   * Professional sitemap fetching with Sitemapper
   */
  private async tryFetchSitemap(baseUrl: string): Promise<string[]> {
    const sitemap = new Sitemapper({
      url: `${baseUrl}/sitemap.xml`,
      timeout: 10000,
      requestHeaders: {
        'User-Agent': 'Mozilla/5.0 (compatible; NGO-InfoBot/1.0)'
      }
    });

    try {
      const { sites } = await sitemap.fetch();
      return sites || [];
    } catch (error) {
      // Try alternative sitemap locations
      const alternatives = [
        `${baseUrl}/sitemap_index.xml`,
        `${baseUrl}/sitemaps/sitemap.xml`,
        `${baseUrl}/sitemap/sitemap.xml`
      ];

      for (const altUrl of alternatives) {
        try {
          const altSitemap = new Sitemapper({ url: altUrl, timeout: 10000 });
          const { sites } = await altSitemap.fetch();
          if (sites && sites.length > 0) {
            return sites;
          }
        } catch {
          continue;
        }
      }

      // Try robots.txt for sitemap location
      try {
        const robotsResponse = await fetch(`${baseUrl}/robots.txt`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NGO-InfoBot/1.0)' }
        });
        if (robotsResponse.ok) {
          const robotsText = await robotsResponse.text();
          const sitemapMatch = robotsText.match(/Sitemap:\s*(.+)/i);
          if (sitemapMatch && sitemapMatch[1]) {
            const robotsSitemap = new Sitemapper({
              url: sitemapMatch[1].trim(),
              timeout: 10000
            });
            const { sites } = await robotsSitemap.fetch();
            return sites || [];
          }
        }
      } catch {
        // Ignore robots.txt errors
      }

      return [];
    }
  }

  /**
   * Try common NGO page patterns for German/English websites
   */
  private async tryCommonPages(baseUrl: string): Promise<string[]> {
    const commonPaths = [
      // German patterns (priority for German NGOs)
      '/impressum', '/kontakt', '/über-uns', '/ueber-uns',
      '/datenschutz', '/team', '/projekte', '/arbeitsfelder',
      '/leistungen', '/angebote', '/spenden',

      // English patterns
      '/about', '/about-us', '/contact', '/contact-us',
      '/team', '/staff', '/services', '/projects', '/work',
      '/legal', '/imprint', '/privacy', '/donate',

      // Common variations
      '/about.html', '/contact.html', '/team.html',
      '/about.php', '/contact.php', '/impressum.php'
    ];

    const existingPages: string[] = [];
    const batchSize = 5;

    // Process in batches to avoid overwhelming the server
    for (let i = 0; i < commonPaths.length; i += batchSize) {
      const batch = commonPaths.slice(i, i + batchSize);

      const promises = batch.map(async (path) => {
        try {
          const url = `${baseUrl}${path}`;
          const response = await fetch(url, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NGO-InfoBot/1.0)' }
          });
          if (response.ok) {
            return url;
          }
        } catch {
          // Ignore failed requests
        }
        return null;
      });

      const results = await Promise.allSettled(promises);
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          existingPages.push(result.value);
        }
      });

      // Add delay between batches
      if (i + batchSize < commonPaths.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return existingPages;
  }

  /**
   * Filter and prioritize relevant pages for NGO information
   */
  private filterRelevantPages(pages: string[]): string[] {
    const relevantPages = pages
      .filter(url => this.isRelevantPage(url))
      .sort((a, b) => this.getPageRelevanceScore(b) - this.getPageRelevanceScore(a))
      .slice(0, this.maxPages);

    return relevantPages;
  }

  /**
   * Get priority score for page ordering (higher = more important)
   */
  private getPageRelevanceScore(url: string): number {
    const path = new URL(url).pathname.toLowerCase();

    // German legal pages have highest priority (Impressum is legally required)
    if (path.includes('impressum') || path.includes('imprint')) return 100;
    if (path.includes('kontakt') || path.includes('contact')) return 90;

    // About pages (high value for mission/purpose)
    if (path.includes('über') || path.includes('ueber') || path.includes('about')) return 80;

    // Homepage (always important)
    if (path === '/' || path === '' || path === '/index') return 70;

    // Team and organizational structure
    if (path.includes('team') || path.includes('staff') || path.includes('menschen')) return 60;

    // Services and work areas
    if (path.includes('service') || path.includes('leistung') || path.includes('angebot')) return 50;
    if (path.includes('projekt') || path.includes('project') || path.includes('arbeitsfeld')) return 45;

    // Legal/privacy (useful but lower priority than Impressum)
    if (path.includes('datenschutz') || path.includes('privacy')) return 30;

    // Donation/funding info
    if (path.includes('spenden') || path.includes('donate') || path.includes('funding')) return 25;

    return 10; // Default priority
  }

  /**
   * Check if page is relevant for NGO information extraction
   */
  private isRelevantPage(url: string): boolean {
    const path = new URL(url).pathname.toLowerCase();

    // Skip obviously irrelevant pages
    const irrelevantPatterns = [
      '/wp-admin', '/admin', '/login', '/register', '/user',
      '/shop', '/store', '/cart', '/checkout', '/payment',
      '/404', '/error', '/search', '/sitemap',
      '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.zip', '.doc',
      '/feed', '/rss', '/xml', '/json',
      '/blog/', '/news/', '/presse/', '/artikel/', // Blog posts usually not core info
      '/wp-content/', '/wp-includes/', '/assets/', '/static/',
      '/cookie', '/banner', '/popup'
    ];

    return !irrelevantPatterns.some(pattern => path.includes(pattern));
  }

  /**
   * Professional crawling with Crawlee + Cheerio
   */
  private async crawlPagesWithCrawlee(urls: string[]): Promise<void> {
    const crawler = new CheerioCrawler({
      requestHandler: async ({ request, $ }) => {
        await this.extractPageContent(request.loadedUrl!, $ as any);
      },
      maxRequestsPerCrawl: this.maxPages,
      maxConcurrency: this.maxConcurrency,
      requestHandlerTimeoutSecs: this.requestTimeoutSecs,
      preNavigationHooks: [
        async () => {
          // Add respectful delays and user-agent rotation
          const delay = this.crawlDelay + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      ],
      failedRequestHandler: async ({ request }) => {
        logger.warn(`Failed to crawl: ${request.url}`);
        this.pageContents.push({
          url: request.url,
          pageType: 'unknown',
          content: '',
          success: false
        });
      }
    });

    // Add all URLs to the crawler's request queue
    await crawler.run(urls.map(url => ({ url })));
  }

  /**
   * Extract content from a single page with professional DOM parsing
   */
  private async extractPageContent(url: string, $: CheerioAPI): Promise<void> {
    try {
      // STEP 1: Clean HTML and extract text content
      const cleanText = this.cleanHtmlContent($);

      // STEP 2: Detect page type
      const pageType = this.detectPageType(url, cleanText);

      // STEP 3: Extract structured data (JSON-LD, microdata)
      const structuredData = this.extractStructuredData($);

      // STEP 4: Extract page metadata
      const metadata = this.extractPageMetadata($);

      // STEP 5: Page-specific extractions
      const pageSpecificData = this.extractPageSpecificData($, pageType);

      this.pageContents.push({
        url,
        pageType,
        content: cleanText,
        structuredData: { ...structuredData, ...pageSpecificData },
        success: true,
        title: $('title').text().trim(),
        metadata
      });

      logger.info(`Extracted ${pageType} page: ${url} (${cleanText.length} chars)`);

    } catch (error) {
      logger.error(error, `Failed to extract content from ${url}`);
      this.pageContents.push({
        url,
        pageType: 'unknown',
        content: '',
        success: false
      });
    }
  }

  /**
   * Professional HTML content cleaning with Cheerio
   */
  private cleanHtmlContent($: CheerioAPI): string {
    // Remove non-content elements
    $('script, style, nav, footer, header, .cookie-banner, .popup, .modal').remove();
    $('noscript, .advertisement, .ads, .social-share').remove();

    // Remove WordPress admin and comment elements
    $('.wp-admin, .comment-form, .comments, #comments').remove();

    // Extract main content areas first (better content quality)
    const contentSelectors = [
      'main', '.main', '#main',
      '.content', '#content', '.page-content',
      '.entry-content', '.post-content',
      'article', '.article',
      '.impressum', '.contact', '.about'
    ];

    let mainContent = '';
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        mainContent = element.text();
        break;
      }
    }

    // Fallback to body content if no main content found
    if (!mainContent || mainContent.length < 100) {
      mainContent = $('body').text();
    }

    // Clean up text
    return mainContent
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim()
      .substring(0, 12000); // Increased limit for better context
  }

  /**
   * Extract structured data (JSON-LD, microdata, meta tags)
   */
  private extractStructuredData($: CheerioAPI): any {
    const data: any = {};

    // Extract JSON-LD structured data
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const jsonData = JSON.parse($(el).html() || '{}');
        if (jsonData['@type'] === 'Organization' || jsonData['@type'] === 'LocalBusiness') {
          Object.assign(data, this.mapJsonLdToNGOFields(jsonData));
        }
      } catch (error) {
        // Ignore malformed JSON-LD
      }
    });

    // Extract microdata
    $('[itemtype*="Organization"], [itemtype*="LocalBusiness"]').each((_, el) => {
      const orgData = this.extractMicrodata($(el));
      Object.assign(data, orgData);
    });

    // Extract Open Graph and meta tags
    const metaData = this.extractMetaTags($);
    Object.assign(data, metaData);

    return data;
  }

  /**
   * Map JSON-LD data to NGO fields
   */
  private mapJsonLdToNGOFields(jsonData: any): any {
    const mapped: any = {};

    if (jsonData.name) mapped.company_name = jsonData.name;
    if (jsonData.description) mapped.about = jsonData.description;
    if (jsonData.email) mapped.contact_email = jsonData.email;
    if (jsonData.telephone) mapped.contact_phone = jsonData.telephone;
    if (jsonData.url) mapped.website_url = jsonData.url;

    // Address handling
    if (jsonData.address) {
      if (typeof jsonData.address === 'string') {
        mapped.location = jsonData.address;
      } else if (jsonData.address.streetAddress || jsonData.address.addressLocality) {
        const addr = jsonData.address;
        mapped.location = [
          addr.streetAddress,
          addr.addressLocality,
          addr.postalCode,
          addr.addressCountry
        ].filter(Boolean).join(', ');
      }
    }

    return mapped;
  }

  /**
   * Extract microdata attributes
   */
  private extractMicrodata($element: any): any {
    const data: any = {};

    $element.find('[itemprop]').each((_: any, el: any) => {
      const prop = $element.find(el).attr('itemprop');
      const content = $element.find(el).attr('content') || $element.find(el).text().trim();

      if (prop && content) {
        switch (prop) {
          case 'name': data.company_name = content; break;
          case 'description': data.about = content; break;
          case 'email': data.contact_email = content; break;
          case 'telephone': data.contact_phone = content; break;
          case 'address': data.location = content; break;
          case 'url': data.website_url = content; break;
        }
      }
    });

    return data;
  }

  /**
   * Extract meta tags and Open Graph data
   */
  private extractMetaTags($: CheerioAPI): any {
    const data: any = {};

    // Open Graph tags
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDescription = $('meta[property="og:description"]').attr('content');
    const ogUrl = $('meta[property="og:url"]').attr('content');

    if (ogTitle) data.og_title = ogTitle;
    if (ogDescription) data.og_description = ogDescription;
    if (ogUrl) data.og_url = ogUrl;

    // Standard meta tags
    const description = $('meta[name="description"]').attr('content');
    if (description) data.meta_description = description;

    return data;
  }

  /**
   * Extract page metadata
   */
  private extractPageMetadata($: CheerioAPI): any {
    return {
      title: $('title').text().trim(),
      lang: $('html').attr('lang') || 'unknown',
      charset: $('meta[charset]').attr('charset') || 'unknown'
    };
  }

  /**
   * Extract page-specific data based on page type
   */
  private extractPageSpecificData($: CheerioAPI, pageType: string): any {
    const data: any = {};

    if (pageType === 'contact') {
      data.contactInfo = this.extractContactInfo($);
    } else if (pageType === 'legal') {
      data.legalInfo = this.extractLegalInfo($);
    } else if (pageType === 'team') {
      data.teamInfo = this.extractTeamInfo($);
    }

    return data;
  }

  /**
   * Extract contact information from contact pages
   */
  private extractContactInfo($: CheerioAPI): any {
    const info: any = {};

    // Look for email patterns
    const emailPattern = /[\w.-]+@[\w.-]+\.\w+/g;
    const pageText = $.text();
    const emails = pageText.match(emailPattern);
    if (emails && emails.length > 0) {
      info.emails = [...new Set(emails)]; // Remove duplicates
    }

    // Look for phone patterns (German and international)
    const phonePattern = /(?:\+49|0)[0-9\s\-\/\(\)]{8,}/g;
    const phones = pageText.match(phonePattern);
    if (phones && phones.length > 0) {
      info.phones = [...new Set(phones.map(p => p.trim()))];
    }

    // Look for address patterns
    $('address, .address, .contact-address').each((_, el) => {
      const address = $(el).text().trim();
      if (address.length > 10) {
        info.addresses = info.addresses || [];
        info.addresses.push(address);
      }
    });

    return info;
  }

  /**
   * Extract legal information from Impressum/legal pages
   */
  private extractLegalInfo($: CheerioAPI): any {
    const info: any = {};
    const pageText = $.text();

    // German legal entity patterns
    const entityPattern = /\b(e\.V\.|gGmbH|GmbH|gUG|UG|AG|Stiftung|Foundation)\b/g;
    const entities = pageText.match(entityPattern);
    if (entities && entities.length > 0) {
      info.legal_entities = [...new Set(entities)];
    }

    // Registration number patterns
    const regPattern = /(?:HRB|HRA|VR|GnR|PR)\s*\d+\s*[A-Z]?/g;
    const regNumbers = pageText.match(regPattern);
    if (regNumbers && regNumbers.length > 0) {
      info.registration_numbers = [...new Set(regNumbers)];
    }

    // Tax ID patterns
    const taxPattern = /(?:USt-ID|VAT|Steuer-Nr\.?|Tax ID):?\s*([A-Z0-9\s\-]+)/g;
    const taxIds = pageText.match(taxPattern);
    if (taxIds && taxIds.length > 0) {
      info.tax_ids = [...new Set(taxIds)];
    }

    return info;
  }

  /**
   * Extract team information
   */
  private extractTeamInfo($: CheerioAPI): any {
    const info: any = {};

    // Count team members mentioned
    const teamKeywords = ['mitarbeiter', 'team', 'staff', 'employee', 'person'];
    let teamCount = 0;

    teamKeywords.forEach(keyword => {
      const matches = $.text().toLowerCase().match(new RegExp(keyword, 'g'));
      if (matches) teamCount += matches.length;
    });

    if (teamCount > 0) {
      info.estimated_team_size = teamCount;
    }

    return info;
  }

  /**
   * Detect page type based on URL and content
   */
  private detectPageType(url: string, content: string): string {
    const path = new URL(url).pathname.toLowerCase();
    const contentLower = content.toLowerCase();

    if (path.includes('impressum') || path.includes('imprint') || contentLower.includes('impressum')) {
      return 'legal';
    }
    if (path.includes('kontakt') || path.includes('contact')) {
      return 'contact';
    }
    if (path.includes('über') || path.includes('ueber') || path.includes('about')) {
      return 'about';
    }
    if (path === '/' || path === '' || path.includes('index')) {
      return 'homepage';
    }
    if (path.includes('team') || path.includes('staff')) {
      return 'team';
    }
    if (path.includes('service') || path.includes('leistung') || path.includes('projekt')) {
      return 'services';
    }
    if (path.includes('datenschutz') || path.includes('privacy')) {
      return 'privacy';
    }

    return 'general';
  }

  /**
   * STEP 3: Intelligent content processing with validation and conflict resolution
   */
  private async processAllContent(pageContents: PageContent[], baseUrl: string): Promise<NGOInfo> {
    // STEP 1: Combine structured data from all pages
    const structuredData = this.combineStructuredData(pageContents);

    // STEP 2: LLM processing with context-aware prompts
    const llmExtracted = await this.extractWithLLM(pageContents);

    // STEP 3: Validation and conflict resolution
    const validated = await this.validateAndResolve(structuredData, llmExtracted, baseUrl);

    return validated;
  }

  /**
   * Combine structured data with conflict resolution
   */
  private combineStructuredData(pageContents: PageContent[]): any {
    const combined: any = {};
    const sources: { [key: string]: string } = {};

    // Process pages in priority order (legal > contact > about > homepage)
    const priorityOrder = ['legal', 'contact', 'about', 'homepage', 'team', 'services', 'general'];

    pageContents
      .filter(p => p.success && p.structuredData)
      .sort((a, b) => {
        const aPriority = priorityOrder.indexOf(a.pageType);
        const bPriority = priorityOrder.indexOf(b.pageType);
        return (aPriority === -1 ? 999 : aPriority) - (bPriority === -1 ? 999 : bPriority);
      })
      .forEach(page => {
        Object.entries(page.structuredData).forEach(([key, value]) => {
          if (value && !combined[key]) {
            combined[key] = value;
            sources[key] = page.pageType;
          }
        });
      });

    combined._sources = sources;
    return combined;
  }

  /**
   * LLM extraction with NGO-specific context-aware prompts
   */
  private async extractWithLLM(pageContents: PageContent[]): Promise<any> {
    const contextPrompt = this.buildContextualPrompt(pageContents);

    try {
      const result = await generateText({
        model: getGrantExtractionModel(), // Use powerful model for complex extraction
        prompt: contextPrompt,
        temperature: 0, // Deterministic for factual extraction
        maxRetries: 2
      });

      // Clean the response in case it's wrapped in markdown code blocks
      let cleanedText = result.text.trim();
      if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      return JSON.parse(cleanedText);
    } catch (error) {
      logger.error(error, 'LLM extraction failed');

      // Fallback to mini model
      try {
        const fallbackResult = await generateText({
          model: getGrantExtractionModel(),
          prompt: contextPrompt,
          temperature: 0
        });
        // Clean the fallback response too
        let cleanedFallbackText = fallbackResult.text.trim();
        if (cleanedFallbackText.startsWith('```json')) {
          cleanedFallbackText = cleanedFallbackText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanedFallbackText.startsWith('```')) {
          cleanedFallbackText = cleanedFallbackText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        return JSON.parse(cleanedFallbackText);
      } catch (fallbackError) {
        logger.error('Fallback LLM extraction also failed:', fallbackError);
        return {};
      }
    }
  }

  /**
   * Build context-aware prompt for NGO extraction
   */
  private buildContextualPrompt(pageContents: PageContent[]): string {
    const organizedContent = pageContents
      .filter(p => p.success && p.content.length > 50)
      .map(page => `[${page.pageType.toUpperCase()}] ${page.url}\nTitle: ${page.title || 'No title'}\n${page.content.substring(0, 3000)}`)
      .join('\n\n---PAGE-BREAK---\n\n');

    return `Extract NGO/organization information from this German website content using professional analysis techniques.

CRITICAL EXTRACTION RULES:
1. Only extract information explicitly stated in the content
2. For German organizations, prioritize LEGAL/IMPRESSUM content for maximum accuracy
3. If information conflicts between pages, prefer: LEGAL > CONTACT > ABOUT > HOMEPAGE
4. Return null for any field where information is not clearly stated
5. Validate email addresses and phone numbers before including
6. For German legal entities, look for: e.V., gGmbH, gUG, GmbH, AG, Stiftung
7. Registration numbers in Germany start with: HRB, HRA, VR, GnR, PR
8. Focus on extracting the organization's core mission and activities

Website content organized by page type:
${organizedContent}

Extract and return ONLY a JSON object with these exact fields:
{
  "company_name": "Official organization name from most authoritative source",
  "about": "Detailed mission, purpose, and activities - be comprehensive",
  "location": "Full address including street, city, postal code",
  "contact_email": "Primary contact email address (validated format)",
  "contact_phone": "Primary phone number (validated format)",
  "legal_entity": "Legal form (e.V., gGmbH, etc.) - exact format as stated",
  "field_of_work": "Primary sector, field of activity, or industry",
  "company_size": "Team size, number of employees, or organizational scale",
  "registration_number": "Official registration number (HRB/VR/etc.)",
  "tax_id": "Tax ID, USt-ID, or VAT number",
  "contact_name": "Primary contact person name"
}

Return only the JSON object, no additional text or formatting.`;
  }

  /**
   * Validate and resolve conflicts between structured data and LLM extraction
   */
  private async validateAndResolve(structuredData: any, llmExtracted: any, baseUrl: string): Promise<NGOInfo> {
    const resolved: NGOInfo = {};

    // Define field priority: structured data (reliable) vs LLM extraction (comprehensive)
    const fields = [
      'company_name', 'about', 'location', 'contact_email', 'contact_phone',
      'legal_entity', 'field_of_work', 'company_size', 'registration_number',
      'tax_id', 'contact_name'
    ];

    fields.forEach(field => {
      const structuredValue = structuredData[field];
      const llmValue = llmExtracted[field];

      // Validation and preference logic
      if (field === 'contact_email') {
        // Email validation
        const validStructured = structuredValue && this.isValidEmail(structuredValue);
        const validLLM = llmValue && this.isValidEmail(llmValue);

        if (validStructured) resolved[field] = structuredValue;
        else if (validLLM) resolved[field] = llmValue;

      } else if (field === 'contact_phone') {
        // Phone validation
        const validStructured = structuredValue && this.isValidPhone(structuredValue);
        const validLLM = llmValue && this.isValidPhone(llmValue);

        if (validStructured) resolved[field] = structuredValue;
        else if (validLLM) resolved[field] = llmValue;

      } else if (field === 'about') {
        // For description, prefer longer, more detailed content
        if (llmValue && llmValue.length > 100) resolved[field] = llmValue;
        else if (structuredValue && structuredValue.length > 50) resolved[field] = structuredValue;
        else if (llmValue) resolved[field] = llmValue;
        else if (structuredValue) resolved[field] = structuredValue;

      } else {
        // For other fields, prefer structured data when available, then LLM
        if (structuredValue && this.isValidValue(structuredValue)) {
          (resolved as any)[field] = structuredValue;
        } else if (llmValue && this.isValidValue(llmValue)) {
          (resolved as any)[field] = llmValue;
        }
      }
    });

    // Add derived fields
    resolved.website_url = baseUrl;
    resolved.domain_name = new URL(baseUrl).hostname.replace('www.', '');
    if (resolved.location) {
      resolved.billing_address = resolved.location; // Assume same unless specified otherwise
    }

    return resolved;
  }

  /**
   * Validate field values
   */
  private isValidValue(value: any): boolean {
    return value &&
           value !== null &&
           value !== 'null' &&
           value !== 'not found' &&
           value !== 'not available' &&
           value !== 'unknown' &&
           String(value).trim().length > 0;
  }

  /**
   * Email validation
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) &&
           email.length < 100 &&
           !email.includes('example') &&
           !email.includes('placeholder');
  }

  /**
   * Phone validation for German/international numbers
   */
  private isValidPhone(phone: string): boolean {
    const phoneRegex = /^[\+\d\s\-\(\)\/]{8,25}$/;
    const cleanPhone = phone.replace(/\D/g, '');
    return phoneRegex.test(phone) &&
           cleanPhone.length >= 7 &&
           cleanPhone.length <= 15;
  }

  /**
   * Calculate confidence score based on extraction quality
   */
  private calculateConfidenceScore(extractedInfo: NGOInfo, pageContents: PageContent[]): number {
    let score = 0;
    const maxScore = 100;

    // Base score for successful extraction
    if (Object.keys(extractedInfo).length > 0) score += 15;

    // Core fields scoring
    if (extractedInfo.company_name) score += 15;
    if (extractedInfo.about && extractedInfo.about.length > 100) score += 15;
    else if (extractedInfo.about && extractedInfo.about.length > 50) score += 10;

    if (extractedInfo.contact_email) score += 12;
    if (extractedInfo.location) score += 10;
    if (extractedInfo.contact_phone) score += 8;

    // German-specific quality indicators
    if (extractedInfo.legal_entity && /e\.V\.|gGmbH|gUG|GmbH|AG|Stiftung/.test(extractedInfo.legal_entity)) score += 10;
    if (extractedInfo.registration_number && /HRB|HRA|VR|GnR|PR/.test(extractedInfo.registration_number)) score += 8;

    // Page quality indicators
    const hasLegalPage = pageContents.some(p => p.pageType === 'legal' && p.success);
    const hasContactPage = pageContents.some(p => p.pageType === 'contact' && p.success);
    const hasAboutPage = pageContents.some(p => p.pageType === 'about' && p.success);

    if (hasLegalPage) score += 8;
    if (hasContactPage) score += 6;
    if (hasAboutPage) score += 4;

    // Content quality indicators
    const avgContentLength = pageContents
      .filter(p => p.success)
      .reduce((sum, p) => sum + p.content.length, 0) / pageContents.filter(p => p.success).length;

    if (avgContentLength > 2000) score += 5;
    else if (avgContentLength > 1000) score += 3;

    // Successful page count bonus
    const successfulPages = pageContents.filter(p => p.success).length;
    score += Math.min(successfulPages * 2, 12);

    return Math.min(score / maxScore, 1.0);
  }

  /**
   * Assess source quality for confidence metadata
   */
  private assessSourceQuality(pageContents: PageContent[]): string {
    const hasLegal = pageContents.some(p => p.pageType === 'legal' && p.success);
    const hasContact = pageContents.some(p => p.pageType === 'contact' && p.success);
    const hasAbout = pageContents.some(p => p.pageType === 'about' && p.success);
    const successfulPages = pageContents.filter(p => p.success).length;

    if (hasLegal && hasContact && hasAbout && successfulPages >= 5) {
      return 'high';
    } else if ((hasLegal || hasContact) && successfulPages >= 3) {
      return 'medium';
    } else {
      return 'low';
    }
  }
}

/**
 * Standalone function for easy integration
 */
export async function fetchNGOInformation(websiteUrl: string): Promise<NGOExtractionResult> {
  const fetcher = new NGOWebsiteFetcher();
  return await fetcher.extractNGOInformation(websiteUrl);
}