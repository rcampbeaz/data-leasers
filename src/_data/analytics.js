/**
 * Measurement hooks. Nothing is sent anywhere until a provider is configured:
 * set provider and id, then the loader in base.njk will include the tag.
 * Conversion events are pushed to window.dataLayer either way, so a tag
 * manager can pick them up later.
 *
 * provider: "cloudflare"  cookieless, no consent banner, works on any host.
 *            Paste the token from Cloudflare > Web analytics > Manage site.
 *            id: "plausible"    plausible.io script, id is the domain.
 *            id: "ga4"          Measurement ID (G-XXXXXXX). Sets cookies, so
 *                               it needs a consent banner in the EU and UK.
 */
export default {
  provider: "",
  id: "",
  searchConsoleVerification: "",
  bingVerification: "",
};
