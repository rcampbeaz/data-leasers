# Social accounts: set-up steps for DataLeasers

Companion to `docs/social-console-spec.md`. This is the account work, in order, for one brand on
Facebook, Instagram, LinkedIn and TikTok, publishing through bundle.social as the provider.

Labels move between releases on all four platforms. Match settings by name rather than by
position, and if something is not where this says, search the settings page for the term before
assuming it has been removed.

---

## What you do **not** need while using the aggregator

This is the main practical reason the aggregator route was chosen, so it is worth being explicit:

- **No Meta developer app**, no App Review, no `instagram_content_publish` permission request.
  bundle.social holds the Meta app; you authorise it through their hosted flow.
- **No LinkedIn Community Management application.** The partner programme, the verified-Page
  prerequisite and the demo requirement all sit with the provider.
- **No TikTok audit.** The provider's client is audited, so posts go out publicly instead of
  being stuck at `SELF_ONLY`.

You still create and own the **brand accounts** themselves. That is the part nobody can do for
you, and it is most of this document.

---

## Before you start

Have these ready, because two of the steps pause waiting for them:

1. **A work email on `dataleasers.com`.** Each network account should be created with it, not a
   personal address. If you already have a personal account you want to keep using as the human
   behind the Page, that is fine for Facebook and LinkedIn — the *Page* is what gets posted to,
   and the Page must be owned by the business.
2. **Two-factor on all four accounts**, and a second admin on the Facebook Page and the LinkedIn
   Page. A lost phone should not lock the brand out of its own accounts.
3. **A password manager entry per account**, including which email address owns it.
4. **Business verification details**: legal entity name, registration number, and a document
   showing the business name and address. Facebook/Meta and LinkedIn may ask; TikTok may ask
   later if you ever go direct.
5. **Brand assets in one folder**: square logo at 400×400 or larger (avatar), a 16:9 banner for
   Facebook and LinkedIn, a 1080×1920 vertical image for TikTok, and one-paragraph bio text.
6. **One handle, claimed everywhere.** Decide now whether it is `dataleasers` or something else,
   and take it on all four even if you will not use one of them yet. A handle taken by someone
   else later is not recoverable.

---

## Step 1: Facebook Page

1. Go to `facebook.com/pages/create` while signed in to the personal profile that will administer
   it. Choose **Business or brand**, name it **DataLeasers**, category something accurate such as
   *Business consultant* or *Data analytics service* — do not pick a category that claims
   something the business does not do.
2. Upload the avatar and banner, and fill **About** with the same one-paragraph description used
   on the site. Add the website `dataleasers.com`.
3. **Business Manager**: create or open `business.facebook.com`, then add the Page to it as an
   asset (Business settings → Accounts → Pages → Add). This is what makes the Page a business
   asset rather than something tied to one personal profile.
4. **Add a second admin** to both the Page and Business Manager (Business settings → People).
5. **Business verification** (Business settings → Security Centre, or Business info): start it
   now. It is the longest wait in this whole document and can block later permissions. It needs
   the legal entity name, address and a document that matches.
6. Complete **Page Publishing Authorization** if Meta presents it. Publishing to a linked
   Instagram account fails until it is done, and the failure is not obvious.

**Check:** the Page is visible at `facebook.com/<handle>` while signed out, and Business Manager
lists it under Pages.

## Step 2: Instagram

1. Convert the account to **Professional**: Instagram app → Settings → Account type and tools →
   Switch to professional account. **Business** is right for a company; Creator is for
   individuals.
2. **Link it to the Facebook Page**: Settings → Account type and tools → Sharing to other apps,
   or from the Page's settings under Linked accounts. The link is what allows publishing through
   the Facebook-Login route the provider uses.
3. Fill the profile: same avatar, the same one-paragraph bio, and the link.
4. Complete any Page Publishing Authorization prompt from step 1.6.
5. Note whether the account is already following the "business" onboarding prompts for a contact
   email — set it to the work address.

**Check:** Instagram shows *Professional dashboard* in settings, and the Facebook Page lists the
Instagram account as connected.

## Step 3: LinkedIn Page

1. Create the company Page at `linkedin.com/company/setup/new` from your personal profile, with
   the legal or trading name **DataLeasers**, the website, industry and company size. Use the
   same logo and description.
2. **Verify the Page** (Page admin view → Settings → Verification, or `business.linkedin.com` →
   verify). Verification usually needs either a work email on the `dataleasers.com` domain or a
   DNS TXT record on the domain. Both are worth doing: the TXT route survives staff changes.
3. Add a second admin: Page admin view → Admin tools → Manage admins.
4. **Personal profile posting** is in scope, but deferred to the account review you mentioned.
   When we do it, the connection is to your member profile under `w_member_social` — the lighter
   permission that needs no partner programme — and the console must show clearly which identity
   a post will go out as, because posting as a person and posting as the Page look identical in a
   queue otherwise.

**Check:** the Page is public, verification is requested or complete, and there are two admins.

## Step 4: TikTok

1. Create the account with the work email. Claim the `@dataleasers` handle.
2. **Switch to a Business account**: `tiktok.com/business` → create/convert, or in the app under
   Settings → Account → Switch to Business account. Business accounts get the analytics and the
   contact button, and avoid the commercial-music restrictions that bite brand accounts later.
3. Fill the profile: avatar, bio in the same voice, and the website link.
4. Note the account's privacy setting. It must be public for anything to be visible, and the
   provider's posting flow will offer the privacy options the account actually permits.

**Check:** the profile is public, shows as a Business account, and the handle is the one you want.

## Step 5: bundle.social

1. Sign up at `bundle.social` with the work email. Create the **organization**, then a **team**
   (one team is enough — a team is just the container the connected accounts sit in).
2. Go to **Social Accounts** and use **Connect** for each platform, authorising as the account
   owner. Facebook and LinkedIn will ask *which* Page or profile to grant — pick the DataLeasers
   Page, not a personal profile, except for the LinkedIn member connection we are deferring.
3. Confirm all connections show as active, with the right account name and avatar.
4. Go to **API keys**, create one named `dataleasers-console`, and copy it once. Do not paste it
   into chat, email or a commit — put it in the server's `.env` as `SOCIAL_API_KEY`, the same
   place the Supabase keys live.

**Free-tier limits, so there are no surprises:** 20 posts a month and **3 connected accounts**.
You have four channels, and a cross-post to four counts as four posts. Two options:

- start free with three channels while the console is built, then take the 14-day paid trial when
  the fourth goes on; or
- take the trial immediately, connect all four, and decide on Pro ($100/mo) at the end.

Either way the console should be built against the API, not the dashboard, so the tier can change
without changing code.

**Check:** the provider lists four connected accounts, and the console can read them with the key.

---

## What I need back from you

When each step is done, tell me:

- which handle each account ended up with (in case one was taken);
- whether the LinkedIn Page is verified, and whether you want the personal profile connected now
  or at the account review;
- that the API key is in the server `.env` — **the name of the variable only, never the value**.

Then I can wire the channel list, the composer and the calendar against the real accounts.

---

## Order and realistic timing

| Step | Hands-on time | Waiting on |
| --- | --- | --- |
| 1. Facebook Page | 30 min | Business verification: days |
| 2. Instagram | 10 min | Linked Page from step 1 |
| 3. LinkedIn Page | 20 min | Verification: hours to days |
| 4. TikTok | 15 min | Nothing |
| 5. bundle.social | 20 min | Steps 1–4 connected |

Steps 1, 3 and 4 can be done in any order and in one sitting. Do not start step 5 until the
accounts exist and are public, because authorising an account that is still in review produces a
connection that looks fine and fails at the first post.

## The five things that go wrong

1. **Instagram left on a personal account.** It connects, then publishing fails with a permission
   error that reads like the provider's fault.
2. **Page Publishing Authorization skipped.** The same symptom, on the Facebook side.
3. **A Page owned by a personal profile only.** When that profile is lost, the Page is lost. Put
   it in Business Manager and add a second admin.
4. **Connecting the wrong identity.** Facebook and LinkedIn both offer a personal profile in the
   picker; choosing it means posting as you, not as the brand.
5. **Free-tier arithmetic.** 20 posts a month and 3 accounts is smaller than it sounds once a
   post goes to four channels.

---

## If we later move Facebook and Instagram to direct

Only then do the heavier approvals appear, and only for that pair:

1. Meta developer app, type Business, with Facebook Login for Business and Instagram products.
2. Permissions `pages_manage_posts`, `pages_read_engagement`, `instagram_content_publish`,
   `instagram_basic`. Standard Access covers accounts you own, so no App Review — but Business
   Verification must be complete.
3. OAuth from the console, storing the Page token server-side, and a refresh job, because Page
   tokens expire.
4. Domain verification for the media URL the Instagram endpoint fetches from.

LinkedIn's Community Management application and TikTok's audit only become necessary if the
aggregator is dropped for those channels too. Neither is on the critical path now.
