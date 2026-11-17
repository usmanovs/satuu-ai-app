# Bot operations: workflows, alerts and tests

The n8n workflows (cloud: getforce.app.n8n.cloud) and what each one does:

| # | Workflow | Purpose |
|---|---|---|
| 1 | Bot: Receive and Reply | WhatsApp trigger, voice-note transcription, answer-once merging, sales agent, sending, scoring, QR image, manager flag |
| 2 | Dashboard: Send Manager Reply | Sends replies written in the dashboard |
| 3 | Sync: Phone App Messages | (inactive) coexistence sync |
| 4 | Follow-up: Nudge Quiet Leads | Hourly 08:00-20:00 Bishkek, one nudge to leads quiet for 16-23 h |
| 5 | Alert: Bot Errors | Error workflow of 1, 2 and 4; writes a banner alert to the dashboard |
| 6 | Watchdog: Unanswered Messages | Every 30 min; alerts if customers wrote and got no reply for 5+ min |
| 8 | Follow-up: Second Touch (Template) | Hourly 10:00-18:00 Bishkek: one approved template message (EN/RU/KY) to warm leads quiet 3-7 days; skips itself until Meta approves the templates |
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
wait for the weekly Monday 09:00 Bishkek run (weekly, not daily, to save executions and AI calls; run it by hand after any prompt change). To add a case, add an entry to the `defs` list in its "Cases" node.

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
In Kyrgyz the federal-agencies part is fixed wording from the owner: "USDA, CFPB жана CMS сыяктуу федералдык мекемелердин IT долбоорлорун жетектеген" (he led IT projects for federal agencies).
The prompt also states that live classes are held on Zoom (the bot gives no link or joining steps).

## Second WhatsApp number
+996 700 264 555 (Cloud API phone number id 1474878105703295) was added to the same WhatsApp business account, so the same bot
workflow, templates and webhook serve both numbers; replies go out from the number the customer wrote to. It is listed in
`wa_numbers` ("Номер для лидов"). Registering a new number needs a 6-digit PIN chosen by the owner (never stored in the repo).
Chat-list tag under each chat shows which number the customer wrote to.

## Cost notes
n8n Cloud Starter allows 2,500 executions a month; every WhatsApp webhook (including sent/delivered/read statuses) and every scheduled run counts. Schedules were cut on 2026-11-17: watchdog every 30 min, nudges and second touch only inside daytime Bishkek hours, regression tests weekly. AI calls use n8n Gateway credits unless an own OpenAI credential is attached to the model nodes (OpenAI Chat Model, Lead Scoring Model, Nudge Model, Transcribe Voice).

## Mentorship earnings guarantee
The $2,500 1:1 mentorship comes with a guarantee of earning $500 (owner, 2026-11-17). The sales prompt states it only for that option, never for
Recordings or Live classes, and never as an average or forecast. The bot has no conditions, timeframe or payout details, so it says so and flags the
chat for the sales team. If these terms change, edit "MENTORSHIP EARNINGS GUARANTEE" in the Build Persona node of workflow 1.

## Price wording
Prices are never called "one-time" payments (owner, 2026-11-17): payment plans exist in Kyrgyzstan via Mbank (up to 7 months). The bot states the price and, when a
customer is deciding or worried about cost, mentions the Mbank installments. Rule: "PRICE WORDING" in the Build Persona node of workflow 1; it overrides the
older "one-time" lines still present in the base text of the "Sales AI Agent" node.

## Who can open the team page
The Команда page (team structure, manager statistics, numbers and AI assistants, adding people and invite links) is owner-only (owner request, 2026-11-17). Directors and managers do not see the button; the server also refuses team statistics and number edits for them (migration `20261117000017_owner_only_team_page.sql`). Directors still assign chats and see all chats; managers see only chats assigned to them.

## Som prices
Company rate: 87.5 som per 1 USD (owner, 2026-11-17). For customers who write in Kyrgyz and ask about prices, and for anyone who asks for som, the bot shows dollars and som:
$249 = 21,788 som, $349 = 30,538 som, $2,500 = 218,750 som (fixed figures in the prompt so the model never calculates). If the rate or prices change, edit "SOM PRICES"
in the Build Persona node of workflow 1.

## AI video course
GetForce has a separate AI photo/video course: https://courses.getforce.org/ai-video, 2,000 som (owner, 2026-11-17). The bot mentions it (one or two sentences plus the
link, price in som, never converted) to customers interested in AI photo or AI video, and says nothing else about its content or payment. It is not part of the main
program or its options. Rule: "AI VIDEO COURSE" in the Build Persona node of workflow 1.
The AI video course instructor is Oskon Akmatov (the course page and his Instagram spell it Akmatov), creator of popular Kyrgyz AI music videos, some with over 500,000 views
(owner). The bot names him and shares https://www.instagram.com/oskon_akmatov/ when asked who teaches it or to see his work, and adds nothing else about him.
It also says the course is recorded and self-paced (stated on the course page).

## Money in student stories
No disclaimer sentence after a story with money (owner, 2026-11-17: "individual result, not a promise" sounded defensive). The bot states the result plainly as that
person's own, then asks the customer about their own goal. Still forbidden: implying the customer will earn the same, calling it typical or average, adding sources or timelines.
Rule: "MONEY IN STORIES" in the Build Persona node of workflow 1. The regression suite no longer expects the disclaimer, and gained cases for som prices, the AI video course
and the "no one-time payment" wording.
When a customer asks "can I earn / is it worth it", the bot never opens with a plain yes ("да, можно заработать"): it starts with the story itself ("NO FLAT YES ABOUT EARNING" in the same rule).

## Sales technique (2026-11-17)
Rules in the "SALES TECHNIQUE" section of the Build Persona prompt (workflow 1): recap before the price, two-choice close, payment step as soon as the customer picks an option,
real safety nets early (refund until the end of the first class, Mbank installments, recordings, the mentorship guarantee), an objection playbook, premium-first price list,
real deadlines only (no invented scarcity, discounts or bonuses), and the AI video course as an entry step. Before each reply the bot also reads the real chat history from the
database ("Recent Chat" node), so messages the team sent from outside the bot are known to it. The follow-up nudge (workflow 4) now adds one piece of real value and ends with a
two-choice close. Further touches after the 24 h window need approved WhatsApp templates.

## Reason lost
When someone marks a chat "Не купит", a "Причина отказа" selector appears (Дорого, Нет времени, Нет ноутбука, Нет доверия, Нужно другое, Не сейчас, Другое); the owner sees the counts on the
Команда page. Database: `20261117000018_lost_reason.sql` (`conversations.lost_reason`, `set_lost_reason`, cleared when the chat is reopened or marked won).

## Hidden chats
`conversations.hidden_at` hides a chat from the dashboard and from team statistics without deleting it (clear it to show the chat again). The test chats on the +84 number were hidden on 2026-11-17.
The bot still answers a hidden chat if the customer writes again.

## One reply per burst, short replies
The bot waits 12 seconds (was 6) before answering, so a customer who sends several messages in a row gets ONE reply. A length limit (about 600 characters) applies even when
the customer asks for "full info".

## Hot leads, funnel, weekly report (2026-11-17)
- **Hot lead waiting for a human:** a lead rated 80+ with no person's message since gets a red/orange "⏱ ждёт N мин" badge in the chat list (red after 15 min) and a "горячих без человека" pill in the header; the dashboard can also show a browser notification (bell button asks for permission).
- **Funnel** (Команда page, owner): leads, dialog (3+ messages), interested (score 40+), hot (80+), got QR, bought, lost, time to first human touch for hot leads. Hidden and test chats are ignored.
- **Workflow 9 "Report: Weekly Sales Digest":** Mondays 10:30 Bishkek, writes a short Russian report from `weekly_digest_data` (funnel vs last week, objections, which proof was shown, stalled hot leads, silent-after-price chats) and saves it to `sales_reports`; the owner reads it on the Команда page. Run it by hand with "Run Now".
- **Students from Russia:** policy rule in the Build Persona prompt: no payment details, honest explanation about blocked AI tools, chat flagged for the team; numbers starting with 7 are asked for their country before payment (Russia and Kazakhstan share +7).

## Customer photos, videos and documents (2026-11-17)
Workflow 1 has a side branch after "Ingest Message": Find Media -> Has Media? -> Get Media URL -> Download Media -> Upload Media. It downloads the file from WhatsApp and posts it to the `media` edge function,
which saves it in the private storage bucket `chat-media` (max 25 MB; path business/conversation/message) and fills `messages.media_path/media_mime/media_name/media_size`. The dashboard shows the photo,
a video player or a document download card (signed links valid for 1 hour; a manager can open a file only if they can see the chat). The assistant still does not understand the content of videos or photos.
Failures in this branch are ignored (continue on error), so the reply to the customer is never delayed. Voice notes use the older transcription branch. Files are kept until the chat is deleted; add a cleanup if storage grows.
Migration: `20261117000021_message_media.sql`.

## Lead scoring fix (2026-11-17)
The scorer ("Score Lead" in workflow 1) once rated a chat 20 because the LAST message was only "Ало", ignoring a clear goal stated earlier. The prompt now says to judge the whole conversation (a short or empty last message never lowers the score), and the scorer reads the last 20 non-placeholder messages (was 12; the database caps it at 30).

## Live classes Demo Day guarantee (2026-11-17)
Owner decision: the $349 Live classes option comes with a conditional refund guarantee: the student attends the live classes and does the homework, and if they have no live website by Demo Day (December 11, 2026), they get a refund. Rule: "LIVE CLASSES DEMO DAY GUARANTEE" in the Build Persona node of workflow 1 (the mentorship rule and the "RISK REVERSAL EARLY" list were updated to match).
The bot states it for Live classes only (never for Recordings or the mentorship), plainly, in the customer's language, when someone hesitates or asks about risk, refunds or guarantees. It is not an earnings promise. The bot does not know the conditions' details (how much attendance or homework counts, what counts as a "live website", how and until when to claim, how money is returned): it says so and flags the chat for the team. If you decide these terms, add them to that rule. The old rule stays: refund on request until the end of the first class.
