# Deploying dataleasers.com

Two things deploy from this repo, independently. Push to `main` and GitHub Actions
ships it; nothing is uploaded by hand.

| What | Source | Goes to | Workflow |
| --- | --- | --- | --- |
| Website (static HTML) | `site/` | `/home/dataleasers/public_html/` | `.github/workflows/deploy-site.yml` |
| CRM (Next.js) | `crm/` | `/home/dataleasers/domains/app.dataleasers.com/crm/` | `.github/workflows/deploy-crm.yml` |

Each workflow only runs when its own folder changes, so a CRM commit never
touches the website, and a copy change never rebuilds the CRM.

## The loop with GitHub Desktop

1. **Fetch origin** in GitHub Desktop before you start, so you are not editing
   an old copy.
2. Edit locally. `site/` is plain HTML, so any editor will do.
3. Look at the change before committing: `python3 -m http.server 8080 -d site`,
   then open <http://localhost:8080>. No build step exists for the website.
4. Commit with a message that says what changed on the page, not "update".
5. **Push origin**. The deploy starts within a few seconds.
6. Watch it in the **Actions** tab on GitHub. A website deploy takes under a
   minute; the CRM one takes a few minutes because it installs and builds on
   the server.

Monthly or before a big change, use **Actions → Deploy site → Run workflow** to
redeploy without changing a file.

## Secrets the workflows need

Set once in GitHub: **Settings → Secrets and variables → Actions**. All four are
shared by both workflows.

| Secret | What it is |
| --- | --- |
| `DEPLOY_SSH_KEY` | Private key that can log in to the server as the deploy user |
| `DEPLOY_KNOWN_HOSTS` | The server's host key line, so SSH does not prompt |
| `DEPLOY_HOST` | Server hostname or IP |
| `DEPLOY_USER` | Linux user that owns the site files |

To make a new key without touching the existing one:

```
ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key -N ""
ssh-copy-id -i deploy_key.pub USER@HOST        # adds the public key on the server
ssh-keyscan HOST > known_hosts                 # what DEPLOY_KNOWN_HOSTS expects
```

Paste `deploy_key` (including the BEGIN/END lines) into `DEPLOY_SSH_KEY`, and
`known_hosts` into `DEPLOY_KNOWN_HOSTS`. Delete the local key files afterwards.
Never commit a key.

## What each deploy actually does

**Website.** Checks that `site/index.html` and `site/site.css` exist and that
every URL in `site/sitemap.xml` has a matching file, then rsyncs `site/` to
`public_html`, then fetches the live homepage and confirms it contains the title
of the file that was just uploaded, then requests every sitemap URL and fails if
any is not a `200`.

The upload uses `--delete`, so a page deleted or renamed in the repo disappears
from the server. These are never deleted, because the host may own them:

- `.htaccess` — redirects and caching rules
- `.well-known/` — SSL validation files
- `error_log`
- `*.artifact.json` — design-tool sidecars that stay in the repo and are never published

Anything else you place in `public_html` by hand will be removed on the next
website deploy. Add it to the repo, or to the exclude list, or it will not
survive.

**CRM.** rsyncs `crm/` to the server, then over SSH runs `npm ci`, `npm run
build`, and restarts the process with PM2 as `dl-crm` on port `3000`. `.env` and
`node_modules/` are excluded, so the server's secrets and installed modules are
left alone. Afterwards it polls `https://app.dataleasers.com/login` and, if the
app does not come up, prints the last 60 lines of the PM2 log into the failed
run.

The server must already have `crm/.env` with the Supabase keys — see
[`crm/SETUP.md`](crm/SETUP.md). The workflow stops with a clear message if it is
missing.

## Rolling back

Revert the commit in GitHub Desktop (**History → right-click → Revert**) and
push. That is a normal commit, so it deploys like any other. Do not force-push
`main`: the deploy is triggered by the push, so a force-push publishes whatever
you pushed, including a half-finished state.

## When a deploy fails

| Symptom | Cause |
| --- | --- |
| `Permission denied (publickey)` | `DEPLOY_SSH_KEY` is stale, or the key is not in the server's `~/.ssh/authorized_keys` |
| `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` does not match the server; re-run `ssh-keyscan HOST` |
| `rsync: mkdir ... failed: Permission denied` | `DEPLOY_USER` does not own the target directory |
| Sitemap check fails | A page was renamed without updating `site/sitemap.xml` |
| "responding but not serving the new index.html" | The upload landed somewhere else, or a CDN cache is holding the old page |
| CRM "returned 502/503", log shown | The build succeeded but the process crashed at boot — usually a missing or wrong value in the server's `crm/.env` |

The website pages are also behind Cloudflare. Cache status is `DYNAMIC` for HTML
today, so a deploy is visible immediately; if that ever changes, purge the cache
in Cloudflare after a deploy.
