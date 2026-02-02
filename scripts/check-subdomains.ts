#!/usr/bin/env npx tsx
/**
 * Script to check which Avature subdomains have valid job listings
 * Uses ScraperAPI proxy for requests
 *
 * Usage: npx tsx scripts/check-subdomains.ts
 *
 * Outputs:
 * - output/subdomain-check.csv - Full results with status
 * - output/avature-subdomains-valid.json - Valid subdomains with jobs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';

// Configuration
const SCRAPER_API_KEY = 'ac094e98e36abd8e7ca1b9088f2dc01f';
const MAX_CONCURRENCY = 5;
const TIMEOUT = 60000;
const DELAY_BETWEEN_REQUESTS = 400; // Delay before starting next request
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // Wait before retry on rate limit

type Status = 'working' | 'auth_required' | 'not_working' | 'blocked' | 'error';

interface SubdomainResult {
    subdomain: string;
    listingUrl: string;
    status: Status;
    totalJobs: number | null;
    statusCode?: number;
    error?: string;
}

/**
 * Build ScraperAPI URL
 */
function buildScraperApiUrl(targetUrl: string): string {
    const params = new URLSearchParams({
        api_key: SCRAPER_API_KEY,
        url: targetUrl,
        render: 'false',
    });
    return `http://api.scraperapi.com?${params.toString()}`;
}

/**
 * Extract total jobs count from page (using selectors from handlers)
 */
function extractTotalJobs($: cheerio.CheerioAPI): number | null {
    const bodyText = $('body').text();

    // Method 1: Look for various "X jobs/results" text patterns
    const patterns = [
        // "There are 83 jobs matching your criteria" (William Hill style)
        /there\s+are\s+(\d+)\s+jobs?\s+matching/i,
        // "83 jobs matching"
        /(\d+)\s+jobs?\s+matching/i,
        // "Showing 1-10 of 607 results"
        /showing\s+\d+\s*[-–]\s*\d+\s+of\s+(\d+)/i,
        // "of 607 results"
        /of\s+(\d+)\s+results?/i,
        // "607 results" (but not "0 results")
        /(\d+)\s+results?(?!\s*found)/i,
        // "607 jobs found"
        /(\d+)\s+jobs?\s+found/i,
        // "Found 607 jobs"
        /found\s+(\d+)\s+jobs?/i,
        // "607 open positions"
        /(\d+)\s+open\s+positions?/i,
        // "607 opportunities"
        /(\d+)\s+opportunit(?:y|ies)/i,
    ];

    for (const pattern of patterns) {
        const match = bodyText.match(pattern);
        if (match) {
            const count = parseInt(match[1], 10);
            if (count > 0) {
                return count;
            }
        }
    }

    // Method 2: Count job detail links on page
    const jobLinks = new Set<string>();
    $('a[href*="/careers/JobDetail/"], a[href*="/JobDetail/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
            // Extract unique job URLs
            const match = href.match(/\/JobDetail\/[^/]+\/(\d+)/);
            if (match) {
                jobLinks.add(match[1]);
            }
        }
    });

    if (jobLinks.size > 0) {
        return jobLinks.size;
    }

    return null;
}

/**
 * Check a single subdomain with retry logic for rate limits
 */
async function checkSubdomain(subdomain: string): Promise<SubdomainResult> {
    const listingUrl = `https://${subdomain}/careers/SearchJobs`;
    const result: SubdomainResult = {
        subdomain,
        listingUrl,
        status: 'error',
        totalJobs: null,
    };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const scraperUrl = buildScraperApiUrl(listingUrl);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

            const response = await fetch(scraperUrl, {
                signal: controller.signal,
                headers: { 'Accept': 'text/html,application/xhtml+xml' },
            });

            clearTimeout(timeoutId);
            result.statusCode = response.status;

            // Retry on proxy rate limit errors
            if (response.status === 499 || response.status === 429) {
                if (attempt < MAX_RETRIES) {
                    console.log(`    ↻ ${subdomain} rate limited, retry ${attempt}/${MAX_RETRIES}...`);
                    await new Promise(r => setTimeout(r, RETRY_DELAY));
                    continue;
                }
                result.status = 'blocked';
                result.error = `Rate limited after ${MAX_RETRIES} retries`;
                return result;
            }

        if (response.status === 404) {
            result.status = 'not_working';
            result.error = 'Page not found';
            return result;
        }

        if (response.status === 403 || response.status === 401) {
            result.status = 'auth_required';
            result.error = 'Access denied';
            return result;
        }

        if (response.status >= 500) {
            result.status = 'error';
            result.error = `Server error ${response.status}`;
            return result;
        }

        const html = await response.text();

        // Check for proxy rate limit - retry
        if (html.includes('multiple users connecting from your IP')) {
            if (attempt < MAX_RETRIES) {
                console.log(`    ↻ ${subdomain} proxy rate limited, retry ${attempt}/${MAX_RETRIES}...`);
                await new Promise(r => setTimeout(r, RETRY_DELAY));
                continue;
            }
            result.status = 'blocked';
            result.error = `Proxy rate limited after ${MAX_RETRIES} retries`;
            return result;
        }

        const $ = cheerio.load(html);
        const pageTitle = $('title').text().trim().toLowerCase();
        const bodyText = $('body').text().trim();
        const bodyLength = bodyText.length;

        // Check for empty/minimal content (potential auth redirect or internal portal)
        // These sites often return empty pages or minimal content when auth is required
        if (bodyLength < 50 && !pageTitle) {
            result.status = 'auth_required';
            result.error = 'Empty page (likely requires auth)';
            return result;
        }

        // Check for explicit auth pages
        const hasLoginForm = $('form[action*="login"]').length > 0 ||
                            $('form[action*="Login"]').length > 0 ||
                            $('form[action*="signin"]').length > 0 ||
                            $('form[action*="auth"]').length > 0;
        const hasPasswordField = $('input[type="password"]').length > 0;
        const hasAuthKeywords = pageTitle.includes('login') ||
                               pageTitle.includes('sign in') ||
                               pageTitle.includes('authentication') ||
                               pageTitle.includes('access denied') ||
                               pageTitle.includes('sso') ||
                               pageTitle.includes('single sign-on');

        // Check body text for auth indicators
        const bodyLower = bodyText.toLowerCase();
        const hasAuthBodyText = bodyLower.includes('please log in') ||
                               bodyLower.includes('please sign in') ||
                               bodyLower.includes('enter your credentials') ||
                               bodyLower.includes('authentication required') ||
                               (bodyLower.includes('username') && bodyLower.includes('password'));

        if (hasLoginForm || hasPasswordField || hasAuthKeywords || hasAuthBodyText) {
            result.status = 'auth_required';
            result.error = 'Requires login';
            return result;
        }

        // Check for "page not found" in content (some return 200 with error page)
        if (bodyLower.includes('page not found') ||
            bodyLower.includes('page was not found') ||
            bodyLower.includes('404') ||
            (bodyLower.includes('sorry') && bodyLower.includes('not exist'))) {
            result.status = 'not_working';
            result.error = 'Page not found (in content)';
            return result;
        }

        // Check for job listings
        const hasJobLinks = $('a[href*="/careers/JobDetail/"], a[href*="/JobDetail/"]').length > 0;
        const hasArticles = $('.article').length > 0;
        const hasJobElements = $('[class*="job"]').length > 0 || $('[class*="position"]').length > 0;
        const hasSearchForm = $('form[action*="SearchJobs"]').length > 0 ||
                             $('[class*="search"]').length > 0;

        if (hasJobLinks || hasArticles || hasJobElements) {
            result.status = 'working';
            result.totalJobs = extractTotalJobs($);
        } else if (hasSearchForm || pageTitle.includes('career') || pageTitle.includes('job') || pageTitle.includes('search')) {
            // Career page exists but no jobs currently
            result.status = 'working';
            result.totalJobs = 0;
        } else {
            result.status = 'not_working';
            result.error = 'No job elements found';
        }

        return result;

        } catch (err) {
            const error = err as Error;
            // Retry on timeout
            if (error.name === 'AbortError' && attempt < MAX_RETRIES) {
                console.log(`    ↻ ${subdomain} timeout, retry ${attempt}/${MAX_RETRIES}...`);
                await new Promise(r => setTimeout(r, RETRY_DELAY));
                continue;
            }
            result.status = 'error';
            result.error = error.name === 'AbortError' ? 'Timeout' : error.message;
            return result;
        }
    }

    return result;
}

/**
 * Process subdomains with sliding window concurrency
 * Starts next request as soon as one finishes, maintaining max concurrency
 */
async function processWithConcurrency(subdomains: string[]): Promise<SubdomainResult[]> {
    const results: SubdomainResult[] = [];
    let nextIndex = 0;
    let completed = 0;
    const total = subdomains.length;

    async function processOne(subdomain: string, index: number): Promise<void> {
        const result = await checkSubdomain(subdomain);
        const icon = result.status === 'working' ? '✓' :
                    result.status === 'auth_required' ? '🔒' :
                    result.status === 'blocked' ? '⊘' :
                    result.status === 'not_working' ? '✗' : '?';
        const jobs = result.totalJobs !== null ? ` [${result.totalJobs} jobs]` : '';
        completed++;
        console.log(`  [${completed}/${total}] ${icon} ${subdomain} - ${result.status}${jobs}`);
        results[index] = result;
    }

    return new Promise((resolve) => {
        let running = 0;

        function startNext() {
            while (running < MAX_CONCURRENCY && nextIndex < subdomains.length) {
                const index = nextIndex;
                const subdomain = subdomains[index];
                nextIndex++;
                running++;

                processOne(subdomain, index)
                    .finally(() => {
                        running--;
                        if (nextIndex < subdomains.length) {
                            // Small delay to avoid hammering the API
                            setTimeout(startNext, DELAY_BETWEEN_REQUESTS);
                        } else if (running === 0) {
                            resolve(results);
                        }
                    });
            }

            // Handle case when all started but none running (empty input)
            if (running === 0 && nextIndex >= subdomains.length) {
                resolve(results);
            }
        }

        startNext();
    });
}

/**
 * Generate CSV content
 */
function generateCsv(results: SubdomainResult[]): string {
    const headers = ['subdomain', 'listing_url', 'status', 'total_jobs', 'error'];
    const rows = results.map(r => [
        r.subdomain,
        r.listingUrl,
        r.status,
        r.totalJobs !== null ? r.totalJobs.toString() : '',
        r.error || '',
    ]);

    // Escape CSV values
    const escapeCsv = (val: string) => {
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
            return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
    };

    const csvRows = [headers.join(',')];
    rows.forEach(row => {
        csvRows.push(row.map(escapeCsv).join(','));
    });

    return csvRows.join('\n');
}

/**
 * Main
 */
async function main() {
    console.log('═'.repeat(60));
    console.log('  AVATURE SUBDOMAIN CHECKER');
    console.log('═'.repeat(60));

    // Load subdomains
    const inputPath = join(process.cwd(), 'input', 'mine', 'avature-subdomains.json');
    console.log(`\nInput: ${inputPath}`);

    let allSubdomains: string[];
    try {
        allSubdomains = JSON.parse(readFileSync(inputPath, 'utf-8'));
    } catch (err) {
        console.error(`Failed to load: ${err}`);
        process.exit(1);
    }

    // Filter out non-career subdomains
    const excludePatterns = [
        /^www\./,
        /^smtp/,
        /^mail\./,
        /^docs\./,
        /^api\./,
        /^cdn/,
        /^analytics/,
        /^marketing\./,
        /^sales\./,
        /^training/,
        /^sandbox/,
        /^pentest/,
        /^uat[^a-z]/,
        /^qa[^a-z]/,
        /^staging/,
        /^demo/,
        /^test/,
        /integrations\./,
        /clientcertificate/,
        /-sso\./,
        /broadbeanjobexport/,
        /label-studio/,
        /rocketchat/,
        /^label-/,
    ];

    const filteredSubdomains = allSubdomains.filter(s =>
        !excludePatterns.some(p => p.test(s.toLowerCase()))
    );

    // Limit for testing (remove or increase for full run)
    const TEST_LIMIT = 20;
    const subdomains = filteredSubdomains.slice(0, TEST_LIMIT);

    console.log(`Total: ${allSubdomains.length} | Filtered: ${subdomains.length}`);
    console.log(`Max concurrency: ${MAX_CONCURRENCY} | Timeout: ${TIMEOUT}ms`);

    // Process all subdomains with sliding window concurrency
    console.log('\nProcessing...');
    const results = await processWithConcurrency(subdomains);

    // Summary
    const summary = {
        working: results.filter(r => r.status === 'working'),
        authRequired: results.filter(r => r.status === 'auth_required'),
        notWorking: results.filter(r => r.status === 'not_working'),
        blocked: results.filter(r => r.status === 'blocked'),
        errors: results.filter(r => r.status === 'error'),
    };

    console.log('\n' + '═'.repeat(60));
    console.log('  SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Working:       ${summary.working.length}`);
    console.log(`  Auth Required: ${summary.authRequired.length}`);
    console.log(`  Not Working:   ${summary.notWorking.length}`);
    console.log(`  Blocked:       ${summary.blocked.length}`);
    console.log(`  Errors:        ${summary.errors.length}`);

    // Create output directory
    const outputDir = join(process.cwd(), 'output');
    mkdirSync(outputDir, { recursive: true });

    // Sort results: working first, then by job count
    const sortedResults = [...results].sort((a, b) => {
        const statusOrder: Record<Status, number> = {
            working: 0,
            auth_required: 1,
            blocked: 2,
            not_working: 3,
            error: 4,
        };
        if (statusOrder[a.status] !== statusOrder[b.status]) {
            return statusOrder[a.status] - statusOrder[b.status];
        }
        return (b.totalJobs || 0) - (a.totalJobs || 0);
    });

    // Save CSV
    const csvPath = join(outputDir, 'subdomain-check.csv');
    writeFileSync(csvPath, generateCsv(sortedResults), 'utf-8');
    console.log(`\nCSV saved: ${csvPath}`);

    // Save valid subdomains JSON
    const validSubdomains = summary.working
        .filter(r => r.totalJobs === null || r.totalJobs > 0)
        .map(r => r.subdomain);

    const validJsonPath = join(outputDir, 'avature-subdomains-valid.json');
    writeFileSync(validJsonPath, JSON.stringify(validSubdomains, null, 2), 'utf-8');
    console.log(`Valid JSON saved: ${validJsonPath}`);

    // Print working subdomains with jobs
    const withJobs = summary.working.filter(r => r.totalJobs && r.totalJobs > 0);
    if (withJobs.length > 0) {
        console.log('\n' + '═'.repeat(60));
        console.log('  WORKING SUBDOMAINS WITH JOBS');
        console.log('═'.repeat(60));
        withJobs
            .sort((a, b) => (b.totalJobs || 0) - (a.totalJobs || 0))
            .forEach(r => {
                console.log(`  ${r.subdomain.padEnd(35)} ${r.totalJobs} jobs`);
            });
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
