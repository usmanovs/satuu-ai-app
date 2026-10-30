#!/usr/bin/env bash
# Creates one WhatsApp message template through the Graph API, for the Meta App Review video.
# The access token is typed hidden and is never printed. Run it while screen recording.
set -euo pipefail

WABA_ID="${WABA_ID:-2138597716693128}"          # WhatsApp Business Account id
NAME="${1:-followup_after_window}"                # template names are unique: pass another name to run it again
API="https://graph.facebook.com/v25.0"

read -r -s -p "Paste the WhatsApp access token (hidden), then press Enter: " WA_TOKEN
echo; echo

BODY=$(cat <<JSON
{
  "name": "$NAME",
  "language": "ru",
  "category": "UTILITY",
  "components": [
    { "type": "BODY",
      "text": "Здравствуйте! Мы на связи по вашему вопросу о курсе. Если он ещё актуален, ответьте на это сообщение, и менеджер продолжит диалог." }
  ]
}
JSON
)

echo "POST $API/$WABA_ID/message_templates"
echo "Authorization: Bearer ********"
echo "Content-Type: application/json"
echo "$BODY" | python3 -m json.tool
echo
echo "--- Response ---"
curl -sS -X POST "$API/$WABA_ID/message_templates" \
  -H "Authorization: Bearer $WA_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY" | python3 -m json.tool
