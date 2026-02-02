import * as fs from 'node:fs';
import * as readline from 'node:readline';

const URLS_PATH = '../input/company/Urls.txt';
const SUBDOMAINS_PATH = '../input/mine/avature-net_subdomains.json';
const OUTPUT_SUBDOMAINS_PATH = '../input/mine/avature-subdomains.json';

async function extractSubdomains() {
    try {
        // 1. Reading Urls.txt by lines to reduce memory usage
        const domainsSet = new Set();

        const fileStream = fs.createReadStream(URLS_PATH);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });
        let lineCount = 0;
        for await (const urlLine of rl) {
            try {
                lineCount++;
                const parts = urlLine.split('/');
                if (parts.length > 2) {
                    const domain = parts[2];
                    domainsSet.add(domain);
                }
            } catch (e) {
                console.error(e, urlLine, `(line ${lineCount})`);
            }
        }

        // 2. Read subdomains from pentest tool file
        const pentestAvatureSubdomains = fs.readFileSync(OUTPUT_SUBDOMAINS_PATH, 'utf8');
        for (const subdomain of pentestAvatureSubdomains) {
            domainsSet.add(subdomain);
        }

        // 3. Filter for *.avature.net subdomains
        const avatureSubdomains = Array.from(domainsSet).filter(domain =>
            domain.endsWith('.avature.net')
        );

        // 4. Save to output file
        fs.writeFileSync(OUTPUT_SUBDOMAINS_PATH, JSON.stringify(avatureSubdomains, null, 2), 'utf8');

        console.log(`  ✓ found ${avatureSubdomains.length} subdomains!`);
    } catch (err) {
        console.error(`  ✗ Error processing:`, err.message);
    }
}

// Run
console.log('Extracting subdomains for *.avature.net...\n');
await extractSubdomains();
console.log('\nDone!');
