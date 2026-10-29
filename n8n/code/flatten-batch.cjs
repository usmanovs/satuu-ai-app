// n8n Code node, mode "Run Once for All Items". Place it right after the WhatsApp Trigger.
//
// A WhatsApp webhook delivery is a BATCH: entry[] -> changes[] -> value, and each `value` can hold
// several messages[] AND several statuses[]. Reading only messages[0] / statuses[0] silently drops
// the rest. This node turns the batch into ONE n8n item per message or per status, in timestamp
// order. Everything downstream (ingest, permission check, AI, send, record, receipts) then runs per
// item, so each message/status is processed independently and exactly like a single one.
//
// Accepts either the raw Cloud API body ({ entry: [...] }) or the n8n WhatsApp Trigger's output
// (the `value` object: { messages, contacts, statuses }). Verify the shape on one real execution.

const STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

function textOf(m) {
  if (m.type === 'text') return m.text?.body ?? null;
  if (m.type === 'button') return m.button?.text ?? null;
  if (m.type === 'interactive') return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
  return m[m.type]?.caption ?? null; // image/video/document caption, otherwise null
}

function valuesOf(json) {
  if (json?.body?.entry) return valuesOf(json.body); // webhook node wraps the payload in `body`
  if (json?.entry) {
    return json.entry.flatMap((e) =>
      (e.changes ?? []).filter((c) => !c.field || c.field === 'messages').map((c) => c.value ?? {}));
  }
  return [json ?? {}];
}

function flattenBatch(jsonItems) {
  const out = [];
  for (const json of jsonItems) {
    for (const v of valuesOf(json)) {
      const names = new Map((v.contacts ?? []).map((c) => [String(c.wa_id), c.profile?.name ?? null]));
      for (const m of v.messages ?? []) {
        out.push({
          kind: 'message', sender_id: String(m.from), provider_message_id: m.id, type: m.type ?? 'text',
          text: textOf(m), timestamp: m.timestamp, display_name: names.get(String(m.from)) ?? null,
        });
      }
      for (const s of v.statuses ?? []) {
        if (!STATUSES.has(s.status)) continue; // ignore 'deleted', 'warning', ...
        const e = s.errors?.[0];
        out.push({
          kind: 'status', provider_message_id: s.id, status: s.status, timestamp: s.timestamp,
          error_code: e?.code != null ? String(e.code) : null, error_message: e?.title ?? e?.message ?? null,
        });
      }
    }
  }
  return out.sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0)); // stable
}

if (typeof module !== 'undefined') module.exports = { flattenBatch };

// --- n8n wrapper (uncomment inside the Code node; delete the module.exports line above) ---
// return flattenBatch($input.all().map((i) => i.json)).map((json) => ({ json }));
