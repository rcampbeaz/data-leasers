/**
 * Static site build for dataleasers.com.
 *
 * Source lives in src/, the built site is written to _site/ and that is the
 * only directory the deploy workflow uploads. URLs are preserved exactly as
 * they exist in production: every page keeps its .html path, and the home page
 * stays at the root.
 */
import fs from "node:fs";
import path from "node:path";
import site from "./src/_data/site.js";

export default function (eleventyConfig) {
  // Stylesheets, scripts, logos and robots.txt are referenced by bare filename
  // from every page, so they are copied to the root of the build, not /assets/.
  eleventyConfig.addPassthroughCopy({ "src/assets": "/" });

  // The CDN in front of the site caches by path and ignores the query string, so
  // "site.css?v=12" and "site.css?v=13" are the same cache entry and a deploy can
  // keep serving the old stylesheet. Writing the CSS and JS under a content-stamped
  // name as well means the URL changes exactly when the bytes do.
  eleventyConfig.on("eleventy.after", ({ dir }) => {
    const out = (dir && dir.output) || "_site";
    const stamped = [
      ["brand-tokens.css", `brand-tokens.${site.assetVersion}.css`],
      ["site.css", `site.${site.assetVersion}.css`],
      ["site.js", `site.${site.assetVersion}.js`],
    ];
    for (const [from, to] of stamped) {
      const source = path.join(out, from);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(out, to));
    }
  });

  // Only real pages belong in the sitemap: the home page first, then
  // alphabetical, matching the order the hand-written sitemap used.
  eleventyConfig.addFilter("sitemapPages", (items = []) =>
    items
      .filter((item) => item.data && item.data.sitemap !== false)
      .filter((item) => item.url === "/" || item.url.endsWith(".html"))
      .sort((a, b) => {
        if (a.url === "/") return -1;
        if (b.url === "/") return 1;
        return a.url.localeCompare(b.url, "en");
      })
  );

  // Emit FAQPage structured data from the questions a page actually shows, so the
  // markup can never drift from the visible copy.
  const decode = (html) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&mdash;/g, "\u2014")
      .replace(/&ndash;/g, "\u2013")
      .replace(/&rsquo;/g, "\u2019")
      .replace(/&lsquo;/g, "\u2018")
      .replace(/&ldquo;/g, "\u201c")
      .replace(/&rdquo;/g, "\u201d")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();

  eleventyConfig.addTransform("faq-schema", function (content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html") || !content.includes("<details>")) return content;
    const items = [...content.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)]
      .map((m) => ({
        "@type": "Question",
        name: decode(m[1]),
        acceptedAnswer: { "@type": "Answer", text: decode(m[2]) },
      }))
      .filter((q) => q.name && q.acceptedAnswer.text);
    if (!items.length) return content;
    const json = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: items,
    }).replace(/</g, "\\u003c");
    return content.replace("</head>", '<script type="application/ld+json">' + json + "</script>\n</head>");
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
}
