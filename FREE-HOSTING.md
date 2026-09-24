# Free hosting and a free domain — FundClear India

This folder is built to be hosted **for ₹0 a month, forever**, with no server to run and no
backend to pay for. This document says exactly what is already configured here, what only
you can do, and what free domains actually exist in 2026.

---

## 1. What is already configured in this folder

Nothing below needs writing; it ships with the site.

| File | What it does | Read by |
|---|---|---|
| `netlify.toml` | publish dir, cache rules, 404 fallback, no build command | Netlify |
| `_headers` | `nosniff`, `X-Frame-Options: DENY`, HSTS, a strict CSP, `Permissions-Policy` | Netlify, Cloudflare Pages |
| `.nojekyll` | stops Jekyll eating underscore files on GitHub Pages | GitHub Pages |
| `robots.txt` | allows crawling, hides `404.html` and `tools/` | all hosts |
| `sitemap.xml` | six pages, one placeholder base URL | search engines |
| `.github/workflows/deploy-pages.yml` | on every push and nightly: refresh AMFI data → commit → syntax-check → verify every page links its assets → rewrite the sitemap to your real URL → deploy | GitHub Actions |
| `404.html` | self-contained error page, works at any URL depth | all hosts |
| `DEPLOY.md` | the three-lane quickstart | you |

The site is plain HTML/CSS/JS with **no build step**, so every host treats it as static
files. Nothing is fetched at runtime except its own local files: the CSP sets
`connect-src 'none'`, which is how you can be sure the site never phones home.

## 2. What only you can do (the whole list)

These need a human with a browser, an email address and a payment method that will not be
charged — or a login on your machine that does not currently exist.

1. **Create a free account** on GitHub, Netlify or Cloudflare.
2. **Push this folder to a repository** (or drag it onto Netlify Drop, which needs no git).
3. **Switch Pages on** — GitHub only: *Settings → Pages → Source: GitHub Actions*.
4. **Optionally, claim a free domain** (section 4) and add its DNS records at the host.
5. **Fill in the grievance contact** at `legal.html#grievance` before launch. It is
   deliberately left as `[TO BE FILLED]`.

That is the complete list. There are no other blockers: no server, no database, no
secret, no paid tier.

## 3. The three free lanes

| Lane | Free address you get | Free data refresh | HTTPS | Catch |
|---|---|---|---|---|
| **GitHub Pages** | `<user>.github.io/fundclear` | **Yes** — nightly Action included | Yes | Public repo; Pages source must be set to "GitHub Actions" |
| **Netlify** | `<name>.netlify.app` | Only if you connect the repo | Yes | 100 GB bandwidth/month, then politely throttled |
| **Cloudflare Pages** | `<name>.pages.dev` | Only if you connect the repo | Yes | Unlimited requests and bandwidth — the most generous |

All three are genuinely free for a site this size. Cloudflare Pages has the strongest free
limits; GitHub Pages is the only one where the nightly NAV refresh is already automated.

## 4. Free domains — what is actually obtainable in 2026

Be careful here: most "free domain" lists you will find are years out of date.

| Option | Cost | What you get | Effort | Notes |
|---|---|---|---|---|
| **Host subdomain** (`you.github.io`, `*.netlify.app`, `*.pages.dev`) | Free forever | Not your own name | Zero | Always available, already live the moment you deploy |
| **is-a.dev** | Free | `yourname.is-a.dev` | A pull request to their repo | Open to anyone, reviewed by maintainers, good fit for a personal project |
| **js.org** | Free | `yourname.js.org` | A pull request, and the site must be JS-related | Meant for JavaScript projects; a finance portal may be rejected |
| **eu.org** | Free | `yourname.eu.org` | Manual review, often weeks | Long-standing and reliable, but slow to approve |
| **FreeDNS / afraid.org** | Free | Subdomains of their domains | Account plus record setup | Reliable for a subdomain; ugly addresses |
| **DuckDNS** | Free | `yourname.duckdns.org` | Minutes | Built for dynamic DNS; fine for a hobby project |
| **Freenom** (`.tk`, `.ml`, `.ga`, `.cf`, `.gq`) | — | — | — | **Effectively dead.** Do not plan around it; it stopped issuing domains after legal action and existing ones have been revoked |
| **A real domain** (`.in`, `.com`, `.co.in`) | ₹700–1,300/year | Your own name, your own brand | Minutes | **This is the only truly professional option**, and the price in rupee terms is small — cheaper than most people assume |

**My recommendation:** deploy on a host subdomain today, because that costs nothing and puts
you live now. Then buy a `.in` domain if this becomes more than an experiment: for a
finance site, an address that looks like a business rather than a random string matters for
trust, and it is the cheapest trust you will ever buy. Treat the free-domain schemes as
optional extras, not as the plan.

## 5. Pointing a custom domain at the site

At your host, add the domain, then create these records at your registrar. Use the exact
targets your host shows you — they differ slightly between providers.

For an apex domain (`example.in`):

| Type | Name | Value |
|---|---|---|
| A | `@` | `185.199.108.153` (GitHub Pages) |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` (optional, IPv6) |

For `www` or any other subdomain, prefer a CNAME and let the host manage addresses:

| Type | Name | Value |
|---|---|---|
| CNAME | `www` | `<your-user>.github.io` |
| CNAME | `www` | `<your-site>.netlify.app` (Netlify users: use their target from the dashboard) |

Then enable **Enforce HTTPS** at the host. The certificate is issued free and automatically;
it can take up to 24 hours after DNS resolves, and the site is reachable over HTTP in the
meantime.

## 6. Post-deploy checklist

- [ ] Site loads at the host address, over HTTPS.
- [ ] The strip under the header shows the right **NAV date** — not an old one.
- [ ] `index.html`, `funds.html`, `scheme.html` (click any row), `compare.html`,
      `calculators.html`, `methodology.html`, `legal.html` all open.
- [ ] A deliberately wrong URL shows the 404 page rather than a host default.
- [ ] `robots.txt` and `sitemap.xml` are reachable.
- [ ] `legal.html#grievance` no longer says `[TO BE FILLED]`.
- [ ] `sitemap.xml` contains your real address, not `YOUR-SITE.example`.
- [ ] One API-free sanity check: a fund house you know is present with a plausible NAV.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Pages are unstyled | Stylesheet path wrong, or the site is served from a different root | Paths are relative already; check you deployed the folder containing `assets/` |
| Blank pages, "Cannot read properties of null" | An HTML page is missing a script tag, or `data.js` did not upload | Deploy the whole folder; `data.js` is the only data file and everything reads it |
| Old data after a refresh | Browser or CDN cache | Hard-refresh; `data.js` is served with `must-revalidate` |
| Data file 404s on GitHub Pages | Jekyll processing | `.nojekyll` ships here — confirm it survived the upload (hidden file) |
| GitHub Pages shows a Jekyll error | Pages source still on "Deploy from a branch" and a stray `_config.yml` exists | Set Pages source to **GitHub Actions** |
| Charts or the risk line missing | JavaScript blocked | Check the CSP in `_headers` was not edited to drop `script-src 'self'` |
| `[TO BE FILLED]` visible on the live site | You have not edited the grievance contact yet | Edit `legal.html`, redeploy |
| Sitemap rejected | Still has the placeholder URL | Section 6, third checkbox |

## 8. What free hosting cannot do

Worth knowing before you plan around it.

- **No server-side anything.** No logins, no saved watchlists, no email alerts, no
  server-rendered pages. Every one of those needs a backend, and a backend is where the
  bill starts. If you later want accounts, a tiny free-tier service or a scheduled job is
  the honest next step — not a bigger static host.
- **No licensed market data.** This site is static and legal because it republishes only
  AMFI's free NAV file. Exchange quotes, intraday data and analyst estimates are licensed
  products; serving them without a licence is a regulatory problem, not a technical one.
- **No SEO parity with pre-rendered pages.** Pages here render in the browser from a JSON
  file. Search engines handle that, but a page generated per scheme would rank better.
- **Nothing about the domain is permanent** unless you own it. A free subdomain can be
  withdrawn; a domain you pay for cannot be taken away for policy reasons.
