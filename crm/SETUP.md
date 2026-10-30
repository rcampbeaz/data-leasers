G# dataleasers CRM: set-up

Region: **US**. Personal data is stored in the US.
Sign-in: magic link by email, then a required authenticator-app code (TOTP). Self-signup is off.

## 1. Create the Supabase project
1. Create a project, region **US East** (or closest US region).
2. Save the database password in your password manager.

## 2. Configure authentication
1. **Authentication > Providers > Email**: enabled. Keep the magic link option on.
2. **Authentication > Sign In / Up**: turn off "Allow new users to sign up".
3. **Authentication > Multi-Factor**: enable TOTP (authenticator app).
4. **Authentication > URL Configuration**:
   - Site URL: `https://app.dataleasers.com`
   - Redirect URLs: `https://app.dataleasers.com/auth/callback`

Menu labels change between Supabase releases. Match the settings by name if they have moved.

## 3. Create the database tables
1. Open **SQL Editor**, paste the contents of `supabase/migrations/0001_init.sql`, and run it.

## 4. Create your admin account
Sign-up is off, so the account must exist before you can sign in.
1. **Authentication > Users > Add user**, enter your work email. Do not set a password.
2. In **SQL Editor**, run this with your own email and name:

```sql
insert into public.crm_staff (user_id, full_name, role)
select id, 'Your Name', 'admin'
from auth.users
where email = 'you@example.com';
```

## 5. Environment file (on the VPS only)
1. Copy `.env.example` to `.env`.
2. Fill in the project URL, the anon key, and the service role key from **Project Settings > API**.
3. Do not paste keys into chat, email, or Git.

## 6. First sign-in
1. Open `https://app.dataleasers.com/login` and enter your email.
2. Open the sign-in link from your email. You are taken to the two-factor set-up.
3. Scan the QR code with your authenticator app and enter the code.

## Reminder emails (Resend)
1. In Resend, add the domain `dataleasers.com` and add the DNS records it gives you. Wait until it shows verified.
2. Create an API key in Resend and put it in `.env` as `RESEND_API_KEY`.
3. Set `REMINDER_FROM_EMAIL` to an address on that domain, and `CRON_SECRET` to a long random value.
4. On the VPS, schedule a daily run (8:00 server time), for example in cron:

```
0 8 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.dataleasers.com/api/reminders
```

Use the same secret in the cron entry as in `.env`. Each task is emailed once. Tasks with no assignee go to admins.
Reminders cover tasks only. Next-action dates on a company are shown in the CRM but are not emailed yet.

## Recovery
- **Lost phone or authenticator app:** in **Authentication > Users**, open your user and remove the MFA factor. Sign in again to re-enrol. Keep a second device enrolled if you can.
- **Locked out of the staff list:** run the SQL in step 4 again with the correct email, using the SQL Editor (this bypasses the app).
