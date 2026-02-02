import type { CheerioCrawlingContext } from '@crawlee/cheerio';
import { Dataset } from '@crawlee/cheerio';
import { log } from 'apify';

import { createFieldExtractor, parseDate, parseSalary } from './extractors.js';
import { getBaseUrl, getSubdomain } from './utils.js';

/**
 * JOB_DETAIL route handler - extracts comprehensive job information
 * Handles field variations across different Avature implementations
 */
export async function jobDetailHandler({ request, $ }: CheerioCrawlingContext) {
    const url = request.loadedUrl ?? request.url;
    const subdomain = getSubdomain(url);
    const { getJobTitle, getFieldByLabels, getTextByPattern, getFieldFromText } = createFieldExtractor($);

    log.info(`Processing job detail page`, { url, subdomain });

    // Extract job ID from URL
    const jobIdMatch = url.match(/\/(\d+)(?:[/?#]|$)/);
    const jobId = jobIdMatch ? jobIdMatch[1] : null;

    // Extract job title from userData or using specialized function (with URL fallback)
    const title = request.userData?.title || getJobTitle(url);

    // Location variations - try structured extraction first, then text-based
    const location = request.userData?.subtitles?.location || request.userData?.subtitles?.locationBuiltIn || (getFieldByLabels([
        'work location', 'location', 'job location', 'city', 'office location',
    ]) ?? getFieldFromText(['Location']));

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
    const employmentType = request.userData?.subtitles?.workingTime || (getFieldByLabels([
        'employment type', 'job type', 'position type', 'full/part time',
        'full time/part time', 'type',
    ]));

    // Employment classification (exempt/non-exempt)
    const employmentClassification = getFieldByLabels([
        'employment classification', 'classification', 'flsa status', 'exempt status',
    ]);

    // Duration
    const duration = request.userData?.subtitles?.contractType || (getFieldByLabels([
        'duration', 'contract length', 'term', 'assignment length',
    ]));

    // Department/Business area variations
    const department = request.userData?.subtitles?.department || (getFieldByLabels([
        'department', 'business area', 'division', 'team', 'group', 'organization',
    ]) ?? getFieldFromText(['Business Area', 'Department']));

    // Category/Job family
    const category = getFieldByLabels([
        'category', 'job family', 'job category', 'function', 'area',
    ]);

    // Entity/Company (for multi-entity organizations)
    const entity = request.userData?.subtitles?.legalEntity || (getFieldByLabels([
        'entity', 'company', 'subsidiary', 'business unit', 'legal entity',
    ]));

    // Posted date variations
    const postedDateRaw = getFieldByLabels([
        'posted date', 'posted', 'date posted', 'posting date', 'published',
    ]) ?? getTextByPattern(/posted[:\s]+(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})/i);
    const postedDate = parseDate(postedDateRaw);

    // Reference/Requisition number (sometimes separate from job ID)
    const refNumber = request.userData?.subtitles?.ref?.toLowerCase().replaceAll(/(ref)\s#/g, '') || (getFieldByLabels([
        'job #', 'job number', 'requisition', 'req id', 'position id', 'opening id', 'ref', 'ref #',
    ]) ?? getFieldFromText(['Ref #', 'Ref#', 'Reference'])
        ?? getTextByPattern(/(?:job\s*#|ref\s*#|requisition[:\s]*#?)\s*(\d+)/i));

    // Application URL
    let applyUrl: string | null = null;
    $('a[href*="ApplicationMethods"], a[href*="Apply"], a[href*="apply"], a:contains("Apply"), a:contains("apply"), a.button--primary').each((_, el) => {
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

    // Get main content area (for further AI analysis)
    const fullContent = $('main, article, [role="main"], #content, .content')
        .first().text().trim();

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
        fullContent,

        // Application
        applyUrl,

        // Additional info
        additional: request.userData?.subtitles || null,

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
}
