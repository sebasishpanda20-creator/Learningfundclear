# Crypto email watches

The options desk uses its existing strategy engine and login. The new UI adds shortcuts, prominent capital/quantity fields, and a background watch for one saved debit-spread paper plan per verified, active user. It does not discover new setups while the page is closed and does not place trades.

## Activation prerequisites

The Worker needs a KV namespace bound as `ALERTS_KV`, a server secret `RESEND_API_KEY`, and `ALERT_FROM` set to an address on a verified Resend sending domain. No key belongs in GitHub source or browser JavaScript. Deployment does not manufacture these credentials. Until all three exist, the UI reports not active and the scheduler exits without sending. Configure the KV namespace ID in wrangler.jsonc after creating it. Keep credentials in Worker secrets using secure administration tools.

The scheduled handler is registered every minute. A user signs in, creates a fresh paper spread, and explicitly enables email to their verified login email. The request cannot specify another recipient. Active membership is checked at enrollment. GET shows state, DELETE cancels the watch. Local plan reset does not cancel the separately stored watch; the UI explains this.

Events: plan saved, stop watch, target watch, time exit. Each event is sent once per watch with a stable Resend idempotency key. KV records expire after 10 hours without a successful send/update; watches end after time exit. Delivery retries on subsequent runs. API acceptance is not inbox-delivery confirmation. KV is eventually consistent; cancelling close to a scheduled run can race with a send. Email, scheduler and market data delays mean this is not a stop order. Fresh complete bid/ask books are required for price alerts; time-exit reminders do not need market quotes.

Provider documentation: https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/emails/idempotency-keys

## Checks

`node scripts/build.mjs --cloudflare`
`node --test qa/crypto-email.test.mjs`
`bash .ci/guard.sh`

Tests use mocked authentication, storage, market quotes and email delivery. No real email is sent during tests. Live delivery must be verified after provider setup with an explicitly enabled paper watch.
