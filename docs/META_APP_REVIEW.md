# Meta App Review pack (Tech Provider, coexistence)

App: **Sales Bot** (ID 1928846331169700) · Business: **GETFORCE LLC** (verified Oct 29, 2026)
Permissions to request: `whatsapp_business_messaging`, `whatsapp_business_management` (and `public_profile`, already queued).

## App settings to have in place before submitting
| Field | Value |
|---|---|
| Privacy Policy URL | https://satuu-inbox.vercel.app/privacy.html |
| Terms of Service URL | https://satuu-inbox.vercel.app/terms.html |
| User data deletion (instructions URL) | https://satuu-inbox.vercel.app/data-deletion.html |
| App icon | `public/app-icon-1024.png` (1024×1024) |
| Category | Business and pages |
| Contact email | usmanov.seyitbek@gmail.com |

The three pages are real (English plus Russian) and are served from the dashboard's domain. Review them once: the 30-day deletion promise and the "STOP" promise are commitments GETFORCE has to keep. The bot honours STOP and points deletion requests to info@getforce.org.

## Use-case descriptions (paste into the submission)

**whatsapp_business_messaging**
> We run a sales-assistant service for our own business, GETFORCE LLC, which sells online courses. Customers message our WhatsApp Business number with questions. Our app receives each message through the WhatsApp webhook, stores the conversation in our database, and replies through the Cloud API: automated replies come from an assistant, and our sales team can take over a conversation in our shared-inbox dashboard and reply as a human. Every reply is sent only in response to a customer message, within the 24-hour customer service window. We need advanced access so we can send messages from the number our team also uses in the WhatsApp Business app (coexistence) and onboard that number through Embedded Signup.

**whatsapp_business_management**
> We use this permission to onboard our WhatsApp Business account and phone number through Embedded Signup, to read the account's phone number and webhook subscription status, and to create and manage the message templates we use to contact a customer after the 24-hour window. The same dashboard shows the connection status to our team. We only manage accounts owned by GETFORCE LLC.

## Video 1: `whatsapp_business_messaging`  (about 90 seconds)
Required by Meta: the message being sent from our app, and the same message arriving in WhatsApp.
1. Split the screen: the dashboard at https://satuu-inbox.vercel.app (signed in) on the left, WhatsApp (phone mirror or WhatsApp Web) on the right, chat open with the test number.
2. In WhatsApp, send a message to the business number, for example "Hi, when does the next course start?" Show it appearing in the dashboard inbox.
3. Show the automated reply arriving in WhatsApp.
4. In the dashboard, press **Взять диалог**, type "Hello, this is the sales team" and send. Show it arriving in WhatsApp and the status in the dashboard moving to delivered / read.
5. Press **Вернуть AI** to hand the chat back.
Say out loud, or caption: "The app sends and receives WhatsApp messages for our own business through the Cloud API."

## Video 2: `whatsapp_business_management`  (about 60 seconds)
Required by Meta: creating a message template with an API call, as its own recording.
1. Show the API call (curl or Postman) that creates a template on the business's WhatsApp Business Account: `POST /{waba-id}/message_templates` with a name such as `followup_after_window`, category `UTILITY`, language `ru`, a short body.
2. Show the response (status PENDING or APPROVED).
3. Open WhatsApp Manager → Message templates and show the template in the list.
Never show the access token on screen.

## Embedded Signup (v4) and coexistence
After approval: in the Tech Provider page use **Generate link** for the Meta-hosted Embedded Signup, open it on the phone that has the WhatsApp Business app on +1 (240) 255-0596, and choose **Connect to the Business Platform** (coexistence). Then:
1. Activate the n8n workflow "Satuu WhatsApp Echo Receiver" and create its two n8n variables.
2. Set the webhook override for `smb_message_echoes`, `history` and `smb_app_state_sync` to that workflow's URL. `account_update` always goes to the app's default callback.
3. Keep the WhatsApp Business app opened at least once every 14 days.
