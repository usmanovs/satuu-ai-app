-- Hot leads waiting for a human, funnel numbers and the weekly sales report (applied 2026-11-17).
-- The full SQL is in the live database: conversations.last_manager_message_at (+ trigger on messages),
-- _funnel(), funnel_stats() (owner only, callable by the signed-in owner), table sales_reports (owner can read),
-- save_sales_report() and weekly_digest_data() (service role only, used by n8n workflow 9).
alter table public.conversations add column if not exists last_manager_message_at timestamptz;
