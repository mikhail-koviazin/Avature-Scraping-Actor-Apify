import type { CheerioCrawlingContext, Source } from '@crawlee/cheerio';
import { log } from 'apify';

import { Label } from './types.js';
import { getBaseUrl, getSubdomain } from './utils.js';

/**
 * LISTING route handler - handles job search/listing pages
 * Extracts job links, metadata from cards, and handles pagination
 */
export async function listingHandler({ request, $, enqueueLinks, addRequests }: CheerioCrawlingContext) {
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
    const jobLinks: Source[] = [];
    const seenUrls = new Set<string>();

    $('.section__content__results .article, .list .list-item, .list .list__item').each((_, articleEl) => {
        const $article = $(articleEl);
        const $link = $article.find(".article__header__text__title a, .list__item__text__title a");
        const href = $link.attr('href');
        if (!href) return;

        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;

        // Deduplicate
        if (seenUrls.has(fullUrl)) return;
        seenUrls.add(fullUrl);

        const title = $article.find('.article__header__text__title, .list__item__text__title').first().text().trim();

        const subtitles: Record<string, string> = {};
        $article.find('.article__header__text__subtitle, .list__item__text__subtitle').each((__, subWrapper) => {
            const $subWrapper = $(subWrapper);
            const $subtitles = $subWrapper.find('[class^=list-item-]');
            if (!$subtitles.length) {
                subtitles.default = $subWrapper.text().trim();
            } else {
                $subtitles.each((___, subEl) => {
                    const classNames = $(subEl).attr('class')?.split(' ') || [];
                    const key = classNames.find((cn) => cn.startsWith('list-item-'))?.substring('list-item-'.length);
                    if (!key) {
                        return;
                    }
                    subtitles[key] = $(subEl).text().trim();
                });
            }
        });

        jobLinks.push({
            url: fullUrl,
            label: Label.JOB_DETAIL,
            userData: {
                title,
                subtitles,
            },
        });
    });

    log.info(`Found ${jobLinks.length} job links on listing page`, { subdomain });

    // Enqueue job detail pages
    if (jobLinks.length > 0) {
        await addRequests(jobLinks);
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
}
