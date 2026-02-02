import { Label, URL_PATTERNS } from './types.js';

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
