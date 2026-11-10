import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Stamp for the stylesheet and script filenames, derived from their contents.
 * The CDN caches by path and ignores the query string, so a version query is
 * not enough: the path itself has to change when the bytes do.
 */
function stampAssets() {
  const hash = createHash("sha256");
  for (const file of [
    "src/assets/brand-tokens.css",
    "src/assets/site.css",
    "src/assets/site.js",
    "src/assets/logo.svg",
    "src/assets/logo-reversed.svg",
    "src/assets/logo-icon.svg",
  ]) {
    try {
      hash.update(readFileSync(file));
    } catch {
      // A missing asset must not stop the build; the stamp just covers less.
    }
  }
  return hash.digest("hex").slice(0, 10);
}

/**
 * Single source of truth for navigation, footer links and cache-busting.
 * Editing nav or footer here updates every page on the next build.
 */
export default {
  name: "DataLeasers",
  url: "https://dataleasers.com",
  assetVersion: stampAssets(),

  // `key` is matched against a page's `navKey` front matter to set aria-current.
  nav: [
    { key: "home", href: "index.html", label: "Home" },
    { key: "data-owners", href: "data-owners.html", label: "For companies" },
    { key: "what-you-can-sell", href: "what-you-can-sell.html", label: "What you can sell" },
    { key: "how-it-works", href: "how-it-works.html", label: "How it works" },
    { key: "ai-buyers", href: "ai-buyers.html", label: "The buyer" },
    { key: "refer", href: "refer.html", label: "Refer a company" },
  ],

  footer: {
    primary: [
      { href: "data-owners.html", label: "For companies" },
      { href: "what-you-can-sell.html", label: "What you can sell" },
      { href: "how-it-works.html", label: "How it works" },
      { href: "ai-buyers.html", label: "The buyer" },
      { href: "refer.html", label: "Refer a company" },
      { href: "contact.html", label: "Tell us about your data" },
    ],
    secondary: [
      { href: "what-affects-a-deal.html", label: "What affects a deal" },
      { href: "trust.html", label: "How we handle data" },
      { href: "faq.html", label: "FAQ" },
      { href: "privacy.html", label: "Privacy" },
      { href: "consent.html", label: "Consent" },
    ],
    guides: [
      { href: "can-i-sell-my-data.html", label: "Can I sell my data?" },
      { href: "data-licensing-checklist.html", label: "Licensing checklist" },
      { href: "what-data-do-ai-teams-buy.html", label: "What AI teams buy" },
      { href: "is-my-customer-data-sellable.html", label: "Is customer data sellable?" },
    ],
  },
};
