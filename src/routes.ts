import { type CheerioCrawlingContext,createCheerioRouter, Dataset } from '@crawlee/cheerio';
import { log } from 'apify';

export const enum Label {
    LISTING = 'LISTING',
    JOB_DETAIL = 'JOB_DETAIL',
}

/**
 * URL patterns for Avature career sites (domain-agnostic)
 * Supports both /careers/ and /en_US/careers/ patterns
 */
export const URL_PATTERNS = {
    LISTING: /\/careers\/SearchJobs/i,
    JOB_DETAIL: /\/careers\/JobDetail\/[^/]+\/\d+/i,
};

/**
 * Determine route label from URL
 */
export function getRouteLabel(url: string): Label | null {
    if (URL_PATTERNS.JOB_DETAIL.test(url)) return Label.JOB_DETAIL;
    if (URL_PATTERNS.LISTING.test(url)) return Label.LISTING;
    return null;
}

/**
 * Extract base URL (protocol + domain) from a full URL
 */
export function getBaseUrl(url: string): string {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Extract subdomain from URL for tracking source
 */
export function getSubdomain(url: string): string {
    const parsed = new URL(url);
    const parts = parsed.hostname.split('.');
    return parts.length > 2 ? parts[0] : parsed.hostname;
}

/**
 * Comprehensive field extraction helper
 * Searches for field values using multiple possible label variations
 */
function createFieldExtractor($: CheerioCrawlingContext['$']) {
    // Remove script and style tags from consideration
    $('script, style, noscript').remove();

    // Get text content, trimmed - excludes hidden elements
    const getText = (selector: string): string | null => {
        const text = $(selector).first().text().trim();
        return text || null;
    };

    // Helper to detect if text is likely just a company name
    const isCompanyName = (text: string): boolean => {
        const companyPatterns = [
            /^bloomberg$/i,
            /^ucla\s*health$/i,
            /^unifi$/i,
            /^avature$/i,
        ];
        return companyPatterns.some((pattern) => pattern.test(text.trim()));
    };

    // Get job title specifically - avoid site headers and navigation
    const getJobTitle = (url: string): string | null => {
        // Method 1: Try og:title meta tag (most reliable for Avature sites)
        const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
        if (ogTitle && ogTitle.length > 5 && ogTitle.length < 200) {
            return ogTitle;
        }

        // Method 2: Try page title, extract before " - jobId - " pattern
        const pageTitle = $('title').text().trim();
        if (pageTitle) {
            // Pattern: "Job Title - 12345 - Company Name" or "Job Title | Company"
            const titleMatch = pageTitle.match(/^(.+?)\s*[-|]\s*\d+\s*[-|]/);
            if (titleMatch && titleMatch[1].length > 5) {
                return titleMatch[1].trim();
            }
            // Simpler pattern: "Job Title - Company Name"
            const simpleTitleMatch = pageTitle.match(/^(.+?)\s*[-|]\s*[A-Z]/);
            if (simpleTitleMatch && simpleTitleMatch[1].length > 5 && simpleTitleMatch[1].length < 150) {
                return simpleTitleMatch[1].trim();
            }
        }

        // Method 3: Try Bloomberg-specific selector (first article field value with font class)
        const bloombergTitle = $('.article__content__view__field__value--font .article__content__view__field__value').first().text().trim();
        if (bloombergTitle && bloombergTitle.length > 5 && bloombergTitle.length < 200) {
            return bloombergTitle;
        }

        // Method 4: Try specific job title selectors
        const selectors = [
            'main h1:not(.visibility--hidden--visually)',
            'article h1',
            '[class*="job"] h1',
            '[class*="detail"] h1',
            '#content h1',
            '.content h1',
            'h1:not(header h1):not(nav h1):not(.visibility--hidden--visually)',
        ];

        for (const selector of selectors) {
            const $el = $(selector).first();
            if ($el.length) {
                const text = $el.text().trim();
                // Avoid common site titles and company names
                if (text && !text.toLowerCase().includes('home page') &&
                    !text.toLowerCase().includes('careers') &&
                    text.length > 5 && text.length < 200 &&
                    !isCompanyName(text)) {
                    return text;
                }
            }
        }

        // Method 5: Fallback - get first visible h1 that looks like a job title
        let title: string | null = null;
        $('h1').each((_, el) => {
            if (title) return;
            const $el = $(el);
            // Skip hidden elements
            if ($el.hasClass('visibility--hidden--visually') || $el.hasClass('sr-only')) return;
            const text = $el.text().trim();
            if (text && !text.toLowerCase().includes('home page') &&
                !text.toLowerCase().includes('careers') &&
                text.length > 5 && text.length < 200 &&
                !isCompanyName(text)) {
                title = text;
            }
        });

        // Method 6: Final fallback - extract from URL slug
        if (!title) {
            const urlMatch = url.match(/\/JobDetail\/([^/]+)\/\d+/);
            if (urlMatch) {
                // Convert slug to title: "Senior-Software-Engineer" -> "Senior Software Engineer"
                title = urlMatch[1].replace(/-/g, ' ');
            }
        }

        return title;
    };

    // Find field value by trying multiple label patterns
    // Specifically handles Avature's <strong>Label:</strong> Value pattern
    const getFieldByLabels = (labels: string[]): string | null => {
        for (const labelText of labels) {
            const lowerLabel = labelText.toLowerCase();

            let value: string | null = null;

            // Method 0: Bloomberg-specific pattern - label/value div pairs
            // <div class="article__content__view__field">
            //   <div class="article__content__view__field__label">Label</div>
            //   <div class="article__content__view__field__value">Value</div>
            // </div>
            $('.article__content__view__field').each((_, el) => {
                if (value) return;
                const $field = $(el);
                const $label = $field.find('.article__content__view__field__label');
                const $value = $field.find('.article__content__view__field__value');
                if ($label.length && $value.length) {
                    const labelTextContent = $label.text().trim().toLowerCase();
                    if (labelTextContent.includes(lowerLabel) || lowerLabel.includes(labelTextContent.replace(/[:#]/g, '').trim())) {
                        const valueText = $value.text().trim();
                        if (valueText && valueText.length < 500 && valueText.length > 0) {
                            value = valueText;
                        }
                    }
                }
            });

            if (value) return value;

            // Method 1: Look for <strong>Label:</strong> pattern in paragraphs
            $('p, div, span, li').each((_, el) => {
                if (value) return;

                const $el = $(el);
                const $strong = $el.find('strong, b');

                if ($strong.length) {
                    const strongText = $strong.first().text().trim().toLowerCase();
                    if (strongText.includes(lowerLabel)) {
                        // Get text after the strong tag
                        const fullText = $el.text().trim();
                        const strongPart = $strong.first().text().trim();
                        let remainder = fullText.substring(fullText.indexOf(strongPart) + strongPart.length);
                        remainder = remainder.replace(/^[:\-–|•\s]+/, '').trim();
                        if (remainder && remainder.length < 500 && !remainder.includes('twigConfig')) {
                            value = remainder;
                        }
                    }
                }
            });

            if (value) return value;

            // Method 2: Look for dt/dd pairs
            $('dt').each((_, el) => {
                if (value) return;
                const $dt = $(el);
                if ($dt.text().trim().toLowerCase().includes(lowerLabel)) {
                    const $dd = $dt.next('dd');
                    if ($dd.length) {
                        const ddText = $dd.text().trim();
                        if (ddText && ddText.length < 500) {
                            value = ddText;
                        }
                    }
                }
            });

            if (value) return value;

            // Method 3: Look for table rows
            $('tr').each((_, el) => {
                if (value) return;
                const $row = $(el);
                const $th = $row.find('th');
                const $td = $row.find('td');
                if ($th.length && $td.length) {
                    if ($th.text().trim().toLowerCase().includes(lowerLabel)) {
                        const tdText = $td.text().trim();
                        if (tdText && tdText.length < 500) {
                            value = tdText;
                        }
                    }
                }
            });

            if (value) return value;

            // Method 4: Look for adjacent divs (Bloomberg pattern)
            // e.g., <div>Location</div><div>New York</div>
            $('div, span').each((_, el) => {
                if (value) return;
                const $el = $(el);
                const text = $el.text().trim().toLowerCase();

                // Check if this div contains just the label
                if (text === lowerLabel || text === `${lowerLabel}:`) {
                    const $next = $el.next('div, span');
                    if ($next.length) {
                        const nextText = $next.text().trim();
                        // Make sure it's not another label
                        if (nextText && nextText.length < 200 &&
                            !nextText.toLowerCase().includes('location') &&
                            !nextText.toLowerCase().includes('business area') &&
                            !nextText.toLowerCase().includes('ref #')) {
                            value = nextText;
                        }
                    }
                }
            });

            if (value) return value;
        }
        return null;
    };

    // Extract text matching a pattern from visible content only
    const getTextByPattern = (pattern: RegExp): string | null => {
        // Get text from main content area, excluding scripts
        const contentText = $('main, article, #content, .content, [role="main"]').text() ||
            $('body').text();
        const match = contentText.match(pattern);
        return match ? match[1]?.trim() || match[0]?.trim() : null;
    };

    // Extract field from page text using regex
    const getFieldFromText = (labels: string[]): string | null => {
        const bodyText = $('body').text();
        for (const label of labels) {
            // Pattern: "Label" followed by whitespace and then value (until next label or newline)
            const pattern = new RegExp(
                `${label}[:\\s]*([^\\n]{3,100})(?=\\s*(?:Location|Business Area|Ref|Posted|Salary|Department|$))`,
                'i'
            );
            const match = bodyText.match(pattern);
            if (match && match[1]) {
                const value = match[1].trim();
                if (value && value.length < 200 && !value.includes('twigConfig')) {
                    return value;
                }
            }
        }
        return null;
    };

    return { getText, getJobTitle, getFieldByLabels, getTextByPattern, getFieldFromText };
}

/**
 * Parse various date formats found across Avature sites
 */
function parseDate(dateStr: string | null): string | null {
    if (!dateStr) return null;

    // Already ISO format
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;

    // MM/DD/YYYY (UCLA style)
    const mdyMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mdyMatch) {
        return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}`;
    }

    // DD-Mon-YYYY (Unifi style: "02-Feb-2026")
    const dMyMatch = dateStr.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
    if (dMyMatch) {
        const months: Record<string, string> = {
            jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
            jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
        };
        const month = months[dMyMatch[2].toLowerCase()];
        if (month) {
            return `${dMyMatch[3]}-${month}-${dMyMatch[1].padStart(2, '0')}`;
        }
    }

    // Full date format: "Tuesday, October 28, 2025"
    const fullMatch = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (fullMatch) {
        const months: Record<string, string> = {
            january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
            july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
        };
        const month = months[fullMatch[1].toLowerCase()];
        if (month) {
            return `${fullMatch[3]}-${month}-${fullMatch[2].padStart(2, '0')}`;
        }
    }

    return dateStr; // Return original if can't parse
}

/**
 * Parse salary information into structured format
 */
function parseSalary(salaryStr: string | null): { min: string | null; max: string | null; raw: string | null; period: string | null } {
    const result = { min: null as string | null, max: null as string | null, raw: salaryStr, period: null as string | null };
    if (!salaryStr) return result;

    // Detect period (hourly, annual, etc.)
    const lowerSalary = salaryStr.toLowerCase();
    if (lowerSalary.includes('hour')) result.period = 'hourly';
    else if (lowerSalary.includes('year') || lowerSalary.includes('annual')) result.period = 'yearly';
    else if (lowerSalary.includes('month')) result.period = 'monthly';
    else if (lowerSalary.includes('week')) result.period = 'weekly';

    // Range: $XX.XX - $YY.YY or $XX,XXX - $YY,YYY
    const rangeMatch = salaryStr.match(/\$?([\d,]+(?:\.\d{2})?)\s*[-–to]+\s*\$?([\d,]+(?:\.\d{2})?)/i);
    if (rangeMatch) {
        result.min = rangeMatch[1].replace(/,/g, '');
        result.max = rangeMatch[2].replace(/,/g, '');
        return result;
    }

    // Single value: $XX.XX
    const singleMatch = salaryStr.match(/\$?([\d,]+(?:\.\d{2})?)/);
    if (singleMatch) {
        result.min = singleMatch[1].replace(/,/g, '');
        result.max = result.min;
    }

    return result;
}

export const router = createCheerioRouter();

/**
 * LISTING route handler - handles job search/listing pages
 * Extracts job links, metadata from cards, and handles pagination
 */
router.addHandler(Label.LISTING, async ({ request, $, enqueueLinks }) => {
    const baseUrl = getBaseUrl(request.loadedUrl ?? request.url);
    const subdomain = getSubdomain(request.loadedUrl ?? request.url);
    log.info(`Processing listing page`, { url: request.loadedUrl, subdomain });

    // Extract total results count if available
    const resultsText = $('body').text();
    const totalMatch = resultsText.match(/of\s+(\d+)\s+results?/i);
    const totalJobs = totalMatch ? parseInt(totalMatch[1], 10) : null;
    if (totalJobs) {
        log.info(`Total jobs available: ${totalJobs}`, { subdomain });
    }

    // Extract job detail links with any metadata available on the listing
    const jobLinks: string[] = [];
    const seenUrls = new Set<string>();

    $('a[href*="/careers/JobDetail/"], a[href*="/JobDetail/"]').each((_, el) => {
        const $link = $(el);
        const href = $link.attr('href');
        if (!href) return;

        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;

        // Deduplicate
        if (seenUrls.has(fullUrl)) return;
        seenUrls.add(fullUrl);

        jobLinks.push(fullUrl);
    });

    log.info(`Found ${jobLinks.length} job links on listing page`, { subdomain });

    // Enqueue job detail pages
    if (jobLinks.length > 0) {
        await enqueueLinks({
            urls: jobLinks,
            label: Label.JOB_DETAIL,
        });
    }

    // Handle pagination
    const paginationLinks: string[] = [];
    const seenPagination = new Set<string>();

    // Look for pagination links
    $('a[href*="jobOffset"], a[href*="SearchJobs"], a[href*="pageNumber"]').each((_, el) => {
        const $link = $(el);
        const href = $link.attr('href');
        const text = $link.text().trim().toLowerCase();

        if (!href) return;

        // Skip previous/back links
        if (text.includes('prev') || text.includes('<<') || text.includes('back')) return;

        // Skip if it's the current page (often has no href or same URL)
        if (href === '#' || href === '') return;

        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;

        // Deduplicate
        if (seenPagination.has(fullUrl)) return;
        seenPagination.add(fullUrl);

        paginationLinks.push(fullUrl);
    });

    if (paginationLinks.length > 0) {
        log.info(`Found ${paginationLinks.length} pagination links`, { subdomain });
        await enqueueLinks({
            urls: paginationLinks,
            label: Label.LISTING,
        });
    }
});

/**
 * JOB_DETAIL route handler - extracts comprehensive job information
 * Handles field variations across different Avature implementations
 */
router.addHandler(Label.JOB_DETAIL, async ({ request, $ }) => {
    const url = request.loadedUrl ?? request.url;
    const subdomain = getSubdomain(url);
    const { getJobTitle, getFieldByLabels, getTextByPattern, getFieldFromText } = createFieldExtractor($);

    log.info(`Processing job detail page`, { url, subdomain });

    // Extract job ID from URL
    const jobIdMatch = url.match(/\/(\d+)(?:[/?#]|$)/);
    const jobId = jobIdMatch ? jobIdMatch[1] : null;

    // Extract job title using specialized function (with URL fallback)
    const title = getJobTitle(url);

    // Location variations - try structured extraction first, then text-based
    const location = getFieldByLabels([
        'work location', 'location', 'job location', 'city', 'office location',
    ]) ?? getFieldFromText(['Location']);

    // Work type (remote/onsite/hybrid)
    const workType = getFieldByLabels([
        'work type', 'remote', 'workplace type', 'work arrangement', 'location type',
    ]);

    // Schedule/shift variations
    const schedule = getFieldByLabels([
        'work schedule', 'schedule', 'shift', 'hours', 'working hours',
    ]);

    // Salary variations
    const salaryRaw = getFieldByLabels([
        'salary range', 'salary', 'compensation', 'pay range', 'base pay rate',
        'pay rate', 'base pay', 'hourly rate', 'annual salary',
    ]);
    const salary = parseSalary(salaryRaw);

    // Employment type variations
    const employmentType = getFieldByLabels([
        'employment type', 'job type', 'position type', 'full/part time',
        'full time/part time', 'type',
    ]);

    // Employment classification (exempt/non-exempt)
    const employmentClassification = getFieldByLabels([
        'employment classification', 'classification', 'flsa status', 'exempt status',
    ]);

    // Duration
    const duration = getFieldByLabels([
        'duration', 'contract length', 'term', 'assignment length',
    ]);

    // Department/Business area variations
    const department = getFieldByLabels([
        'department', 'business area', 'division', 'team', 'group', 'organization',
    ]) ?? getFieldFromText(['Business Area', 'Department']);

    // Category/Job family
    const category = getFieldByLabels([
        'category', 'job family', 'job category', 'function', 'area',
    ]);

    // Entity/Company (for multi-entity organizations)
    const entity = getFieldByLabels([
        'entity', 'company', 'subsidiary', 'business unit', 'legal entity',
    ]);

    // Posted date variations
    const postedDateRaw = getFieldByLabels([
        'posted date', 'posted', 'date posted', 'posting date', 'published',
    ]) ?? getTextByPattern(/posted[:\s]+(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})/i);
    const postedDate = parseDate(postedDateRaw);

    // Reference/Requisition number (sometimes separate from job ID)
    // More specific patterns to avoid matching JavaScript content
    const refNumber = getFieldByLabels([
        'job #', 'job number', 'requisition', 'req id', 'position id', 'opening id',
    ]) ?? getFieldFromText(['Ref #', 'Ref#', 'Reference'])
        ?? getTextByPattern(/(?:job\s*#|ref\s*#|requisition[:\s]*#?)\s*(\d+)/i);

    // Application URL
    let applyUrl: string | null = null;
    $('a[href*="ApplicationMethods"], a[href*="Apply"], a[href*="apply"]').each((_, el) => {
        if (!applyUrl) {
            const href = $(el).attr('href');
            if (href) {
                applyUrl = href.startsWith('http') ? href : `${getBaseUrl(url)}${href}`;
            }
        }
    });

    // Extract description sections
    let description: string | null = null;
    let qualifications = '';
    let duties = '';

    // Method 1: Look for h3 headings followed by content (Avature pattern)
    $('h3').each((_, el) => {
        const $heading = $(el);
        const headingText = $heading.text().trim().toLowerCase();

        // Get all content until next h3 or section end
        const contentParts: string[] = [];
        let $next = $heading.next();
        while ($next.length && !$next.is('h3, h2, h1')) {
            const text = $next.text().trim();
            if (text && !text.includes('Press space or enter')) {
                contentParts.push(text);
            }
            $next = $next.next();
        }
        const content = contentParts.join('\n');

        if (!content || content.length < 20) return;

        if (headingText.includes('primary dut') || headingText.includes('responsibilit') ||
            headingText.includes('what you')) {
            duties = duties ? `${duties}\n${content}` : content;
        } else if (headingText.includes('qualification') || headingText.includes('requirement') ||
            headingText.includes('skills') || headingText.includes('experience')) {
            qualifications = qualifications ? `${qualifications}\n${content}` : content;
        } else if (headingText.includes('description') || headingText.includes('overview') ||
            headingText.includes('summary') || headingText.includes('about the role')) {
            if (!description || content.length > description.length) {
                description = content;
            }
        }
    });

    // Method 2: Look for labeled sections/divs
    $('section, [class*="section"], [class*="collapsible"], details, [role="region"]').each((_, el) => {
        const $section = $(el);
        const heading = $section.find('h2, h3, h4, summary, [class*="header"], [class*="title"]')
            .first().text().trim().toLowerCase();
        const content = $section.find('p, ul, ol').text().trim();

        if (!content || content.length < 20) return;

        if (heading.includes('description') || heading.includes('overview') ||
            heading.includes('summary') || heading.includes('about')) {
            if (!description || content.length > description.length) {
                description = content;
            }
        } else if (heading.includes('qualification') || heading.includes('requirement') ||
            heading.includes('skills') || heading.includes('experience')) {
            if (!qualifications) qualifications = content;
        } else if (heading.includes('dut') || heading.includes('responsibilit') ||
            heading.includes('what you')) {
            if (!duties) duties = content;
        }
    });

    // Method 3: Fallback - get main content area
    if (!description && !duties && !qualifications) {
        const mainContent = $('main, article, [role="main"], #content, .content')
            .first().text().trim();
        if (mainContent && mainContent.length > 100) {
            description = mainContent;
        }
    }

    // Build job data object
    const jobData = {
        // Identifiers
        url,
        jobId,
        refNumber: refNumber !== jobId ? refNumber : null, // Avoid duplicate if same as jobId
        subdomain,

        // Core info
        title,
        location,
        workType,
        schedule,

        // Compensation
        salaryMin: salary.min,
        salaryMax: salary.max,
        salaryPeriod: salary.period,
        salaryRaw: salary.raw,

        // Employment details
        employmentType,
        employmentClassification,
        duration,

        // Organization
        department,
        category,
        entity,

        // Dates
        postedDate,

        // Content (full text preserved for AI analysis)
        description: description ?? null,
        qualifications: qualifications || null,
        duties: duties || null,

        // Application
        applyUrl,

        // Metadata
        scrapedAt: new Date().toISOString(),
    };

    log.info(`Extracted job: ${jobData.title}`, {
        jobId: jobData.jobId,
        subdomain,
        hasDescription: !!jobData.description,
        hasSalary: !!jobData.salaryRaw,
    });

    await Dataset.pushData(jobData);
});

/**
 * Default handler for unrecognized URLs
 */
router.addDefaultHandler(async ({ request, enqueueLinks, $ }) => {
    const url = request.loadedUrl ?? request.url;
    const baseUrl = getBaseUrl(url);
    log.warning(`Default handler - checking for job links`, { url });

    // Try to find and enqueue any job detail links on the page
    const jobLinks: string[] = [];
    $('a[href*="/careers/JobDetail/"], a[href*="/JobDetail/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
            const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
            if (!jobLinks.includes(fullUrl)) {
                jobLinks.push(fullUrl);
            }
        }
    });

    if (jobLinks.length > 0) {
        log.info(`Found ${jobLinks.length} job links on unhandled page`, { url });
        await enqueueLinks({
            urls: jobLinks,
            label: Label.JOB_DETAIL,
        });
    }

    // Also look for SearchJobs links
    const listingLinks: string[] = [];
    $('a[href*="/careers/SearchJobs"], a[href*="SearchJobs"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
            const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
            if (!listingLinks.includes(fullUrl)) {
                listingLinks.push(fullUrl);
            }
        }
    });

    if (listingLinks.length > 0) {
        log.info(`Found ${listingLinks.length} listing links on unhandled page`, { url });
        await enqueueLinks({
            urls: listingLinks,
            label: Label.LISTING,
        });
    }
});
