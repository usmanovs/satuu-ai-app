# Deploy and hand-over steps

**Status on 2026-10-29:** the GitHub repository and the hosted dashboard do **not exist yet**. This environment had no GitHub or hosting access (no `gh`, no hosting CLI or connector, no credentials), so those two steps are yours; the exact commands are below. Nothing here changes n8n, and the WhatsApp integration is **not connected**.

## Which Supabase project the dashboard uses
| | |
|---|---|
| Project | **"Satuu AI"**, ref `mejaptdkcwxwcetxfdtr`, region ap-south-1 (the project you created for this app) |
| API URL | `https://mejaptdkcwxwcetxfdtr.supabase.co` |
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

## 1. Push the repository to a private GitHub repo
The repo is local (`/Users/seyitbek/Sales Super Bot`, branch `main`). No remote is configured. Secrets are excluded: `.gitignore` covers `.env`, `.env.*` and `supabase/.env.functions`; only the two placeholder files `.env.example` and `supabase/.env.functions.example` are tracked. A scan of tracked files found no keys or tokens.

With the GitHub CLI:
```bash
gh auth login
gh repo create satuu-inbox --private --source . --remote origin --push
```
Without it: create an empty **private** repository on github.com (no README), then
```bash
git remote add origin https://github.com/<you>/satuu-inbox.git
git push -u origin main
```
Check afterwards: `git ls-files | grep -E '\.env'` must list only the two `.example` files.

## 2. Deploy the dashboard (static site)
Vite app, no server needed. On Vercel, Netlify or Cloudflare Pages: import the GitHub repo and set
- Build command `npm run build`, output directory `dist`
- Environment variables (public by design): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Dashboard → Settings → API → anon/publishable key)
- Do **not** set `VITE_DEMO_MODE`. Never put the service-role key anywhere in this project.

Then in Supabase → Authentication → URL Configuration set **Site URL** to the deployed URL, and optionally set the Edge Function secret `ALLOWED_ORIGIN` to it.

## 3. Create the owner (once)
1. Dashboard → Authentication → Users → **Add user** (email + password, *Auto Confirm User*).
2. Authentication → Sign In / Providers → turn **off** *Allow new users to sign up*.
3. SQL editor: edit the email and business name in `supabase/provisioning/provision_owner.sql`, run it. It prints `<BUSINESS_ID>`.
4. SQL editor: run `supabase/provisioning/create_integration_key.sql` and copy the key shown **once** (for the n8n credential later).

Users cannot make themselves members: `business_memberships` has no INSERT policy and the browser role has `SELECT` only.

## 4. Remaining setup (in order; n8n is untouched until step 5)
1. Push to GitHub (§1). **Blocked on your GitHub access.**
2. Deploy the dashboard (§2). **Blocked on your hosting account.**
3. Provision the owner and the integration key (§3).
4. Optional now: set Edge Function secrets (`supabase secrets set …`; see `supabase/.env.functions.example`). Until `N8N_SEND_WEBHOOK_URL` and `N8N_SEND_WEBHOOK_SECRET` exist the composer shows «Не подключено».
5. Build the n8n changes in `docs/N8N_INTEGRATION.md` (flatten batch, ingest, gates, claim-based human-send workflow) on a **copy** of the workflow, then run the end-to-end checklist in `docs/HANDOFF.md` §7.
