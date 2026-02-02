import { createCheerioRouter } from '@crawlee/cheerio';

import { defaultHandler } from './default.handler.js';
import { jobDetailHandler } from './job-detail.handler.js';
import { listingHandler } from './listing.handler.js';
import { Label } from './types.js';

// Re-export types and utilities
export { Label, URL_PATTERNS } from './types.js';
export { getBaseUrl, getRouteLabel, getSubdomain } from './utils.js';
export { createFieldExtractor, parseDate, parseSalary } from './extractors.js';

// Create and configure router
export const router = createCheerioRouter();

router.addHandler(Label.LISTING, listingHandler);
router.addHandler(Label.JOB_DETAIL, jobDetailHandler);
router.addDefaultHandler(defaultHandler);
