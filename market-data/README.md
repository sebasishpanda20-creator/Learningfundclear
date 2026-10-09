# Private Nifty 500 snapshots

The `nifty500-data.yml` workflow runs unattended on GitHub Actions:

- Delayed completed 15-minute candles: weekday collection slots from 09:30 to 15:45 IST. Yahoo historical chart access is best effort, not a supported real-time feed or a fixed-delay guarantee. Collection stops on HTTP 401/403/429. No bypass proxy is used.
- EOD: 18:00 IST on weekdays, using the dated NSE daily bhavcopy. Missing holiday reports are reported as unavailable; previous usable data is retained with its original date.
- The official Nifty 500 membership is refreshed during EOD collection. A failed membership download preserves the previous dated list. Published temporary/dummy entries remain visible as unavailable when no price exists.

Schedules can be delayed or skipped by GitHub. The portal polls published snapshots once per minute while visible; closing the portal does not stop GitHub collection. Neither path supplies option chains or places trades.

## Privacy and hosting

Snapshots are gzip-compressed and encrypted with a random AES-256-GCM key. That key is wrapped using the repository's RSA public key. Only ciphertext is committed. No broker account is involved. The RSA private key is stored only in the private Site's `NIFTY_FEED_PRIVATE_KEY` secret. Never commit or expose that value.

The Worker validates the portal's Supabase session and active profile before decrypting snapshots. A plain static/GitHub Pages deployment cannot serve `/api/nifty500`; use the private Site deployment. Build with `node scripts/build.mjs` to produce `dist/client` and `dist/server/index.js`.

A new public key requires its corresponding private key to be configured in Sites before publishing and all retained snapshots to be regenerated. Do not rotate keys casually.

## Verification

`node --test qa/nifty500.test.cjs`
`python3 qa/nifty500-collector.py`
`node qa/nifty500-flows.cjs`

Tests use fixtures, not production account credentials. Real EOD ingestion was checked separately against the 8 October 2026 report: 500 usable rows from 501 official entries; DUMMYHEG had no quote. This is a dated observation, not a future coverage guarantee.
