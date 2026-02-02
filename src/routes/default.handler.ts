import type { CheerioCrawlingContext } from '@crawlee/cheerio';
import { log } from 'apify';

import { Label } from './types.js';
import { getBaseUrl } from './utils.js';

/**
 * Default handler for unrecognized URLs
 */
export async function defaultHandler({ request, enqueueLinks, $ }: CheerioCrawlingContext) {
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
}
