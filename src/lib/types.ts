export type ConvState = 'ai_active' | 'human_requested' | 'human_handling';
export type MsgStatus = 'received' | 'pending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
export type SenderRole = 'customer' | 'ai' | 'manager';
export type StateAction = 'takeover' | 'resume' | 'mark_read';
export type LeadLabel = 'cold' | 'warm' | 'hot';
export type Outcome = 'won' | 'lost';

export interface Conversation {
  id: string;
  business_id: string;
  contact_id: string;
  state: ConvState;
  state_version: number;
  state_updated_at: string;
  state_note: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  manager_last_read_at: string | null;
  /** AI estimate of buying likelihood, 0-100. An estimate, not a probability. */
  lead_score: number | null;
  lead_label: LeadLabel | null;
  lead_reason: string | null;
  lead_scored_at: string | null;
  /** Set by a manager: the real result. */
  outcome: Outcome | null;
  outcome_at: string | null;
  contacts: { wa_id: string; display_name: string | null };
}

export interface Message {
  id: string;
  conversation_id: string;
  provider_message_id: string | null;
  idempotency_key: string | null;
  sender_role: SenderRole;
  direction: 'inbound' | 'outbound';
  message_type: string;
  body: string;
  is_placeholder: boolean;
  template_name: string | null;
  message_timestamp: string;
  status: MsgStatus;
  status_updated_at: string;
  error_code: string | null;
  error_message: string | null;
}

export interface IntegrationStatus {
  /** n8n human-reply webhook configured on the server (presence only, reachability is not probed) */
  send_configured: boolean;
  template_configured: boolean;
  /** Last time n8n asked "may the AI answer?" — null means n8n has never called. */
  last_ai_check_at: string | null;
  last_ingest_at: string | null;
}

export type OutcomeResult = { ok: true; outcome: Outcome | null } | { ok: false; error: string };

export type ActionResult = { ok: true; state: ConvState } | { ok: false; error: string };

export type SendResult =
  | { kind: 'accepted'; message: Message }
  /** Result unknown (n8n 5xx/timeout): message stays pending, nothing is retried automatically. */
  | { kind: 'unconfirmed'; message: Message }
  | { kind: 'failed'; message: Message; error: string }
  /** Refused before anything was created (wrong state, window closed, not connected, ...). */
  | { kind: 'rejected'; error: string; code: string }
  /** Could not reach our backend at all. The send may or may not have happened. */
  | { kind: 'network'; error: string };

export interface SendInput {
  conversationId: string;
  idempotencyKey: string;
  text?: string;
  useTemplate?: boolean;
}

export type ChangeEvent = { table: 'conversations' | 'messages' | 'contacts'; conversationId?: string };

export interface InboxBackend {
  mode: 'live' | 'demo';
  listConversations(): Promise<Conversation[]>;
  listMessages(conversationId: string): Promise<Message[]>;
  subscribe(onChange: (e: ChangeEvent) => void, onStatus: (s: 'on' | 'off') => void): () => void;
  action(conversationId: string, action: StateAction): Promise<ActionResult>;
  setOutcome(conversationId: string, outcome: Outcome | 'open'): Promise<OutcomeResult>;
  sendReply(input: SendInput): Promise<SendResult>;
  integrationStatus(): Promise<IntegrationStatus>;
}
