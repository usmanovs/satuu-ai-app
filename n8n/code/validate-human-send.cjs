// n8n Code node placed right after the "Human send" Webhook node, BEFORE anything is acknowledged
// or sent. (The Webhook node's Header Auth credential already rejects unauthenticated callers with
// 403 before the workflow runs; this validates the shape and the business.)
//
// On { ok: false } route to a "Respond to Webhook" node that returns { status, error }.
// On { ok: true } continue to the claim-human-send HTTP node. The recipient and the text are NOT
// taken from this body: they come back from claim-human-send (the database is the authority).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateHumanSend(body, expectedBusinessId, headerKey) {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'invalid_body' };
  if (body.event !== 'human_reply') return { ok: false, status: 422, error: 'invalid_event' };
  if (!expectedBusinessId || body.business_id !== expectedBusinessId) return { ok: false, status: 403, error: 'business_mismatch' };
  if (typeof body.idempotency_key !== 'string' || !UUID.test(body.idempotency_key)) return { ok: false, status: 422, error: 'invalid_idempotency_key' };
  if (headerKey !== undefined && headerKey !== body.idempotency_key) return { ok: false, status: 422, error: 'idempotency_key_mismatch' };
  if (body.type !== 'text' && body.type !== 'template') return { ok: false, status: 422, error: 'invalid_type' };
  let templateLanguage = null;
  if (body.type === 'template') {
    templateLanguage = body.template?.language;
    if (typeof templateLanguage !== 'string' || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(templateLanguage)) {
      return { ok: false, status: 422, error: 'invalid_template_language' };
    }
  }
  return { ok: true, value: { idempotency_key: body.idempotency_key, type: body.type, template_language: templateLanguage } };
}

if (typeof module !== 'undefined') module.exports = { validateHumanSend };

// --- n8n wrapper (uncomment inside the Code node; delete the module.exports line above) ---
// const body = $input.first().json.body;
// const headerKey = $input.first().json.headers?.['idempotency-key'];
// return [{ json: validateHumanSend(body, $vars.SATUU_BUSINESS_ID, headerKey) }];
