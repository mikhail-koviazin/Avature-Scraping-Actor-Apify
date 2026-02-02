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
