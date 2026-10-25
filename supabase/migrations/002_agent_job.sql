-- supabase/migrations/002_agent_job.sql
-- Paso mensajes nuevos al agente de Relevance AI en lotes (cada 15 min).
-- Requiere: extension pg_net (habilitada por defecto en Supabase) y el
-- secret AGENT_WEBHOOK_URL en Vault:
--   select vault.create_secret('https://api.relevanceai.com/...', 'AGENT_WEBHOOK_URL');

create extension if not exists pg_net;

create or replace function dispatch_to_agent()
returns void language plpgsql security definer as $$
declare
  webhook text;
  batch jsonb;
begin
  select decrypted_secret into webhook from vault.decrypted_secrets
  where name = 'AGENT_WEBHOOK_URL';

  with pending as (
    select m.id, m.chat_id, m.sent_at, m.content_type, m.body
    from messages m
    left join incidencia_mensajes im on im.message_id = m.id
    where im.message_id is null
      and m.content_type = 'text'
    limit 300
  )
  select coalesce(jsonb_agg(pending.*), '[]'::jsonb) into batch from pending;

  if jsonb_array_length(batch) > 0 then
    perform net.http_post(
      url := webhook,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object('chat_id', null, 'messages', batch)
    );
  end if;
end $$;

-- Cron: cada 15 minutos
select cron.schedule('dispatch-to-agent', '*/15 * * * *', $$select dispatch_to_agent()$$);