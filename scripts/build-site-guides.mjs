import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { guides } from "../website/guides.mjs";

const origin = "https://gettrace.pages.dev";
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const json = (value) =>
  JSON.stringify(value, null, 2).replaceAll("<", "\\u003c");
const cards = () =>
  guides
    .map(
      (guide) =>
        `<a class="guide-card" href="/guides/${guide.slug}/"><h3>${escape(guide.title)}</h3><p>${escape(guide.description)}</p><span>Read guide →</span></a>`,
    )
    .join("\n");

function page({ title, description, path, body, index = false }) {
  const url = origin + path;
  const breadcrumb = [
    { "@type": "ListItem", position: 1, name: "Trace", item: origin + "/" },
    {
      "@type": "ListItem",
      position: 2,
      name: "Guides",
      item: origin + "/guides/",
    },
  ];
  if (!index)
    breadcrumb.push({
      "@type": "ListItem",
      position: 3,
      name: title,
      item: url,
    });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escape(title)} | Trace</title>
  <meta name="description" content="${escape(description)}" />
  <meta name="theme-color" content="#11140f" />
  <link rel="canonical" href="${url}" />
  <link rel="icon" type="image/svg+xml" href="/trace.svg" />
  <link rel="stylesheet" href="/style.css" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Trace" />
  <meta property="og:title" content="${escape(title)} | Trace" />
  <meta property="og:description" content="${escape(description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${origin}/social-preview.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Trace dashboard and Trace Bar illustration with sample data." />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escape(title)} | Trace" />
  <meta name="twitter:description" content="${escape(description)}" />
  <meta name="twitter:image" content="${origin}/social-preview.png" />
  <meta name="twitter:image:alt" content="Trace dashboard and Trace Bar illustration with sample data." />
  <script type="application/ld+json">${json({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": index ? "CollectionPage" : "WebPage",
        "@id": url,
        url,
        name: title,
        description,
        inLanguage: "en",
        isPartOf: { "@id": origin + "/#website" },
        about: { "@id": origin + "/#app" },
      },
      { "@type": "BreadcrumbList", itemListElement: breadcrumb },
    ],
  })}</script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="wrap header">
    <a class="brand" href="/" aria-label="Trace home"><img src="/trace.svg" width="34" height="34" alt="" /><span>trace</span></a>
    <nav class="desktop-nav" aria-label="Main navigation"><a href="/#experience">The experience</a><a href="/#privacy">Privacy</a><a href="/guides/"${index ? ' aria-current="page"' : ""}>Guides</a></nav>
    <a class="button small" href="/#download">Get Trace free <span aria-hidden="true">↗</span></a>
    <details class="mobile-nav"><summary>Menu</summary><nav aria-label="Mobile navigation"><a href="/#experience">The experience</a><a href="/#privacy">Privacy</a><a href="/guides/"${index ? ' aria-current="page"' : ""}>Guides</a></nav></details>
  </header>
  <main class="wrap guide-main" id="main">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Trace</a><span aria-hidden="true">/</span>${index ? '<span aria-current="page">Guides</span>' : `<a href="/guides/">Guides</a><span aria-hidden="true">/</span><span aria-current="page">${escape(title)}</span>`}</nav>
    ${body}
  </main>
  <footer class="wrap"><a class="brand" href="/" aria-label="Trace home"><img src="/trace.svg" width="26" height="26" alt="" /><span>trace</span></a><p>© <span id="year">2026</span> Trace · Free Windows beta</p><nav aria-label="Footer"><a href="/guides/">Guides</a><a href="/#privacy">Privacy</a><a href="https://github.com/VanshKaushal/Tracer.FUN/issues">Support</a><a href="https://github.com/VanshKaushal/Tracer.FUN/tree/feat/trace-bar-hover-focus">Source</a></nav></footer>
  <script src="/site.js" defer></script>
</body>
</html>`;
}

export function buildGuides(output) {
  const directory = resolve(output, "guides");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, "index.html"),
    page({
      title: "Trace guides for Windows",
      description:
        "Learn how to install Trace, measure cursor distance and understand heatmaps, local history and privacy in the free Windows beta.",
      path: "/guides/",
      index: true,
      body: `<section class="guide-index"><p class="eyebrow">PRACTICAL HELP, IN PLAIN WORDS</p><h1>Get to know Trace.</h1><p class="lede">Start with setup, understand your cursor distance, and stay in control of your local activity history.</p><div class="guide-grid">${cards()}</div></section>`,
    }),
  );
  for (const guide of guides) {
    const target = resolve(directory, guide.slug);
    mkdirSync(target, { recursive: true });
    writeFileSync(
      resolve(target, "index.html"),
      page({
        ...guide,
        path: `/guides/${guide.slug}/`,
        body: `<article class="guide-article"><p class="eyebrow">TRACE WINDOWS BETA · USER GUIDE</p><h1>${escape(guide.title)}</h1><p class="lede">${escape(guide.summary)}</p><div class="guide-body">${guide.body}<h2>Ready to try Trace?</h2><p>All current features are free. The download page explains supported PCs and the unsigned beta's limitations.</p><a class="button" href="/#download">Get the Windows beta <span aria-hidden="true">↓</span></a><p class="caption">More help: <a href="/guides/">all Trace guides</a>.</p></div></article>`,
      }),
    );
  }
}
