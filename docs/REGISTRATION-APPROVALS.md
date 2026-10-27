# LearningFundClear — Admin-created + self-registration with one-time approval

## Two independent paths (both retained)

- **Admin creates a user:** existing Administration → Create user form calls the existing privileged `create-user` Supabase Edge Function, creates an active standard account and remains unchanged.
- **User registers themselves:** new public sign-in section collects username, display name, real email and password. Supabase email signup records a request marker in `auth.users.user_metadata`. **No row is created in `public.app_users` by the registration form.** A valid active portal account is created only by an active administrator using the **Approvals** tab, after the applicant confirms their email.
- **Only the first signup requires approval:** on approval, the backend inserts `public.app_users` with `is_admin=false, is_active=true`. Subsequent sign-ins verify the same active row; no re-approval unless admin intentionally disables access.
- **Rejected signup:** admin-reviewed rejection is recorded in Supabase's server-controlled `app_metadata` and no active profile is created. Existing admin-created accounts are unaffected.
- **No external AI, ChatGPT, Cloudflare dashboard change or broker key is required.**

## One-time Supabase activation required (do not skip)

**Important: GitHub/Cloudflare deployment alone does not activate public registration.** The backend must be installed, and the open signup UI deliberately fails closed if the database approval protection is missing.

1. On the existing Supabase project **chbtjicvbezbiosuouwm**, inspect existing RLS and any Auth hooks that might automatically create active `app_users` records. Public self-registration must NOT cause an active `app_users` profile to appear without approval. Existing `create-user` function and existing accounts must continue working.
2. Review and apply `supabase/migrations/20261028000000_admin_approved_registration.sql` in Supabase SQL Editor (or an authorized migration runner). This adds restrictive active-member checks to existing private `app_users`, `ideas`, `user_watchlist` and `audit_log` RLS policies without removing data. It also creates the server-only `lfc_registration_ready` RPC marker. Review any additional private authenticated tables/endpoints under your data model to ensure pending users cannot read data.
3. Deploy `supabase/functions/registration-approvals/index.ts` using `supabase functions deploy registration-approvals --project-ref chbtjicvbezbiosuouwm --no-verify-jwt`. **Only this function has `verify_jwt=false`** for its public readiness check. All admin actions independently validate a signed-in Supabase token and active administrator role on the backend. The service-role key remains inside Supabase Edge runtime, never the portal frontend.
4. Enable Supabase Auth email signup and **email confirmation** for the existing project, and configure a reliable email sender within provider limits. Existing `@portal.local` logins remain valid. Configure allowed redirect URLs for the current Cloudflare site if needed.
5. Optionally configure the repository Actions secret `SUPABASE_ACCESS_TOKEN` for hands-free Edge deployment on subsequent changes; GitHub workflows never automatically run SQL migrations, for safety. A missing secret causes function deployment to **skip**, not a claimed success. Never put credentials in GitHub source, chat, or browser files.
6. Test: self-register and verify email → remains locked out → admin signs in → Approvals list shows request → admin approves → applicant signs in; subsequent sign-ins work without approval. Test admin manual create-user separately. Test reject, duplicate username, inactive account, non-admin API calls, password change and logout across devices.
7. If backend unavailable or the database marker absent, the **Submit registration request** button stays disabled with an explanatory notice; existing sign-ins and admin-created users continue to work.

## Safety restrictions

- The Approvals navigation item is only shown to logged-in admin profiles, but this visibility is cosmetic; Supabase Edge validation and restrictive DB policies are the access controls.
- Applicant input is not interpolated as HTML.
- A public registration never grants admin permissions.
- Signup must be rate-limited using Supabase Auth/email protections (and optional Cloudflare WAF/bot protection if traffic grows).
- Never assume successful GitHub CI constitutes verification of a live Supabase deployment.
