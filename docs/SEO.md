# Website search and AI discovery

Trace's public site is https://gettrace.pages.dev/. The website uses static HTML so product facts, guide answers and links are available without client-side rendering. The SEO/GEO work follows the useful audit areas in [geo-seo-claude](https://github.com/zubair-trabzada/geo-seo-claude); that package and its installers are not dependencies of Trace.

## Implemented foundations

- Explicit homepage heading and description identifying Trace as a free Windows mouse activity tracker.
- Application metadata describing the actual Windows x64 beta, zero price, current version, download URL and source repository. No invented ratings, reviews, adoption statistics or unsupported platforms.
- Unique titles, descriptions, canonical URLs, breadcrumbs and social metadata on the guide pages.
- Static, internally linked guides for installation, cursor-distance units, heatmaps and local data privacy.
- Open Graph and Twitter large-image metadata with a 1200 by 630 PNG preview. The image is labeled as an interface illustration with sample data, not a customer result or native screenshot.
- A sitemap containing all five public HTML pages. The custom 404 remains excluded and marked `noindex`.
- Existing permissive `robots.txt`; no extra AI files or crawler impersonation are required. A permissive file does not prove that every crawler can reach or index the live site.

Content lives in `website/index.html` and `website/guides.mjs`. The packager renders guides into standalone HTML using `scripts/build-site-guides.mjs`; it does not publish the guide source module. Build with `npm run site:build`. The installer is still verified against its pinned checksum.

The preview's editable source is `website/social-preview.svg`. After changing it, run `npm run site:preview-image` with the existing Playwright Chromium installation, then rebuild. The checked-in PNG means deployment does not require a browser.

## Search Console: account-owner setup

1. Sign in to [Google Search Console](https://search.google.com/search-console/) and select or add a URL-prefix property for `https://gettrace.pages.dev/`.
2. Complete ownership verification. For HTML-tag verification, add the exact public verification meta tag Google supplies to the homepage head, then rebuild and redeploy. Do not add account passwords or access tokens to source.
3. Submit `https://gettrace.pages.dev/sitemap.xml` in the Sitemaps section.
4. Inspect the homepage and guide URLs with URL Inspection. Request indexing where appropriate, then check indexing errors and the Performance report over time.

The homepage retains Google's public HTML verification tag for the owner's URL-prefix property. Keep this tag in future deployments so Google can recheck ownership. Verification and sitemap submission require the owner's Google account; check Search Console for their current status. Publishing a sitemap does not establish that Google indexed the site or that it will rank. The verification tag is not an analytics script and does not collect website visits or desktop activity.

## Measurement and limits

Use Search Console to monitor impressions, clicks and relevant queries. Measure website visits and installer-download requests separately if website analytics is later configured. Neither download requests nor a GEO audit score establish unique installations, retention or active users. This work adds no analytics beacon, cookies, app telemetry or email outreach.

The application metadata is factual schema.org data. Google's software-app rich results have additional eligibility requirements, including genuine rating/review information; do not invent reviews to satisfy a validator. No rich-result eligibility is claimed for this beta.

Prioritize clear answers, accurate product information, useful screenshots or illustrations, real release notes and independent reviews. Avoid filler pages, keyword stuffing, fabricated testimonials and changing paragraph lengths just to raise a third-party score. `llms.txt` is not included: Google says no special AI text files or schema are needed for its AI search features.

## Release checks

After `npm run site:build`, check all five sitemap URLs, one H1 per page, unique canonical/title/description, parseable JSON-LD, internal links and fragment targets, mobile menus and layouts, preview-image dimensions, custom HTTP 404 and the installer checksum. After deploying, repeat the HTTP and metadata checks on the live site, including a direct deep link to each guide.

Reference: [Google AI search guidance](https://developers.google.com/search/docs/appearance/ai-features), [software application structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app), and [sitemap submission](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
