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
| 10 | After-Payment Sequence | Every 2 h, 08:00-20:00 Bishkek: sends the approved `onb_*` templates after a customer is marked as bought (see "After-payment sequence") |

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
Owner decision: the $349 Live classes option comes with a conditional refund guarantee. Confirmed terms: the student attends ALL the live classes and does ALL the homework; if they have no live website on Demo Day (December 11, 2026), they get a refund of what they paid for Live classes. "Live website" = a public web address that opens and works. To claim, the student writes to the team within 7 days after Demo Day (by December 18, 2026); the team checks attendance, homework and the site. Rule: "LIVE CLASSES DEMO DAY GUARANTEE" in the **Build Persona Raw** node of workflow 1 (the mentorship rule and the "RISK REVERSAL EARLY" list were updated to match).
The bot states it for Live classes only (never for Recordings or the mentorship), in one short line ("attend all classes, do all homework, no working site by Demo Day = refund"), and gives the details only when asked. It is not an earnings promise. Still unknown to the bot (it says so and flags the chat): missed class or homework for a good reason, whether watching a recording counts as attending, how and how fast the money is returned, how it works with installments. The older rule stays: refund on request until the end of the first class.

## Vibe Coding first, AI video course last (2026-11-17)
Owner decision: every conversation is steered to the Vibe Coding program, Live classes or Recordings, with a two-choice close between those two. The AI video course (2,000 som, recorded) is a LAST RESORT: never in a first reply, never as a cheaper alternative to Recordings, and offered only after the main program was presented and the customer still clearly wants only AI photo/video or cannot afford either option, or when they ask about it directly. Rules: "COURSE FOCUS AND POSITIONING", "AI VIDEO COURSE (LAST RESORT)" and "SALES TECHNIQUE (7) MAIN PROGRAM FIRST" in Build Persona Raw. Regression cases `ai_video_main_first`, `ai_video_last_resort`, `live_guarantee`, `live_guarantee_terms` check this.

## Persona nodes in workflow 1
The prompt text lives in **Build Persona Raw**; the small node **Build Persona** after it only applies the owner's word rule for "app" (Russian "приложение", never "колдонмо"/"тиркеме") and feeds the Sales AI Agent. Edit course rules in Build Persona Raw. Note: two sessions edited these nodes at the same time on 2026-11-17 and one overwrote the other's wrapper; it was restored and verified byte for byte.

## After-payment sequence (2026-11-17)
When a manager presses **Купил** in the dashboard they now also pick what the customer bought (Записи $249, Live-занятия $349, Менторство $2 500); it can be corrected later in the same panel (`conversations.purchased_option`). Workflow 10 then sends WhatsApp templates, one per step, in the customer's language (RU, KY or EN, chosen like the second follow-up; falls back to RU/EN if a language is not approved):
| Step | When | Who | Template |
|---|---|---|---|
| welcome | at the next run after "Купил" | everyone | `onb_welcome_*`: welcome, onboarding manager will help with Discord (no link, no timing promised) |
| prep | 20 h or more after the welcome (until 28 Nov) | everyone | `onb_prep_*`: computer, Claude subscription (~$20/month) |
| reminder | 26 Nov 10:00 to 27 Nov 12:00 Bishkek | Live and Mentorship | `onb_reminder_*`: cohort starts 27 Nov, Mon/Wed/Fri 20:00 Bishkek, Zoom |
| checkin | 4-7 Dec | everyone | `onb_checkin_*`: how is week one going |
| demo | 12-15 Dec | Live and Mentorship | `onb_demo_*` (MARKETING category, has an opt-out footer): asks for a short testimonial and permission to share it |
Rules: sends only 08:00-20:59 Bishkek; at most one step per chat per run and 12 h between steps; one send per step per chat (table `onboarding_sends`, claim then confirm); never to a chat where the customer wrote STOP; buyers marked before 2026-11-17 22:00 UTC get nothing; test chats (99900...) are skipped. Each sent message is also recorded in the chat with a 📨 prefix. A failed send releases the claim and shows a dashboard alert.
Templates were submitted to Meta on 2026-11-17 (all PENDING at that time); the workflow skips itself until at least one `onb_*` template is APPROVED. The Kyrgyz wording is not yet reviewed by a native speaker. The dates (cohort start 27 Nov, Demo Day 11 Dec) are fixed in the function `get_onboarding_due_at` and in the template texts: change them there for the next cohort.
Pieces: migration `20261117000024_onboarding_sequence.sql`, edge function `onboarding` (routes due, claim, confirm, release), template source `n8n/onboarding_templates.js`, workflow code `n8n/onboarding_pick.js`. The 2-hourly schedule costs about 7 n8n executions a day.

## Typing indicator (2026-11-17)
Workflow 1: after "Latest Message?" a real customer chat (not 99900 test chats) goes through "Typing Real Chat?" -> "Show Typing" -> "Recent Chat". "Show Typing" POSTs to the Graph messages endpoint (`status: read` + `typing_indicator: {type: text}`) with the WhatsApp credential, so the customer sees "typing..." while the bot writes (WhatsApp clears it when we reply or after about 25 s) and their message gets read ticks. It continues on error (5 s timeout), so a failure never blocks a reply. Businesses cannot see the customer's typing or recording; this is only the other direction. Not yet confirmed on a real phone at the time of writing: check the "Show Typing" node result in a real execution.

## Mentorship pitch (2026-11-17)
The owner found the Kyrgyz price line for the $2,500 1:1 mentorship ("жеке жардам", personal help) flat. Rule "MENTORSHIP PITCH" in Build Persona Raw: no vague phrases; the price-list line names two or three concrete things (weekly 1:1 calls with Seyitbek, direct WhatsApp/Telegram access, code review of the student's own project, the $500 guarantee as written in MENTORSHIP EARNINGS GUARANTEE); when a customer asks about it or compares options, it is presented as the VIP choice (personal work with Seyitbek, individual plan, career and portfolio help, plus all of Live classes) and ends with one question about their goal. The bot still never invents the number or length of calls, schedule, response times or bonuses. The name stays "1:1 mentorship"; "VIP" is not used in customer messages unless the owner decides to rename it.

## Manager flag guard and natural tone

- **Flag guard** (workflow 1, node `Needs Manager?`): the AI's `[[NEED_MANAGER]]` marker is ignored when the customer's message is a bare acknowledgement (ок, макул, рахмат, да, 👍…) or is under 26 characters with no question mark and none of the risk words (Russia, refund, complaint, discount, installments, invoice). Before this, chats like «Ок» or «Рилс» were flagged for no reason.
- **Natural tone rules** live in the small wrapper node `Build Persona` (appended after the prompt): greet only in the first message of a chat; answer the latest message or problem first; no stock "I have no exact information" phrase; casual short questions; never ask for a screenshot (the bot cannot see images); WhatsApp-group join trouble flags the chat for a manager.

## One reply per burst of messages

Workflow 1 checks "is this the newest customer message" after the 12 s wait (`Latest Message?`) and again right before sending (`Recheck Latest` + `Still Latest?`, after `Send Gate`). If the customer wrote again while the AI was generating, the stale reply is dropped and the newer run answers everything together. Before this, 28 of 242 AI messages on 2026-11-18 were quick back-to-back duplicates (up to three overlapping replies).

## Computer requirements and feedback (confirmed by the owner, 2026-11-18)

Stored in the `Build Persona` wrapper node. Minimum: laptop or desktop from roughly the last 8-10 years, 4 GB memory (8 GB more comfortable), ordinary dual-core processor, about 10 GB free disk, stable internet, up-to-date Chrome/Edge/Firefox. Windows 7 is fine (also Windows 10/11, macOS, Linux). A phone does not work. The numbers (4 GB, 10 GB, 8-10 years) were proposed by the assistant and approved implicitly by the owner: adjust them here if they are wrong. Feedback: quick during the course; afterwards students keep access to other students' feedback; recorded lessons get Discord support. No exact response time is ever promised.

## Photos, files and videos

The bot cannot see images. Before 2026-11-18 a customer's photo got no reply at all, and one customer wrote «жооп жок го???» eleven minutes later. Now workflow 1 has a branch from `Is Duplicate`: `Unsupported Media?` (image, document or video, chat AI-active, not a test) -> `Flag Media` (manager flag) -> `Media Reply Text` -> `Send Media Reply` -> `Record Media Reply`. The reply is one honest line asking for a few words, in Kyrgyz, Russian or both (by caption). Reactions and stickers get no reply. The path cannot be run through the test webhook (text only), so it was checked by wiring and credentials only.

## Review findings 2026-11-18 (second pass)

- The WhatsApp course group invite was reset: 8 customers wrote that they cannot join the group (6 in the last 24 hours). Fix the invite link at the source; the bot can only flag these chats.
- A follow-up nudge went out the morning after a customer said they would write back themselves. Consider a longer quiet period when the customer closes the chat.

## Scope and proof limits (third review, 2026-11-18)

Stored in the `Build Persona` wrapper node. Found in the chats: (1) the bot coached a customer through building a website (wrote a ChatGPT prompt, asked how it went): free tutoring is now forbidden; (2) a customer who said she had already finished the course got sales questions: graduates are not pitched and the chat is flagged; (3) job and vacancy questions («вакансии», «работа с американцами») got "no information": the bot now says the course does not guarantee a job or clients, invents nothing and flags the chat; (4) the $2,000 student story appeared in 26 of 90 chats (32 times) and the Zarena video 28 times: each is now used at most once per chat and never in the first reply.

Open question for the owner: several ads or videos seem to promise jobs or vacancies. A manager once sent a vacancy spreadsheet. If that is a real offer, tell the bot what to say about it.

## Jobs and vacancies (confirmed by the owner, 2026-11-18)

We do not promise jobs, vacancies or clients and we do not place students. We teach the skills and tell students they must go out and find projects themselves. The bot says this plainly and kindly when asked, invents no vacancies or partner companies, and does not flag a manager for this question alone. (A vacancy spreadsheet link once sent by a manager is not part of the offer.) Rule 3 of the scope block in the `Build Persona` wrapper node.

**Vacancy list (owner, 2026-11-18):** customers who ask for vacancies or AI jobs get the owner's spreadsheet of 10 AI jobs (https://docs.google.com/spreadsheets/d/1b2XEHCB5T7yv3RxpWDNyQPrw9SG2f--alAsz3GWUSVU/edit?usp=sharing), once per chat, framed as a list to apply to themselves and never as a job promise. To change the list or link, edit rule 3 of the scope block in the `Build Persona` wrapper node.

## WhatsApp group link and the 2026-11-18/19 n8n outage

- **Group link (owner, 2026-11-19):** when a customer says the course WhatsApp group link does not work, the bot sends the current invite (https://chat.whatsapp.com/CmCyezXVhx35NkaSTABbRi) once per chat and asks if it opens. If it was already sent and they still cannot join, the bot asks what exactly happens and flags a manager. Rule 6 of the tone block in the `Build Persona` wrapper node; update the link there if the invite is reset again.
- **Outage:** from about 20:23 UTC on 2026-11-18 until about 12:31 UTC on 2026-11-19 the n8n Cloud instance executed nothing (all workflows, including the 30-minute watchdog). It first failed with "problem executing the workflow", then returned 503. Suspected cause: the n8n plan's monthly execution limit (about 2,490 executions had been logged). Watch the n8n usage page; the watchdog alert cannot fire when n8n itself is down, so consider an external uptime check on the n8n webhook.

## n8n uptime monitor

Migration `20261119000025_n8n_uptime.sql`. Because the n8n watchdog cannot report when n8n itself is down, Supabase pings `https://getforce.app.n8n.cloud/healthz` every 5 minutes (pg_cron job `n8n-health-probe`, pg_net) and evaluates the results 2 minutes later (`n8n-health-eval`). Two failed probes in a row (about 10-15 minutes of downtime) raise the dashboard banner "n8n не отвечает: бот не работает" (`bot_alerts`, node `n8n-health`); it clears on the first healthy probe. Probes are stored in `public.n8n_health` for 3 days. Limit: this is a dashboard banner only. It does not send a phone notification, so someone has to have the dashboard open. For push alerts add an external uptime service (for example UptimeRobot) on the same URL.

## Saving n8n executions (2026-11-19)

Every WhatsApp webhook hit is one n8n execution. About two thirds of the main workflow's runs were delivery receipts ("sent", "delivered", "read"), which only update the ticks in the dashboard; on 2026-11-18 the main workflow ran about 1,030 times in 20 hours (about 35-40k a month at that pace; the plan has 50,000). The `WhatsApp Trigger` node now has the option "Receive Message Status Updates" set to `failed` and `delivered` (`options.messageStatusUpdates`), so n8n no longer starts a run for "sent" or "read" receipts (the node answers Meta without running the workflow, so they do not count). Effect: roughly 40% fewer executions. Trade-off: the dashboard no longer shows the blue "Прочитано" ticks (status stops at "delivered"). To bring read ticks back, add `read` to that option (costs about one more execution per message). Do not remove the trigger node: deleting it makes n8n delete the Meta webhook subscription.

## Class hours and USA payment (owner, 2026-11-19)

- **Class hours cannot be changed.** We coordinate the hours across students' time zones; the time is ideal for Kyrgyzstan and Europe. The bot says so kindly and points to the recordings. Block `CLASS HOURS` in the `Build Persona` wrapper node. Tested in English, Kyrgyz and Russian.
- **USA numbers pay by Zelle, never QR.** If the WhatsApp number starts with 1 (USA, and also Canada), the bot gives the Zelle instructions (571.249.3974, USD price, screenshot of the transfer) and never offers the QR. Two layers: the prompt block `PAYMENT FOR USA NUMBERS` in the wrapper, and a hard guard in the `Wants Payment QR?` node (it never sends the QR image to a sender starting with 1, even if the AI adds the marker). The USA path could not be tested live because test chats must use 99900 numbers; the non-USA QR path was re-tested and still works.

**Payment by region (owner, 2026-11-19; replaces the USA-only rule above).** The method depends on the WhatsApp number: starts with 1 (USA and Canada) -> Zelle AND PayPal, no QR; European country code (30-34, 36, 39-41, 43-49, 350-359, 370-373, 375-379, 380-387, 389, 420, 421, 423) -> PayPal only, no QR, no Zelle; 7 (Russia/Kazakhstan) keeps the Russia rules; everything else (Kyrgyzstan and the rest) -> QR as before, PayPal on request. Two layers: block `PAYMENT BY REGION` in the `Build Persona` wrapper, and a hard guard in the `Wants Payment QR?` node (a regex on the sender number) that never sends the QR image to +1 or European numbers. Not covered, so they still get QR: Turkey, the Caucasus (Armenia, Georgia), Egypt, Korea and other non-European codes. The regional prompt path could not be tested live (test chats use 99900 numbers); the guard regex was checked on sample numbers.

**Payment closing line (owner, 2026-11-19).** Every payment message (QR, PayPal, Zelle) now ends by motivating the customer instead of saying "команда проверит / the team will check": after paying and letting us know here, "we will start the onboarding process and send you pre-class material that will help you prepare for the first class". Block `PAYMENT CLOSING LINE` in the `Build Persona` wrapper (overrides the layout example in `Build Persona Raw`). No delivery time is promised and the bot still never says a payment was received. This promise is kept by the after-payment sequence (workflow 10): the manager presses "Купил" and picks the option in the dashboard so the welcome and prep messages go out.

## AI identity answer and Russia with VPN (owner, 2026-11-19)

- **AI identity.** The bot never says it is an AI unless asked. When a customer asks if it is a bot, robot, AI or real person it answers with one short true sentence and continues: Kyrgyz «Мен AI жардамчымын.», Russian «Я AI-помощник.», English "I'm an AI assistant." It never claims or implies to be human (the owner's rule, and EU/WhatsApp rules require it). Block `AI IDENTITY ANSWER` in the `Build Persona` wrapper.
- **Russia + VPN (simplified later the same day).** Replaces the old "careful about accepting students from Russia" rule. A customer in Russia is told that Google AI Studio and Claude may not open without a VPN and to try one: if both open, they can study. The bot names one VPN, DarkFlow, with no link, and says they can find their own VPN if they wish. No expiry date any more (the earlier version with the gift links and a 20.11.2026 deadline was removed). No QR, PayPal or Zelle details are sent to a customer in Russia: the chat is flagged so the team arranges the payment. The bot never promises that a VPN works. Block `RUSSIA AND VPN` in the `Build Persona` wrapper.

## iOS course and Mac (owner, 2026-11-19)

When a customer asks about the iOS course (building iPhone/iOS apps), the bot says early that it is important to have a Mac (MacBook or Mac desktop) and asks if they have one. It has no other iOS course facts (price, dates, program, link), so it invents none and flags the chat for the team. For the main web course the "any ordinary laptop, Windows 7 is fine" facts still apply. Block `IOS COURSE AND MAC` in the `Build Persona` wrapper. TODO: give the bot the iOS course details (price, start date, program, page link) so it can sell it.

**iOS course availability (owner, 2026-11-19):** right now the iOS course is available only as a recording; there are no live classes for it. The bot says this together with the Mac requirement (block `IOS COURSE` in the `Build Persona` wrapper). Price, dates and the page link are still unknown to the bot, so it invents none and flags the chat.

**iOS course facts (owner, 2026-11-19; source https://ios.getforce.org/).** Replaces the earlier iOS paragraphs. Block `IOS COURSE` in the `Build Persona` wrapper. The bot says: AI-first course for beginners (design in Google Stitch, build SwiftUI with Claude Code / Claude Desktop, publish to the App Store), 15 days, six chapters; no coding or iPhone needed (Xcode simulator); right now it is available only as a recording (no live classes); $200 (about 17 500 som), one-time, lifetime access, private Discord, completion certificate; needs a Mac (not Windows), stable internet and about 6 hours a week; outside costs are disclosed honestly: Apple Developer account about $99 per year and a Claude subscription about $50. The page link is shared once per chat; payment uses the normal regional flow with $200. The bot never repeats the page's income claims, never promises App Store approval or earnings, and flags a manager only if asked about a refund policy, a start date or live-plan details (the page also lists a $349 Live plan that is not available now, and shows no refund policy).

## Wrong phone clock made the bot skip a greeting (2026-11-19)
Symptom: a customer's "Саламатсызбы" got no reply and the dashboard banner said the bot had not answered. Cause: the customer's
phone clock was wrong, so WhatsApp stamped the message 04:55:12, older than their previous message (04:55:31). The "answer once"
check (`pending_customer_input`) ordered messages by that sender timestamp, decided a newer message existed and dropped the run.
Fix: the check now orders and compares by arrival time (`created_at`, our server clock). Migration 20261119000026.
Note: `last_inbound_at` still uses the sender timestamp, so for such a phone it can read earlier than real; this errs on the safe side
for the 24-hour free-reply window.

## VIP pitch for the 1:1 mentorship (2026-11-19)
The "Build Persona" wrapper in workflow 1 has a `VIP PITCH` block. When a customer asks about the 1:1 mentorship, wants faster results or
compares options, the bot presents it as the VIP experience: 👑 opening line, an emoji list (weekly 1:1 calls with Seyitbek, direct access
in WhatsApp/Telegram, code review of their project, individual plan with career and portfolio help, all Live classes, the $500 earnings
guarantee), the price *$2,500* (≈ 218 750 сом), a closing line about a personal mentor, and one question about their goal. A Kyrgyz model
wording is included in the block; the bot adapts it and does not repeat the full block in the same chat. In a plain price list it stays
one short line. It never invents the number or length of calls, schedules, response times, bonuses or guarantee conditions.
Published as n8n version 6260cb47. Tested in Kyrgyz (full pitch) and Russian price list (one line).

## Student example: Stalbek (2026-11-20)
The "Build Persona" wrapper has a `STUDENT EXAMPLE, STALBEK` block (n8n version 2e0df4a6). Facts confirmed by the owner: Stalbek, one of our
students, owns a T-shirt printing shop in Bishkek (Panurtex); he created a website himself where customers design their own T-shirts, the first
of its kind in Kyrgyzstan, which saved him about $3,000 in developer costs. The bot uses it when a customer doubts they can build something
real, is not technical, asks if learning beats hiring a developer, or is a business owner who needs a site or app. Rules: once per chat, never
in the first reply (same as the $2,000 story), nothing invented beyond these facts, no link or contact for him, no promise of the same result.
Tested in Kyrgyz: first reply had no story, the doubt question got it in two short lines plus a question about their project.

## Som prices updated (2026-11-20)
Owner set: $249 = 22,000 som (was 21,788) and $349 = 30,700 som (was 30,538). $2,500 = 218,750 som is unchanged. The old amounts are still
written in the "Build Persona Raw" prompt ("SOM PRICES"); the "Build Persona" wrapper rewrites them on every message with a regex
(21 788 -> 22 000, 30 538 -> 30 700, any thousands separator). To change prices again, edit the replacements in the wrapper's `fixed` line, or
better, edit "SOM PRICES" in Build Persona Raw and delete the replacements. n8n version 27f0af37. Tested in Kyrgyz and Russian.

Update (same day): $2,500 is now 220,000 som (about 88 som per dollar, in line with 22,000 and 30,700). The wrapper now applies all three
replacements (21 788 -> 22 000, 30 538 -> 30 700, 218 750 -> 220 000) over the whole prompt, so the VIP pitch text is covered too.
n8n version 73f3e98c. The iOS course line ("$200, about 17 500 som") still uses the old rate; at 88 it would be about 17 600.

Update (2026-11-20): the iOS course line in the wrapper now says $200 is about 17 600 som (same rate, about 88 som per dollar). n8n version 373ff64b.
All course prices in som: $249 = 22,000, $349 = 30,700, $2,500 = 220,000, iOS $200 = 17,600.

## Product explainer for Recordings and Live (2026-11-20)

Customers did not see the value of Recordings and Live classes when they were only listed. The "Build Persona" wrapper in n8n workflow 1 (version 58ab0f1b) now appends a PRODUCT EXPLAINER block. When a customer asks about formats, what is included, the difference, or hesitates, the bot explains each option and its value (Recordings: video lessons, any time, rewatch, own pace, curator help and tech support in the private group; Live: Zoom classes with Seyitbek Mon/Wed/Fri 20:00 Bishkek, starts November 27, instant answers, recordings kept, group support, includes everything in Recordings). For a bare price question it gives one value phrase per option and offers to explain. It never states the number of live classes (earlier owner rule). Wording came from the owner's Kyrgyz course announcement.

## Manata example and "what you learn and build" block (2026-11-20)

Two more blocks in the n8n "Build Persona" wrapper (workflow 1, version 65fa8591):
- STUDENT EXAMPLE, MANATA: a student built an online store (working site, deployed, with a database, a portfolio piece) and got a real $42 order. Rules: at most one student story per reply, each story once per chat, never in the first reply, no shop name, links or customer details, no promise of the same result. The owner's screenshot of the order contained a customer's address; none of it is in the bot or the repo.
- WHAT STUDENTS LEARN AND BUILD: the seven stages (idea, design, the site itself, database and login, AI inside the app, polish and payments, launch and Demo Day) taken from the teacher agenda of the ai-accelerator repo, plus six real student projects described without links or earnings. The bot still does not state the number of live classes (the sales page says 7, the teacher agenda lists 14 classes, so the number is left out on purpose).

## Average student earnings claim: $600 (2026-11-20)

Added to the "Build Persona" wrapper (n8n version 6e4a65bc) at the owner's request, taken from the course sales page: "on average, students sign 2 contracts and earn about $600 before the course ends". The bot says it only as an average of past students, always with "results depend on the person", at most once per chat, never in the first reply, never as a monthly figure, never multiplied, never tied to the 1:1 plan. If asked, it says plainly that it is an average and not a guarantee. The only guarantee stays the $500 for the 1:1 mentorship. If the figure stops being true, edit the `avg` block in the wrapper.

## First-class refund wording and Discord (2026-11-20)

Added a REFUND AND DISCORD block to the "Build Persona" wrapper (n8n version 0ffdd5d1). Owner-confirmed: if after the first class the student does not like the program, they get a full refund. The bot says "full refund" plainly when asked about refunds or risk, still gives no processing time, fees or method, and keeps the Live Demo Day guarantee separate. The students' community is a private Discord community (the bot no longer says "private group"); no Discord link is given before payment.

## The seven real lessons replace the earlier curriculum block (2026-11-20)

The "what students learn" block in the n8n "Build Persona" wrapper (version 2ae2f06c) now follows the official recorded-lessons plan (the recordings page of the ai-accelerator app), not the teacher agenda: 1 Google AI Studio and games, 2 a business website (barbershop example: map, chatbot, 3 languages), 3 moving to Claude via GitHub and publishing on Vercel, 4 premium prototype in Google Stitch, 5 finding clients with AI (homework: 1 client by talking to 15 people), 6 Stripe, Resend, Supabase, Finik KG, 7 final project, launch, Arena AI, Replicate, student stories. Every lesson has the class, Q&A, topics and homework shared in Discord. The bot may now say the program has 7 lessons (this lifts the earlier "never state the number" rule); it still gives no lesson length. The "$1,000/Month AI Entrepreneur, 83 lessons" program linked on that page is a different product and is not in the bot.
