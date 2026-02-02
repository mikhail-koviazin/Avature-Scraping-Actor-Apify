#!/usr/bin/env node
/**
 * Format HTML sample files for better human reading
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const SAMPLES_DIR = './samples';

/**
 * Simple HTML formatter that adds indentation and line breaks
 */
function formatHtml(html) {
    // Tags that should have their content on a new line
    const blockTags = [
        'html', 'head', 'body', 'div', 'section', 'article', 'header', 'footer',
        'nav', 'main', 'aside', 'form', 'table', 'thead', 'tbody', 'tr', 'ul', 'ol',
        'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'blockquote',
        'script', 'style', 'link', 'meta', 'title', 'noscript'
    ];

    // Self-closing tags
    const selfClosingTags = ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr'];

    let result = '';
    let indent = 0;
    const indentStr = '  ';

    // First, normalize the HTML - remove existing formatting
    html = html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

    // Split by tags
    const tokens = html.split(/(<[^>]+>)/g).filter(t => t.trim());

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i].trim();
        if (!token) continue;

        if (token.startsWith('</')) {
            // Closing tag
            indent = Math.max(0, indent - 1);
            const tagName = token.match(/<\/(\w+)/)?.[1]?.toLowerCase();
            if (tagName && blockTags.includes(tagName)) {
                result += '\n' + indentStr.repeat(indent) + token;
            } else {
                result += token;
            }
        } else if (token.startsWith('<')) {
            // Opening tag or self-closing
            const tagName = token.match(/<(\w+)/)?.[1]?.toLowerCase();
            const isSelfClosing = selfClosingTags.includes(tagName) || token.endsWith('/>');

            if (tagName && blockTags.includes(tagName)) {
                result += '\n' + indentStr.repeat(indent) + token;
                if (!isSelfClosing) {
                    indent++;
                }
            } else {
                result += token;
            }
        } else {
            // Text content
            const trimmedToken = token.trim();
            if (trimmedToken) {
                // Check if previous was a block tag
                const prevToken = tokens[i - 1]?.trim();
                const prevTagName = prevToken?.match(/<(\w+)/)?.[1]?.toLowerCase();
                if (prevTagName && blockTags.includes(prevTagName) && !prevToken?.startsWith('</')) {
                    result += '\n' + indentStr.repeat(indent) + trimmedToken;
                } else {
                    result += trimmedToken;
                }
            }
        }
    }

    return result.trim();
}

/**
 * Add metadata header to sample file
 */
function addMetadataHeader(html, filename, subdomain) {
    const isListing = filename.includes('listing');
    const isJob = filename.includes('job');
    const pageType = isListing ? 'LISTING PAGE' : isJob ? 'JOB DETAIL PAGE' : 'UNKNOWN PAGE';

    const header = `<!--
================================================================================
AVATURE SAMPLE: ${pageType}
================================================================================
Subdomain: ${subdomain}
File: ${filename}
Downloaded: ${new Date().toISOString()}
================================================================================
-->

`;

    // Don't add header if already has one
    if (html.includes('================================================================================')) {
        return html;
    }

    return header + html;
}

/**
 * Process all HTML files in samples directory
 */
function processDirectory(dir) {
    const entries = readdirSync(dir);

    for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
            processDirectory(fullPath);
        } else if (extname(entry).toLowerCase() === '.html') {
            console.log(`Processing: ${fullPath}`);

            try {
                let html = readFileSync(fullPath, 'utf-8');

                // Extract subdomain from path
                const pathParts = fullPath.split(/[/\\]/);
                const samplesIndex = pathParts.indexOf('samples');
                const subdomain = samplesIndex >= 0 && pathParts[samplesIndex + 1] !== entry
                    ? pathParts[samplesIndex + 1]
                    : 'unknown';

                // Add metadata header
                html = addMetadataHeader(html, entry, subdomain);

                // Format HTML
                html = formatHtml(html);

                writeFileSync(fullPath, html, 'utf-8');
                console.log(`  ✓ Formatted: ${entry}`);
            } catch (err) {
                console.error(`  ✗ Error processing ${entry}:`, err.message);
            }
        }
    }
}

// Run
console.log('Formatting HTML samples...\n');
processDirectory(SAMPLES_DIR);
console.log('\nDone!');
