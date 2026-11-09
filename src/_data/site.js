/**
 * Single source of truth for navigation, footer links and cache-busting.
 * Editing nav or footer here updates every page on the next build.
 */
export default {
  name: "dataleasers",
  url: "https://dataleasers.com",
  // Bump when site.css or brand-tokens.css changes so browsers fetch fresh CSS.
  assetVersion: "10",

  // `key` is matched against a page's `navKey` front matter to set aria-current.
  nav: [
    { key: "home", href: "index.html", label: "Home" },
    { key: "data-owners", href: "data-owners.html", label: "For companies" },
    { key: "what-you-can-sell", href: "what-you-can-sell.html", label: "What you can sell" },
    { key: "how-it-works", href: "how-it-works.html", label: "How it works" },
    { key: "ai-buyers", href: "ai-buyers.html", label: "The buyer" },
    { key: "refer", href: "refer.html", label: "Refer a company" },
    { key: "contact", href: "contact.html", label: "Book a call" },
  ],

  footer: {
    primary: [
      { href: "data-owners.html", label: "For companies" },
      { href: "what-you-can-sell.html", label: "What you can sell" },
      { href: "how-it-works.html", label: "How it works" },
      { href: "ai-buyers.html", label: "The buyer" },
      { href: "refer.html", label: "Refer a company" },
      { href: "contact.html", label: "Book a call" },
    ],
    secondary: [
      { href: "what-affects-a-deal.html", label: "What affects a deal" },
      { href: "trust.html", label: "How we handle data" },
      { href: "faq.html", label: "FAQ" },
      { href: "privacy.html", label: "Privacy" },
      { href: "consent.html", label: "Consent" },
    ],
  },
};
