# Deploy and hand-over steps

**Status on 2026-10-29:**
- GitHub (private): https://github.com/usmanovs/satuu-inbox, branch `main`.
- Dashboard (Vercel, production): **https://satuu-inbox.vercel.app**. It is a static Vite build using the Supabase project below. Verified: HTTP 200, shows the login screen in live mode (no demo banner), and its bundle contains the public project URL and no service-role key.
- The Vercel project was created from the local folder by CLI and is **not** linked to the GitHub repo, so pushes do not auto-deploy. To enable that: Vercel → project `satuu-inbox` → Settings → Git → Connect `usmanovs/satuu-inbox`.
- Nothing here changes n8n, and the WhatsApp integration is **not connected**.

## Which Supabase project the dashboard uses
| | |
|---|---|
| Project | **"Satuu AI"**, ref `mejaptdkcwxwcetxfdtr`, region ap-south-1 (the project you created for this app) |
| API URL | `https://mejaptdkcwxwcetxfdtr.supabase.co` |
| Deployed dashboard | https://satuu-inbox.vercel.app (Vercel team `seyitbek's projects`, project `satuu-inbox`) |
| Dashboard setting | `VITE_SUPABASE_URL=https://mejaptdkcwxwcetxfdtr.supabase.co` and `VITE_SUPABASE_ANON_KEY=<public anon/publishable key>` |
| What is in it | 4 migrations applied; Edge Functions `n8n` (v2) and `inbox` deployed; **0 rows**: no owner, no business, no integration key; **no Edge Function secrets set** |
| Leftovers | `mock-n8n` and `inbox-selftest` are neutralised stubs that answer `410`; delete them in Dashboard → Edge Functions when convenient |
| Not touched | No project was deleted or recreated. Your other projects (AI Accelerator, learn-getforce-dev, Android Course, vip-getforce) were never modified. |

Until the owner is provisioned (§3) nobody can use the live dashboard: login works only for a user linked to a business.

Migration history note: this project's history was created through the Supabase API, so its version names (`20261029121313…`) differ from the repo's file names (`20261029000001…`). Do **not** run a bare `supabase db push` against it. Either keep applying new SQL through the SQL editor, or reconcile first:
```bash
supabase migration repair --status reverted 20261029121313 20261029121323 20261029121404 <the 4th version shown by `supabase migration list`>
supabase migration repair --status applied 20261029000001 20261029000002 20261029000003 20261029000004
```

## 1. GitHub: done
Private repo `usmanovs/satuu-inbox`, pushed from `main`. Secrets excluded: `.gitignore` covers `.env`, `.env.*`, `supabase/.env.functions`, `.vercel`; only the two placeholder `.example` files are tracked, and a scan of the files and full history found no keys or tokens.

## 2. Dashboard: done, plus one step for you
Deployed to Vercel with build env `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public by design). To redeploy: `npx vercel deploy --prod` from the repo (log in first) or connect the Git repo in Vercel (see above).
**Still to do (needs your Supabase dashboard):** Authentication → URL Configuration → set **Site URL** to `https://satuu-inbox.vercel.app`; optionally set the Edge Function secret `ALLOWED_ORIGIN` to the same URL. Do not set `VITE_DEMO_MODE`.

## 3. Create the owner (once)
1. Dashboard → Authentication → Users → **Add user** (email + password, *Auto Confirm User*).
2. Authentication → Sign In / Providers → turn **off** *Allow new users to sign up*.
3. SQL editor: edit the email and business name in `supabase/provisioning/provision_owner.sql`, run it. It prints `<BUSINESS_ID>`.
4. SQL editor: run `supabase/provisioning/create_integration_key.sql` and copy the key shown **once** (for the n8n credential later).

Users cannot make themselves members: `business_memberships` has no INSERT policy and the browser role has `SELECT` only.

## 4. Remaining setup (in order; n8n is untouched until step 4)
1. Supabase Site URL (§2).
2. Provision the owner and the integration key (§3). Until then nobody can log in to the dashboard.
3. Optional now: set Edge Function secrets (`supabase secrets set …`; see `supabase/.env.functions.example`). Until `N8N_SEND_WEBHOOK_URL` and `N8N_SEND_WEBHOOK_SECRET` exist the composer shows «Не подключено».
4. Build the n8n changes in `docs/N8N_INTEGRATION.md` on a **copy** of the workflow, then run the end-to-end checklist in `docs/HANDOFF.md` §7.
