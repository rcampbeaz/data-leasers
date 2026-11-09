/**
 * Static site build for dataleasers.com.
 *
 * Source lives in src/, the built site is written to _site/ and that is the
 * only directory the deploy workflow uploads. URLs are preserved exactly as
 * they exist in production: every page keeps its .html path, and the home page
 * stays at the root.
 */
export default function (eleventyConfig) {
  // Stylesheets, scripts, logos and robots.txt are referenced by bare filename
  // from every page, so they are copied to the root of the build, not /assets/.
  eleventyConfig.addPassthroughCopy({ "src/assets": "/" });

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
