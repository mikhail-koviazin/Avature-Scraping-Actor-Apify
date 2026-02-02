import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { CheerioCrawler, type CheerioCrawlingContext } from '@crawlee/cheerio';
import { Actor, log } from 'apify';

import { getRouteLabel, Label, router } from './routes/index.js';

interface StartUrl {
    url: string;
    method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'TRACE' | 'OPTIONS' | 'CONNECT' | 'PATCH';
    headers?: Record<string, string>;
    userData?: Record<string, unknown>;
}

interface Input {
    startUrls?: StartUrl[];
    /** List of subdomains to scrape (e.g., ["company.avature.net", "other.avature.net"]) */
    subdomains?: string[];
    /** URL path to append to subdomains (default: /careers/SearchJobs) */
    subdomainPath?: string;
    maxRequestsPerCrawl?: number;
    maxConcurrency?: number;

    // Proxy configuration
    /** Proxy provider: 'apify' (default), 'scraperapi', or 'none' */
    proxyType?: 'apify' | 'scraperapi' | 'none';
    /** Apify proxy groups (e.g., ['RESIDENTIAL', 'SHADER']) - only for proxyType: 'apify' */
    apifyProxyGroups?: string[];
    /** Apify proxy country code (e.g., 'US', 'GB') - only for proxyType: 'apify' */
    apifyProxyCountryCode?: string;
    /** ScraperAPI key - only for proxyType: 'scraperapi' */
    scraperApiKey?: string;
    /** ScraperAPI country code - only for proxyType: 'scraperapi' */
    scraperApiCountry?: string;

    saveErrorSamples?: boolean;
    errorSamplesPath?: string;
}

/**
 * Error patterns to detect error pages in content
 */
const ERROR_PAGE_PATTERNS = [
    { pattern: /page\s*not\s*found/i, type: 'PAGE_NOT_FOUND' },
    { pattern: /404\s*error/i, type: 'PAGE_NOT_FOUND' },
    { pattern: /not\s*found/i, type: 'PAGE_NOT_FOUND' },
    { pattern: /access\s*denied/i, type: 'ACCESS_DENIED' },
    { pattern: /forbidden/i, type: 'ACCESS_DENIED' },
    { pattern: /403\s*error/i, type: 'ACCESS_DENIED' },
    { pattern: /unauthorized/i, type: 'UNAUTHORIZED' },
    { pattern: /401\s*error/i, type: 'UNAUTHORIZED' },
    { pattern: /login\s*required/i, type: 'AUTH_REQUIRED' },
    { pattern: /sign\s*in\s*required/i, type: 'AUTH_REQUIRED' },
    { pattern: /authentication\s*required/i, type: 'AUTH_REQUIRED' },
    { pattern: /session\s*expired/i, type: 'SESSION_EXPIRED' },
    { pattern: /internal\s*server\s*error/i, type: 'SERVER_ERROR' },
    { pattern: /500\s*error/i, type: 'SERVER_ERROR' },
    { pattern: /service\s*unavailable/i, type: 'SERVICE_UNAVAILABLE' },
    { pattern: /503\s*error/i, type: 'SERVICE_UNAVAILABLE' },
    { pattern: /temporarily\s*unavailable/i, type: 'SERVICE_UNAVAILABLE' },
    { pattern: /maintenance/i, type: 'MAINTENANCE' },
    { pattern: /under\s*construction/i, type: 'MAINTENANCE' },
    { pattern: /job\s*(has\s*been\s*)?(closed|filled|expired|removed)/i, type: 'JOB_CLOSED' },
    { pattern: /position\s*(is\s*)?(no\s*longer\s*available|closed|filled)/i, type: 'JOB_CLOSED' },
    { pattern: /this\s*posting\s*(has\s*been\s*)?(closed|removed)/i, type: 'JOB_CLOSED' },
    { pattern: /multiple\s*users\s*connecting\s*from\s*your\s*ip/i, type: 'PROXY_RATE_LIMITED' },
    { pattern: /rate\s*limit/i, type: 'RATE_LIMITED' },
    { pattern: /too\s*many\s*requests/i, type: 'RATE_LIMITED' },
];

/**
 * Detect if page content indicates an error page
 */
function detectErrorInContent(html: string, $?: CheerioCrawlingContext['$']): { isError: boolean; type: string; message: string } | null {
    // Get page title for context
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : '';

    // Get body text for pattern matching (limit to avoid performance issues)
    let bodyText = '';
    if ($) {
        bodyText = $('body').text().substring(0, 5000);
    } else {
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        bodyText = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, ' ').substring(0, 5000) : '';
    }

    const fullText = `${pageTitle} ${bodyText}`.toLowerCase();

    for (const { pattern, type } of ERROR_PAGE_PATTERNS) {
        if (pattern.test(fullText)) {
            return {
                isError: true,
                type,
                message: `Detected error pattern: ${type}`,
            };
        }
    }

    return null;
}

/**
 * Simple HTML formatter for better readability
 */
function formatHtmlForReadability(html: string): string {
    const blockTags = [
        'html', 'head', 'body', 'div', 'section', 'article', 'header', 'footer',
        'nav', 'main', 'aside', 'form', 'table', 'thead', 'tbody', 'tr', 'ul', 'ol',
        'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'blockquote',
        'script', 'style', 'link', 'meta', 'title', 'noscript',
    ];
    const selfClosingTags = ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr'];

    let result = '';
    let indent = 0;
    const indentStr = '  ';

    // Normalize HTML
    const normalized = html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
    const tokens = normalized.split(/(<[^>]+>)/g).filter((t) => t.trim());

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i].trim();
        if (!token) continue;

        if (token.startsWith('</')) {
            indent = Math.max(0, indent - 1);
            const tagName = token.match(/<\/(\w+)/)?.[1]?.toLowerCase();
            if (tagName && blockTags.includes(tagName)) {
                result += `\n${indentStr.repeat(indent)}${token}`;
            } else {
                result += token;
            }
        } else if (token.startsWith('<')) {
            const tagName = token.match(/<(\w+)/)?.[1]?.toLowerCase();
            const isSelfClosing = (tagName && selfClosingTags.includes(tagName)) || token.endsWith('/>');

            if (tagName && blockTags.includes(tagName)) {
                result += `\n${indentStr.repeat(indent)}${token}`;
                if (!isSelfClosing) {
                    indent++;
                }
            } else {
                result += token;
            }
        } else {
            const trimmedToken = token.trim();
            if (trimmedToken) {
                const prevToken = tokens[i - 1]?.trim();
                const prevTagName = prevToken?.match(/<(\w+)/)?.[1]?.toLowerCase();
                if (prevTagName && blockTags.includes(prevTagName) && !prevToken?.startsWith('</')) {
                    result += `\n${indentStr.repeat(indent)}${trimmedToken}`;
                } else {
                    result += trimmedToken;
                }
            }
        }
    }

    return result.trim();
}

/**
 * Save error sample to file
 */
function saveErrorSample(
    url: string,
    html: string,
    errorType: string,
    errorMessage: string,
    statusCode: number | null,
    basePath: string
): void {
    try {
        const errorDir = join(basePath, 'error');
        if (!existsSync(errorDir)) {
            mkdirSync(errorDir, { recursive: true });
        }

        // Generate filename from URL and timestamp
        const subdomain = (() => {
            try {
                const parsed = new URL(url);
                const parts = parsed.hostname.split('.');
                return parts.length > 2 ? parts[0] : parsed.hostname;
            } catch {
                return 'unknown';
            }
        })();

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${subdomain}-${errorType.toLowerCase()}-${timestamp}.html`;
        const filepath = join(errorDir, filename);

        // Build header with error info
        const errorHeader = `<!--
================================================================================
ERROR SAMPLE
================================================================================
URL: ${url}
Error Type: ${errorType}
Error Message: ${errorMessage}
HTTP Status: ${statusCode ?? 'N/A'}
Captured At: ${new Date().toISOString()}
================================================================================
-->

`;

        // Format HTML for readability
        const formattedHtml = formatHtmlForReadability(html);

        writeFileSync(filepath, errorHeader + formattedHtml, 'utf-8');
        log.info(`Saved error sample`, { filepath, errorType, url });
    } catch (err) {
        log.warning(`Failed to save error sample`, { url, error: String(err) });
    }
}

await Actor.init();

Actor.on('aborting', async () => {
    await setTimeout(1000);
    await Actor.exit();
});

const {
    startUrls,
    subdomains,
    subdomainPath = '/careers/SearchJobs',
    maxRequestsPerCrawl = 1000,
    maxConcurrency = 10,
    // Proxy settings
    proxyType = 'apify',
    apifyProxyGroups,
    apifyProxyCountryCode,
    scraperApiKey,
    scraperApiCountry,
    saveErrorSamples = true,
    errorSamplesPath = './samples',
} = (await Actor.getInput<Input>()) ?? ({} as Input);

// Build start URLs from subdomains if provided
const buildUrlsFromSubdomains = (domains: string[], path: string): StartUrl[] => {
    return domains.map((domain) => {
        // Normalize domain: remove protocol if present, ensure no trailing slash
        let normalizedDomain = domain.trim();
        normalizedDomain = normalizedDomain.replace(/^https?:\/\//, '');
        normalizedDomain = normalizedDomain.replace(/\/+$/, '');

        // Normalize path: ensure leading slash
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;

        return { url: `https://${normalizedDomain}${normalizedPath}` };
    });
};

// Combine startUrls and subdomain-generated URLs
let allStartUrls: StartUrl[] = [];

if (subdomains && subdomains.length > 0) {
    const subdomainUrls = buildUrlsFromSubdomains(subdomains, subdomainPath);
    log.info(`Generated ${subdomainUrls.length} URLs from subdomains`, { path: subdomainPath });
    allStartUrls.push(...subdomainUrls);
}

if (startUrls && startUrls.length > 0) {
    allStartUrls.push(...startUrls);
}

// Default if nothing provided
if (allStartUrls.length === 0) {
    allStartUrls = [{ url: 'https://uclahealth.avature.net/careers/SearchJobs' }];
}

// Validate and label start URLs
const labeledStartUrls = allStartUrls.map((startUrl) => {
    const url = typeof startUrl === 'string' ? startUrl : startUrl.url;
    const label = getRouteLabel(url) ?? Label.LISTING; // Default to LISTING for base URLs

    log.info(`Start URL labeled`, { url, label });

    return {
        url,
        label,
        userData: {
            ...(typeof startUrl === 'object' ? startUrl.userData : {}),
        },
    };
});

// Build ScraperAPI proxy URL
// Format: http://scraperapi[.option=value]:APIKEY@proxy-server.scraperapi.com:8001
const buildScraperApiProxyUrl = (apiKey: string, country?: string): string => {
    const options = ['scraperapi'];
    if (country) {
        options.push(`country_code=${country}`);
    }
    return `http://${options.join('.')}:${apiKey}@proxy-server.scraperapi.com:8001`;
};

// Configure proxy based on proxyType
let proxyConfiguration;

if (proxyType === 'none') {
    log.info('Running without proxy');
    proxyConfiguration = undefined;
} else if (proxyType === 'scraperapi') {
    if (!scraperApiKey) {
        throw new Error('scraperApiKey is required when proxyType is "scraperapi"');
    }
    const proxyUrl = buildScraperApiProxyUrl(scraperApiKey, scraperApiCountry);
    log.info('Using ScraperAPI proxies', { country: scraperApiCountry ?? 'auto' });
    proxyConfiguration = await Actor.createProxyConfiguration({
        proxyUrls: [proxyUrl],
    });
} else {
    // Default: Apify proxies
    log.info('Using Apify proxies', {
        groups: apifyProxyGroups ?? ['RESIDENTIAL'],
        country: apifyProxyCountryCode ?? 'auto',
    });
    proxyConfiguration = await Actor.createProxyConfiguration({
        groups: apifyProxyGroups,
        countryCode: apifyProxyCountryCode,
    });
}

const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxRequestsPerCrawl,
    maxConcurrency,

    // Pre-navigation hook to check for HTTP errors
    preNavigationHooks: [
        async ({ request }, gotOptions) => {
            // Store original URL for error tracking
            request.userData.originalUrl = request.url;
            // Allow non-2xx responses to be processed
            if (gotOptions) {
                // eslint-disable-next-line no-param-reassign
                gotOptions.throwHttpErrors = false;
            }
        },
    ],

    // Main request handler with error detection
    requestHandler: async (context) => {
        const { request, response, $, body } = context;
        const url = request.loadedUrl ?? request.url;
        const statusCode = response?.statusCode ?? 200;
        const html = typeof body === 'string' ? body : body?.toString() ?? '';

        // Check HTTP status code for errors
        if (statusCode >= 400) {
            let errorType = 'HTTP_ERROR';
            if (statusCode === 401) errorType = 'UNAUTHORIZED';
            else if (statusCode === 403) errorType = 'ACCESS_DENIED';
            else if (statusCode === 404) errorType = 'PAGE_NOT_FOUND';
            else if (statusCode === 429) errorType = 'RATE_LIMITED';
            else if (statusCode === 499) errorType = 'PROXY_RATE_LIMITED'; // ScraperAPI rate limit
            else if (statusCode >= 500) errorType = 'SERVER_ERROR';

            const errorMessage = `HTTP ${statusCode} error`;
            log.warning(`HTTP error on page`, { url, statusCode, errorType });

            if (saveErrorSamples) {
                saveErrorSample(url, html, errorType, errorMessage, statusCode, errorSamplesPath);
            }

            // Don't process error pages further
            return;
        }

        // Check page content for error patterns
        const contentError = detectErrorInContent(html, $);
        if (contentError) {
            log.warning(`Error page detected`, { url, errorType: contentError.type, message: contentError.message });

            if (saveErrorSamples) {
                saveErrorSample(url, html, contentError.type, contentError.message, statusCode, errorSamplesPath);
            }

            // Don't process error pages further
            return;
        }

        // Clean up hidden elements before processing
        $('.visibility--hidden--visually').remove();

        // Page is valid, proceed with normal routing
        await router(context);
    },

    // Handle completely failed requests (network errors, timeouts, etc.)
    failedRequestHandler: async ({ request }, error) => {
        const url = request.loadedUrl ?? request.url;
        const errorMessage = error instanceof Error ? error.message : String(error);

        let errorType = 'REQUEST_FAILED';
        if (errorMessage.includes('timeout')) errorType = 'TIMEOUT';
        else if (errorMessage.includes('ECONNREFUSED')) errorType = 'CONNECTION_REFUSED';
        else if (errorMessage.includes('ENOTFOUND')) errorType = 'DNS_ERROR';
        else if (errorMessage.includes('certificate')) errorType = 'SSL_ERROR';

        log.error(`Request failed`, { url, errorType, error: errorMessage });

        if (saveErrorSamples) {
            // For failed requests, we may not have HTML, create a placeholder
            const errorHtml = `<!DOCTYPE html>
<html>
<head><title>Request Failed</title></head>
<body>
<h1>Request Failed</h1>
<p>The request to this URL failed completely.</p>
<p>Error: ${errorMessage}</p>
</body>
</html>`;
            saveErrorSample(url, errorHtml, errorType, errorMessage, null, errorSamplesPath);
        }
    },

    // Additional error handling settings
    maxRequestRetries: 3,
    navigationTimeoutSecs: 60,
});

log.info(`Starting crawler with ${labeledStartUrls.length} start URL(s)`);
await crawler.run(labeledStartUrls);

await Actor.exit();
