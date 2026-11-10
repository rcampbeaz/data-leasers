/**
 * Who stands behind the guides.
 *
 * `bio` is not rendered yet: it is waiting for the about page, which is built
 * once the wording is confirmed. `url` stays empty until the profile it points
 * at describes this company, so a reader who clicks it does not land somewhere
 * contradictory. Filling either one in is enough to update the byline, the
 * Person node and every guide at once.
 */
export default {
  enabled: true,
  name: "Rod Campbell",
  role: "Founder",
  bio: "Rod Campbell founded DataLeasers, which introduces operating companies to the data buyers that license company records for AI. He works with sellers from the first call, and he sets the rule this site follows: every figure is dated, and every figure is attributed to the page it came from.",
  url: "",
  photo: "",
  location: "Arizona, United States",
};
