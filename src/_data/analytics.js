/**
 * Measurement hooks. Nothing is sent anywhere until a provider is configured:
 * set provider to "ga4" or "plausible" and fill in the id, then the loader in
 * base.njk will include the tag. Conversion events are pushed to
 * window.dataLayer either way, so a tag manager can pick them up later.
 */
export default {
  provider: "",
  id: "",
  searchConsoleVerification: "",
};
