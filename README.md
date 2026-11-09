# dataleasers.com

Static marketing site for Data Leasers, LLC, built with [Eleventy](https://www.11ty.dev/) from Nunjucks templates. No client-side framework, no build server: the output is plain HTML, CSS and SVG.

## Layout

```
src/
  _data/site.js               nav links, footer links, base URL, CSS version
  _includes/layouts/base.njk  document shell: head, header, footer, scripts
  _includes/partials/         header.njk, footer.njk
  assets/                     site.css, brand-tokens.css, site.js, logos, robots.txt
  <page>.njk                  one file per page: front matter + its <main> content
  sitemap.njk                 builds sitemap.xml from the page list
design/                       design-tool .artifact.json files (never published)
_site/                        build output (gitignored) — the only thing that deploys
```

`src/assets/` is copied flat to the web root, so pages reference `site.css`, not `assets/site.css`. URLs are preserved exactly as they are in production: every page keeps its `.html` path and the home page stays at `/`.

## Commands

```bash
npm install       # once
npm run build     # writes _site/
npm run dev       # local server with live reload at http://localhost:8080
```

## Common edits

| Change | Edit |
| --- | --- |
| Page copy or markup | the page's `<main>` block in `src/<page>.njk` |
| Nav item | `nav` in `src/_data/site.js` — every page updates |
| Footer links | `footer` in `src/_data/site.js` — every page updates |
| Title, description, canonical | that page's front matter |
| Styles | `src/assets/site.css` or `brand-tokens.css`, then bump `assetVersion` in `src/_data/site.js` so browsers fetch fresh CSS |
| Sitemap | nothing — generated from the pages that build |

## Page front matter

```yaml
---
layout: layouts/base.njk
permalink: "/example.html"        # keeps the .html URL
title: "Example | dataleasers"
description: "Meta description for search and social."
canonical: "https://dataleasers.com/example.html"
navKey: contact                  # optional: highlights a nav item
bodyClass: home                  # optional: <body class="home">
inlineScript: |                  # optional: page-specific <script> blocks
---
```

`<meta property="og:*">` tags are generated from `title`, `description` and `canonical`.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy-site.yml`, which runs `npm ci && npm run build`, checks the build, rsyncs `_site/` to `public_html` over SSH, then verifies the live home page and every sitemap URL. Required repository secrets: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_USER`.

Changes to copy and CSS can go straight to `main`. New pages and renamed URLs go on a branch for review.

## Guardrails

This repository is public. Never commit API keys, `.env` files, or Mode's partner-confidential figures (screening thresholds, offer bands, approval rates, exclusivity terms).
