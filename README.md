# Centro Inteligente de Información Sindical — Vía 2 (ingesta manual)

Sistema de análisis de exportaciones de WhatsApp para equipo sindical.
Sin automatización de WhatsApp, sin riesgo de baneo, con anonimización
de datos personales desde el primer paso.

## Estructura

- `supabase/migrations/001_schema.sql` — tablas: chats, messages, incidencias,
  incidencia_mensajes, evidencias, audit_log. RLS activado.
- `supabase/migrations/002_agent_job.sql` — pg_cron que envía lotes de
  mensajes nuevos al agente de Relevance AI cada 15 min (vía pg_net + Vault).
- `lib/parseWhatsappExport.ts` — parser Android/iOS (12h y 24h), multilínea,
  detecta media/system, anonimiza autores (sha256 con salt por chat).
- `app/api/ingest/route.ts` — POST multipart: recibe el .txt, parsea,
  deduplica (misma export subida 2 veces = 0 duplicados) e inserta.
- `relevance-ai/agent-clasificador.md` — prompt del agente: categorías de la
  sección 3 del documento, distinción hecho/testimonio/hipótesis/rumor,
  regla "mensajes ≠ casos".

## Puesta en marcha

1. Supabase: SQL Editor → ejecutar `001_schema.sql` y `002_agent_job.sql`.
2. Supabase → Storage → crear bucket privado `evidencias`.
3. Vault: `select vault.create_secret('TU_WEBHOOK_RELEVANCE', 'AGENT_WEBHOOK_URL');`
4. En Relevance AI: crear agente con el prompt de `agent-clasificador.md`,
   exponerlo como webhook con URL para recibir, y dar de alta la tool que
   escriba las fichas resultantes en la tabla `incidencias` (service role).
5. `.env.local`:
   NEXT_PUBLIC_SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
6. `npm i @supabase/supabase-js` y subir a Vercel.

## Flujo

delegado exporta chat (.txt, sin archivos) → sube al panel
→ /api/ingest parsea y anonimiza → messages
→ pg_cron (cada 15 min) envía lote al agente de Relevance AI
→ agente devuelve fichas JSON → se insertan en incidencias
→ revisor humano valida estados (pendiente → verificada/descartada)
→ evidencias se suben a Storage privado vinculadas a la ficha

## Notas RGPD
- Nombres de remitentes jamás se almacenan: solo hash con salt por chat.
- RLS activado: ajusta políticas según roles (admin territorial, revisor...).
- Los .txt originales se procesan en memoria y se descartan; no se guardan.
- Define plazos de conservación en `messages` (p. ej. purge > 90 días) y
  regístralo en `audit_log`.