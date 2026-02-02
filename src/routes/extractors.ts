import type { CheerioCrawlingContext } from '@crawlee/cheerio';

/**
 * Comprehensive field extraction helper
 * Searches for field values using multiple possible label variations
 */
export function createFieldExtractor($: CheerioCrawlingContext['$']) {
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
export function parseDate(dateStr: string | null): string | null {
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
export function parseSalary(salaryStr: string | null): { min: string | null; max: string | null; raw: string | null; period: string | null } {
    const result = { min: null as string | null, max: null as string | null, raw: salaryStr, period: null as string | null };
    if (!salaryStr) return result;

    // Detect period (hourly, annual, etc.)
    const lowerSalary = salaryStr.toLowerCase();
    if (lowerSalary.includes('hour')) result.period = 'hourly';
    else if (lowerSalary.includes('year') || lowerSalary.includes('annual')) result.period = 'yearly';
    else if (lowerSalary.includes('month')) result.period = 'monthly';
    else if (lowerSalary.includes('week')) result.period = 'weekly';

    // Range: $XX.XX - $YY.YY or $XX,XXX - $YY,YYY (supports 1+ decimal places)
    const rangeMatch = salaryStr.match(/\$?([\d,]+(?:\.\d+)?)\s*[-–to]+\s*\$?([\d,]+(?:\.\d+)?)/i);
    if (rangeMatch) {
        result.min = rangeMatch[1].replace(/,/g, '');
        result.max = rangeMatch[2].replace(/,/g, '');
        return result;
    }

    // Single value: $XX.XX (supports 1+ decimal places)
    const singleMatch = salaryStr.match(/\$?([\d,]+(?:\.\d+)?)/);
    if (singleMatch) {
        result.min = singleMatch[1].replace(/,/g, '');
        result.max = result.min;
    }

    return result;
}
