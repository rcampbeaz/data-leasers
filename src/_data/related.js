/**
 * Related-page lists used by partials/related.njk.
 *
 * `dataTypes` and `guides` are the fallback set for pages that do not declare
 * their own list. Pages that do declare `relatedHrefs` in front matter get a
 * short, contextual list instead: dumping the same ten links on every page
 * repeated the same blurbs site-wide and told a reader nothing about where
 * they were.
 */
const dataTypes = [
  { href: "conversations.html", label: "Conversations", blurb: "Chat, call and shared inbox records." },
  { href: "customer-support.html", label: "Customer support", blurb: "Resolved tickets, notes and escalations." },
  { href: "documents.html", label: "Documents", blurb: "Playbooks, proposals and revision history." },
  { href: "code-and-engineering.html", label: "Code and engineering", blurb: "Pull requests, reviews and test history." },
  { href: "sales-and-crm.html", label: "Sales and CRM", blurb: "Deal history and won or lost reasons." },
  { href: "operations.html", label: "Operations", blurb: "Project boards, handoffs and approvals." },
];

const guides = [
  { href: "can-i-sell-my-data.html", label: "Can I sell my company's data?", blurb: "The documents that decide it." },
  { href: "data-licensing-checklist.html", label: "Data licensing checklist", blurb: "What to gather before a first call." },
  { href: "what-data-do-ai-teams-buy.html", label: "What data do AI teams buy?", blurb: "What makes records useful, and what is not." },
  { href: "is-my-customer-data-sellable.html", label: "Is my customer data sellable?", blurb: "Contracts, personal data and tool terms." },
];

/** Pages a guide can point back to without repeating the whole nav. */
const more = [
  { href: "rights-file.html", label: "The rights file", blurb: "The twelve fields a buyer's diligence turns on." },
  { href: "what-you-can-sell.html", label: "What you can sell", blurb: "The six categories of records AI teams license." },
  { href: "what-affects-a-deal.html", label: "What affects a deal", blurb: "Exclusivity, deletion, audit and payment terms." },
  { href: "who-buys.html", label: "Who buys company data", blurb: "The kinds of AI team that pay for it." },
  { href: "market.html", label: "What AI data sells for", blurb: "Published deals and per-unit rates." },
  { href: "trust.html", label: "How we handle your data", blurb: "What stays in your systems, and what gets reviewed." },
  { href: "how-it-works.html", label: "How it works", blurb: "The stages of a deal and what slows each one." },
  { href: "industries.html", label: "Industries", blurb: "What to check first in each sector." },
];

const lookup = {};
for (const item of [...dataTypes, ...guides, ...more]) lookup[item.href] = item;

export default { dataTypes, guides, lookup };
