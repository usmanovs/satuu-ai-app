# Bot operations: workflows, alerts and tests

The n8n workflows (cloud: getforce.app.n8n.cloud) and what each one does:

| # | Workflow | Purpose |
|---|---|---|
| 1 | Bot: Receive and Reply | WhatsApp trigger, voice-note transcription, answer-once merging, sales agent, sending, scoring, QR image, manager flag |
| 2 | Dashboard: Send Manager Reply | Sends replies written in the dashboard |
| 3 | Sync: Phone App Messages | (inactive) coexistence sync |
| 4 | Follow-up: Nudge Quiet Leads | Hourly, one nudge to leads quiet for 16-23 h |
| 5 | Alert: Bot Errors | Error workflow of 1, 2 and 4; writes a banner alert to the dashboard |
| 6 | Watchdog: Unanswered Messages | Every 10 min; alerts if customers wrote and got no reply for 5+ min |
| 8 | Follow-up: Second Touch (Template) | Hourly: one approved template message (EN/RU/KY) to warm leads quiet 3-7 days; skips itself until Meta approves the templates |
| 7 | Tests: Bot Regression | Runs ~25 scripted chats through the real bot; alerts if any check fails |

The sales prompt lives in two places in workflow 1: the base text in the node "Sales AI Agent" and the facts, payment,
handoff, story and formatting rules in the node "Build Persona" (these override the base text where they conflict).

## Dashboard alerts (`bot_alerts` table)
Failed steps, unanswered customers and failed tests show as a red banner for owners and directors. Runtime alerts
(error, credits, whatsapp_token, unanswered) clear themselves when the bot sends its next reply; a failed-tests alert
clears when a later test run passes.

## Answer once
After the AI gate, workflow 1 waits 6 seconds, asks `/pending-input` whether this is still the newest customer message,
and if so answers once to everything the customer wrote since the last reply. Older messages stop there.

## Regression tests
Workflow 7 posts messages to the "Test Entry" webhook of workflow 1 (protected by a key header). Test chats use phone
numbers that start with `99900`; the bot treats them like normal customers except that nothing is sent to WhatsApp and
the QR image is skipped. Replies are read back with `/test-replies`, checked with regular expressions, and all `99900*`
contacts are deleted afterwards (`/test-cleanup`, enforced in the database). Run it with the "Run Tests Now" trigger or
wait for the daily 09:00 Bishkek run. To add a case, add an entry to the `defs` list in its "Cases" node.

## Migrations added with these features
`20261116000013_followups_and_hot_alerts.sql`, `20261116000014_manager_needed_flag.sql`,
`20261116000015_alerts_debounce_tests.sql` (the later tweaks to `test_replies` and `record_bot_alert` were applied as
`alerts_tests_tweaks`).

## Second follow-up (workflow 8)
Leads with a score of 40+ who went quiet 3 to 7 days ago (the free 24 h window is closed) get ONE template message,
10:00-18:59 Bishkek time only, never after STOP, never when a manager has written in the chat, never twice.
Templates (category MARKETING, created through the Graph API): `followup_2_en`, `followup_2_ru`, `followup_2_ky`
(each has an opt-out line in the footer). The workflow checks every hour that at least one is APPROVED; the language is
chosen from the customer's last message. Sending marketing templates needs a payment method on the Meta messaging
account: if a send fails, the claim is released and a dashboard alert shows Meta's error text. Migration:
`20261116000016_second_followup.sql`.

## Instructor bio in the sales prompt
The INSTRUCTORS paragraph (node "Build Persona", workflow 1) says Seyitbek Usmanov has worked as a tech lead at leading
IT consulting companies in the USA (Deloitte, Accenture, GDIT) and on projects for federal agencies (USDA, CFPB, CMS);
whenever the bot describes his background it must name both parts. It never says he works there now, never gives dates,
titles other than tech lead or project details, and never implies endorsement. His LinkedIn
(https://www.linkedin.com/in/seyitbek/) is shared when a customer asks who teaches or wants to verify him.
Share link for leads: https://wa.me/84582572652
