#!/usr/bin/env npx tsx
/**
 * Analyze cheerio-scraper dataset to validate subdomains
 *
 * Usage: npx tsx scripts/analyze-dataset.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface DatasetEntry {
    url: string;
    title: string;
    h1: string;
    article: string;
}

type Status = 'valid' | 'not_valid' | 'js_required';

interface Result {
    domain: string;
    url: string;
    status: Status;
}

function extractDomain(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return url;
    }
}

function analyzeEntry(entry: DatasetEntry): Status {
    // Check for JavaScript required
    if (entry.h1.includes('JavaScript is disabled')) {
        return 'js_required';
    }

    // Check if article has content
    const articleContent = entry.article.trim();
    if (articleContent.length > 0) {
        return 'valid';
    }

    return 'not_valid';
}

function generateCsv(results: Result[]): string {
    const headers = ['domain', 'url', 'status'];

    const escapeCsv = (val: string) => {
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
            return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
    };

    const rows = [headers.join(',')];
    for (const r of results) {
        rows.push([r.domain, r.url, r.status].map(escapeCsv).join(','));
    }

    return rows.join('\n');
}

async function main() {
    console.log('═'.repeat(60));
    console.log('  DATASET ANALYZER');
    console.log('═'.repeat(60));

    // Load dataset
    const inputPath = join(process.cwd(), 'input', 'mine', 'dataset_cheerio-scraper_2026-02-02_16-49-09-521 (1).json');
    console.log(`\nInput: ${inputPath}`);

    let dataset: DatasetEntry[];
    try {
        dataset = JSON.parse(readFileSync(inputPath, 'utf-8'));
    } catch (err) {
        console.error(`Failed to load: ${err}`);
        process.exit(1);
    }

    console.log(`Total entries: ${dataset.length}`);

    // Analyze each entry
    const results: Result[] = dataset.map(entry => ({
        domain: extractDomain(entry.url),
        url: entry.url,
        status: analyzeEntry(entry),
    }));

    // Summary
    const summary = {
        valid: results.filter(r => r.status === 'valid').length,
        not_valid: results.filter(r => r.status === 'not_valid').length,
        js_required: results.filter(r => r.status === 'js_required').length,
    };

    console.log('\n' + '═'.repeat(60));
    console.log('  SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Valid:       ${summary.valid}`);
    console.log(`  Not Valid:   ${summary.not_valid}`);
    console.log(`  JS Required: ${summary.js_required}`);

    // Create output directory
    const outputDir = join(process.cwd(), 'output');
    mkdirSync(outputDir, { recursive: true });

    // Sort: valid first, then js_required, then not_valid
    const sortedResults = [...results].sort((a, b) => {
        const order: Record<Status, number> = { valid: 0, js_required: 1, not_valid: 2 };
        return order[a.status] - order[b.status];
    });

    // Save CSV
    const csvPath = join(outputDir, 'dataset-analysis.csv');
    writeFileSync(csvPath, generateCsv(sortedResults), 'utf-8');
    console.log(`\nCSV saved: ${csvPath}`);

    // Save valid domains JSON
    const validDomains = results
        .filter(r => r.status === 'valid')
        .map(r => r.domain);

    const validJsonPath = join(outputDir, 'valid-domains.json');
    writeFileSync(validJsonPath, JSON.stringify(validDomains, null, 2), 'utf-8');
    console.log(`Valid domains JSON saved: ${validJsonPath}`);

    // Save JS-required domains JSON
    const jsDomains = results
        .filter(r => r.status === 'js_required')
        .map(r => r.domain);

    const jsJsonPath = join(outputDir, 'js-required-domains.json');
    writeFileSync(jsJsonPath, JSON.stringify(jsDomains, null, 2), 'utf-8');
    console.log(`JS-required domains JSON saved: ${jsJsonPath}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
