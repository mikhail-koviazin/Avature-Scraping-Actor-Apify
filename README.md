# Avature Job Scraper

Scrape job listings from any company using **Avature** career sites. Extract job titles, locations, salaries, descriptions, qualifications, and more from hundreds of Avature-powered career portals.

## What is Avature?

[Avature](https://www.avature.net/) is an enterprise talent acquisition platform used by major companies worldwide including Bloomberg, Deloitte, UCLA Health, Electronic Arts, and many others. This scraper works with any `*.avature.net` subdomain.

## Features

- Scrapes job listings from any Avature career site
- Extracts comprehensive job details including salary, location, department, and full descriptions
- Handles pagination automatically
- Supports multiple input methods (URLs or subdomain list)
- Flexible proxy configuration (Apify Proxies or ScraperAPI)
- Preserves full content for AI/LLM analysis

## How to use

### Option 1: Start URLs

Provide full URLs to Avature career pages:

```json
{
    "startUrls": [
        { "url": "https://bloomberg.avature.net/careers/SearchJobs" },
        { "url": "https://uclahealth.avature.net/careers/SearchJobs" }
    ]
}
```

### Option 2: Subdomains

Provide just the subdomain names (URLs are built automatically):

```json
{
    "subdomains": [
        "bloomberg.avature.net",
        "uclahealth.avature.net",
        "deloitteus.avature.net"
    ]
}
```

## Input parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startUrls` | array | - | List of Avature career page URLs to scrape |
| `subdomains` | array | - | List of Avature subdomains (e.g., `company.avature.net`) |
| `subdomainPath` | string | `/careers/SearchJobs` | URL path appended to subdomains |
| `maxRequestsPerCrawl` | integer | 1000 | Maximum pages to scrape (0 = unlimited) |
| `maxConcurrency` | integer | 10 | Maximum concurrent requests |
| `proxyType` | string | `apify` | Proxy provider: `apify`, `scraperapi`, or `none` |
| `apifyProxyGroups` | array | - | Apify proxy groups (e.g., `RESIDENTIAL`) |
| `apifyProxyCountryCode` | string | - | Country code for geo-targeting (e.g., `US`) |

## Output

Each job listing includes:

| Field | Description |
|-------|-------------|
| `url` | Direct URL to the job posting |
| `jobId` | Internal Avature job ID |
| `refNumber` | Job reference/requisition number |
| `subdomain` | Source Avature subdomain |
| `title` | Job title |
| `location` | Job location |
| `workType` | Remote, onsite, or hybrid |
| `salaryMin` / `salaryMax` | Parsed salary range |
| `salaryPeriod` | Pay period (hourly, annual, etc.) |
| `salaryRaw` | Original salary text |
| `employmentType` | Full-time, part-time, contract, etc. |
| `department` | Department or business area |
| `category` | Job category/function |
| `entity` | Company or subsidiary |
| `postedDate` | Date the job was posted |
| `description` | Job description |
| `qualifications` | Required qualifications |
| `duties` | Job responsibilities |
| `fullContent` | Complete page content for AI analysis |
| `applyUrl` | Direct application link |
| `scrapedAt` | Timestamp of scrape |

### Example output

```json
{
    "url": "https://bloomberg.avature.net/careers/JobDetail/Senior-Software-Engineer/12345",
    "jobId": "12345",
    "refNumber": "REQ-2024-001",
    "subdomain": "bloomberg.avature.net",
    "title": "Senior Software Engineer",
    "location": "New York, NY",
    "workType": "Hybrid",
    "salaryMin": 150000,
    "salaryMax": 200000,
    "salaryPeriod": "annual",
    "salaryRaw": "$150,000 - $200,000 per year",
    "employmentType": "Full-time",
    "department": "Engineering",
    "category": "Technology",
    "postedDate": "2024-01-15",
    "description": "We are looking for a Senior Software Engineer...",
    "qualifications": "5+ years of experience in...",
    "duties": "Design and implement scalable systems...",
    "applyUrl": "https://bloomberg.avature.net/careers/ApplicationMethods/12345",
    "scrapedAt": "2024-01-20T10:30:00.000Z"
}
```

## Proxy configuration

The scraper supports three proxy modes:

### Apify Proxies (default)

Uses Apify's built-in proxy infrastructure:

```json
{
    "proxyType": "apify",
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountryCode": "US"
}
```

### ScraperAPI

Uses ScraperAPI for proxy rotation:

```json
{
    "proxyType": "scraperapi",
    "scraperApiKey": "your-api-key"
}
```

### No Proxy

Direct connection (not recommended for large scrapes):

```json
{
    "proxyType": "none"
}
```

## Known Avature subdomains

Here are some known Avature career sites you can scrape:

```
genpact.avature.net
sandboxzungfu.avature.net
sandboxamspsr.avature.net
sandboxpaybackgroup.avature.net
justicejobs.avature.net
uatashfieldhealthcare.avature.net
sandboxtesco.avature.net
skanska.avature.net
tescoinsuranceandmoneyservices.avature.net
deloittecm.avature.net
amspsr.avature.net
laplanduk.avature.net
tescobank.avature.net
forms.avature.net
pomerleau.avature.net
rohde-schwarz.avature.net
sandboxashfieldhealthcare.avature.net
website.avature.net
berenberg.avature.net
lindner.avature.net
astellasjapan.avature.net
amswh.avature.net
jakala.avature.net
transcom.avature.net
cicor.avature.net
mclaren.avature.net
tesco.avature.net
www.avature.net
totalenergies.avature.net
mt.avature.net
rohdeschwarz.avature.net
deloittece.avature.net
monadelphous.avature.net
mgl.avature.net
regis.avature.net
a2milkkf.avature.net
primero.avature.net
djcshudson.avature.net
cyclecarriage.avature.net
santos.avature.net
auspost.avature.net
zungfu.avature.net
bankerslife.avature.net
voutiquededhaas2.avature.net
dfiretailgroup.avature.net
demooebbrecruiting.avature.net
jrg.avature.net
fonterrakf.avature.net
astellas.avature.net
wickes.avature.net
deloittepng.avature.net
bravura.avature.net
baloise.avature.net
enbw.avature.net
devwoolworths1.avature.net
sandboxauspost.avature.net
ea.avature.net
sandboxea.avature.net
mantech.avature.net
encompasshealth.avature.net
cchbc.avature.net
tennet.avature.net
uatauspost.avature.net
sparknz.avature.net
maximus.avature.net
bmcrecruit.avature.net
fmlogistic.avature.net
nva.avature.net
tkdemoger.avature.net
demorossmann.avature.net
frequentis.avature.net
crmdacheng.avature.net
demooebb1.avature.net
demoaudi2.avature.net
manpowergroupco.avature.net
ino.avature.net
healthfirst.avature.net
bloomberg.avature.net
radpartners.avature.net
aesc.avature.net
ecb.avature.net
workmyway.avature.net
mastereh.avature.net
voutiquetraining.avature.net
mercadona.avature.net
coeint.avature.net
vanoord.avature.net
infor.avature.net
sandboxlenovo.avature.net
loa.avature.net
sandboxbnc.avature.net
ciusss.avature.net
ally.avature.net
westrockta.avature.net
sandboxhenrico.avature.net
sandboxhealthfirst.avature.net
boozallen.avature.net
insperity.avature.net
ibmsandbox1.avature.net
intercaretherapy.avature.net
uclahealth.avature.net
sandboxally.avature.net
steelcase.avature.net
rgp.avature.net
jackhenry.avature.net
sandboxinsperity.avature.net
bnc.avature.net
onecall.avature.net
dosist.avature.net
amerilife.avature.net
sandboxboozallen.avature.net
synopsys.avature.net
sandboxwcg.avature.net
gpshospitality.avature.net
wcg.avature.net
cdcn.avature.net
mhcta.avature.net
deloitteus.avature.net
advocateaurorahealth.avature.net
sandboxino1.avature.net
lululemoninc.avature.net
tsmc.avature.net
```

## Integrations

Connect this scraper with other tools:

- **Google Sheets** - Export results directly to spreadsheets
- **Slack** - Get notifications when new jobs are found
- **Zapier / Make** - Automate workflows with scraped data
- **APIs** - Access data programmatically via Apify API

## Tips for best results

1. **Start small** - Test with one subdomain before scaling up
2. **Use residential proxies** - Some sites block datacenter IPs
3. **Respect rate limits** - Use reasonable concurrency (5-10)
4. **Monitor for errors** - Enable `saveErrorSamples` for debugging

## Limitations

- Internal/employee-only portals may require authentication
- Rate limiting may occur with high concurrency

## Support & Contact

Please visit my profile on Apify ([Mikhail Koviazin](https://apify.com/mikhail.koviazin))
to check other scrapers made by me.
If you are looking for a custom scraping solution for Avature or any other website,
feel free to [contact me](https://apify.com/mikhail.koviazin).

Got a problem with **Avature Jobs Scraper**? Don't hesitate to reach me for support [here](https://apify.com/mikhail.koviazin).
