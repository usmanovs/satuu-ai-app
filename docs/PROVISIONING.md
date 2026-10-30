# Provisioning (owner account, keys, secrets, deploy)

There is **no sign-up and no invitation flow**. The owner account is created by a person with access to the Supabase project, and linked to the business by a SQL script that runs with the database owner's privileges. The browser can never write `business_memberships`: the table has no INSERT/UPDATE/DELETE policy and `authenticated` has only `SELECT` on it.

## 1. Create the Supabase project and apply migrations
```bash
npm i -g supabase            # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <project-ref>
supabase db push             # applies supabase/migrations/*
```
(Or paste the three files from `supabase/migrations/` into the SQL editor in order.)

## 2. Create the manager login
1. Dashboard → **Authentication → Users → Add user**: email + password, tick *Auto Confirm User*.
2. Dashboard → **Authentication → Sign In / Providers**: turn **off** *Allow new users to sign up*.
3. Recommended: enable leaked-password protection (Authentication → Policies; plan-dependent).

## 3. Create the business and link the owner
Edit the email and business name in `supabase/provisioning/provision_owner.sql`, run it in the SQL editor. It prints the `business_id` and refuses to run twice for the same user.

## 4. Create the n8n key
Run `supabase/provisioning/create_integration_key.sql`. Copy the key (shown once) into an n8n Header Auth credential. Rotate by creating a new one and setting `revoked_at` on the old row.

## 5. Set Edge Function secrets
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. The service-role key never goes into the web app or any `VITE_` variable.
```bash
cp supabase/.env.functions.example supabase/.env.functions   # fill in real values; the file is git-ignored
supabase secrets set --env-file supabase/.env.functions
```
Until `N8N_SEND_WEBHOOK_URL` / `N8N_SEND_WEBHOOK_SECRET` are set, the composer shows «Не подключено» and the function answers `503 not_connected` without creating any message. Until `WA_TEMPLATE_NAME` is set, outside-window replies are disabled the same way.

## 6. Deploy the functions
```bash
supabase functions deploy n8n   --no-verify-jwt   # authenticated with the integration key
supabase functions deploy inbox                    # JWT required (and re-verified in code)
```

## 7. Run the web app
```bash
cp .env.example .env.local     # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (publishable/anon key only)
npm install
npm run dev                    # live mode
npm run dev:demo               # fictional data, no Supabase, can never send
npm run build                  # static files in dist/
```

## Tests
```bash
npm test                       # unit tests (no network)
# integration tests need a THROWAWAY project: never run fixtures.sql in production
#   1. run supabase/tests/fixtures.sql in the test project
#   2. deploy supabase/tests/functions/mock-n8n and inbox-selftest to that project (and create the test_mock_calls table noted in mock-n8n/index.ts)
SUPABASE_URL=… SUPABASE_ANON_KEY=… npm run test:integration
#   3. run supabase/tests/cleanup.sql
```
The «human replies» suite calls the `inbox-selftest` and `mock-n8n` functions (test-only copies of `inbox` with a hard-wired fake webhook, in `supabase/tests/functions/`). They exist only to prove the send logic without a real WhatsApp number. Never deploy them to production.

## Roles (RBAC)
| Role | Sees | Can do |
|---|---|---|
| `owner` | all chats | everything, plus add / disable / remove directors and managers (Team page) |
| `director` | all chats | reply, take over, return to AI, assign and reassign, see every manager's performance. Cannot manage the team |
| `manager` | only chats assigned to them | reply, take over, return to AI in their own chats, see their own performance |

- Permissions are enforced in Postgres (row-level security for reads, permission checks inside every write function), not only in the UI.
- When a customer asks for a person, the chat is auto-assigned to the active manager with the fewest open human chats; a chat that already has a manager keeps them. With no manager yet, only owner/director see it.
- The owner adds teammates on the dashboard's **Команда** page (email, name, role). No password is typed: the page shows a one-time invite link, the teammate opens it and sets their own password. The same page has a **Ссылка для входа** button that makes a new one-time link for a forgotten password. Each person belongs to exactly one business.
- Verify permissions any time with `supabase/tests/rbac.sql` (rolls back everything it creates).

## One WhatsApp number per salesperson, each with its own AI assistant
- **Numbers** live in `wa_numbers` (shown on the dashboard's **Команда → Номера и AI-ассистенты**): the Cloud API `phone_number_id`, a label, the owning salesperson (a manager) and the assistant's name and style.
- **One chat per customer per number.** The same customer writing to two salespeople gets two chats. A chat on a salesperson's number belongs to that salesperson from the first message: only they, the director and the owner see it.
- **The assistant** answers on that number with the salesperson's settings appended to the shared rules. It always stays honest: it never claims to be the salesperson or a human, and the sales, opt-out and privacy rules always apply. Salespeople edit their own assistant; the owner and director edit all numbers and choose who owns each.
- **Numbers without an owner** (today's shared number) behave as before: AI answers, and a chat is auto-assigned when the customer asks for a person.
- **A new number registers itself** on its first inbound message, so the bot never drops a chat. The director then sets its owner and assistant.
- **Connecting a real number** needs Meta (Embedded Signup, ideally coexistence). Until the App Review is approved, only the sandbox number exists.
- Verify the rules any time with `supabase/tests/multi_number.sql` (rolls back everything it creates).
