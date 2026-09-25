# Deploying LearningFundClear India

Three free lanes, all of them HTTPS and none of them with a bill. Pick one.
The long version — free domains, DNS records, troubleshooting — is in
[FREE-HOSTING.md](FREE-HOSTING.md).

Nothing here needs a build step. What you deploy is this folder, as it is.

---

## Lane 1 — GitHub Pages (includes nightly data refresh)

Best lane, because the included workflow also refreshes the NAV data every night.

```bash
cd Learningfundclear
git init -b main
git add .
git commit -m "LearningFundClear India: initial static site"
gh repo create Learningfundclear --public --source=. --push     # needs the GitHub CLI, logged in
```

Then, in the repository on github.com: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. The included workflow takes over on the next push and publishes
the site at `https://<your-user>.github.io/Learningfundclear/`.

No `gh` CLI? Create an empty public repository in the browser, then:

```bash
git remote add origin https://github.com/<your-user>/Learningfundclear.git
git push -u origin main
```

## Lane 2 — Netlify (fastest, drag and drop)

Go to <https://app.netlify.com/drop> and drag the `Learningfundclear` folder onto the page.
It is live in about ten seconds at `https://<random-name>.netlify.app`. Rename it under
**Site configuration → Change site name**. `netlify.toml` in this folder is picked up
automatically, so caching, the 404 fallback and the security headers are already set.

For automatic redeploys, connect the repo instead: **Add new site → Import an existing
project → GitHub →** pick the repo, leave the build command empty, set the publish
directory to `.`.

## Lane 3 — Cloudflare Pages

**Workers & Pages → Create → Pages → Connect to Git**, pick the repo, framework preset
**None**, build command empty, output directory `/`. `_headers` is read by Cloudflare, so
the security headers apply here too.

Or, from the command line, without git:

```bash
npx wrangler pages deploy . --project-name Learningfundclear
```

---

## After any deploy

1. Open the site and check the **NAV date** in the strip under the header is today's or
   yesterday's, and that the pages load.
2. Replace the placeholder grievance contact at `legal.html#grievance` — it is marked
   `[TO BE FILLED]` and should not go live that way.
3. Point the sitemap at your real address (GitHub Pages does this automatically):

   ```bash
   sed -i 's#https://YOUR-SITE.example#https://your-real-address#g' sitemap.xml
   sed -i 's#Sitemap: /sitemap.xml#Sitemap: https://your-real-address/sitemap.xml#' robots.txt
   ```

---

## Refreshing the data

```bash
python tools/refresh-data.py            # fetch AMFI's file, rewrite assets/js/data.js
python tools/refresh-data.py --check    # report changes without writing
```

Run it from this folder. It needs Python 3.8+ and nothing else — no packages, no API key.
The GitHub Actions workflow runs it nightly for you, if you used Lane 1.
