-- ============================================
-- Centro Inteligente de Información Sindical
-- Vía 2: ingesta manual de exportaciones de WhatsApp
-- ============================================

-- Lotes de exportación (cada .txt subido)
create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  source_label text,               -- etiqueta libre: "Riders Almería - pagos"
  uploaded_by text not null,       -- delegado que sube (auth.users en prod)
  author_salt text not null default encode(gen_random_bytes(16), 'hex'),
  message_count int default 0,
  status text not null default 'pending' check (status in ('pending','processed','failed')),
  created_at timestamptz not null default now()
);

-- Mensajes parseados y anonimizados
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  sent_at timestamptz not null,
  author_hash text not null,       -- sha256(salt || nombre), nunca el nombre real
  content_type text not null check (content_type in ('text','media','system')),
  body text not null default '',
  dedup_hash text not null unique, -- evita insertar el mismo mensaje 2 veces
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_chat on messages(chat_id, sent_at);
create index if not exists idx_messages_author on messages(author_hash);

-- Fichas de incidencias (salida del agente de IA, validadas por humanos)
create table if not exists incidencias (
  id uuid primary key default gen_random_uuid(),
  asunto text not null,
  resumen text not null,
  categoria text not null check (categoria in (
    'cambios_laborales','incidencias_operativas','conflictos_reivindicaciones',
    'informacion_territorial','evidencias','comunicacion','ruido'
  )),
  zona text,                        -- ciudad/zona, null si no aplica
  urgencia int not null default 2 check (urgencia between 1 and 3),  -- 1 alta, 2 media, 3 baja
  grado_confirmacion text not null default 'testimonio' check (grado_confirmacion in (
    'hecho_confirmado','testimonio','hipotesis','rumor'
  )),
  estado text not null default 'pendiente' check (estado in (
    'pendiente','en_verificacion','verificada','descartada'
  )),
  volumen_mensajes int default 0,   -- mensajes relacionados (no equivale a casos)
  casos_unicos int default 0,       -- incidencias diferenciadas
  agent_output jsonb,             -- JSON crudo del agente para trazabilidad
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Vínculo mensajes <-> incidencia (las evidencias citadas en la ficha)
create table if not exists incidencia_mensajes (
  incidencia_id uuid not null references incidencias(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  primary key (incidencia_id, message_id)
);

-- Archivos adjuntos que sube un humano como evidencia
create table if not exists evidencias (
  id uuid primary key default gen_random_uuid(),
  incidencia_id uuid not null references incidencias(id) on delete cascade,
  storage_path text not null,       -- bucket privado 'evidencias' en Supabase Storage
  tipo text not null check (tipo in ('captura','audio','documento','testimonio')),
  uploaded_by text not null,
  created_at timestamptz not null default now()
);

-- Auditoría: quién cambia estados de verificación (sección 8 del documento)
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  entity text not null,           -- 'incidencias' | 'evidencias' | ...
  entity_id uuid not null,
  action text not null,           -- 'create' | 'update_estado' | ...
  changed_by text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Trigger: updated_at de incidencias
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

drop trigger if exists trg_incidencias_updated on incidencias;
create trigger trg_incidencias_updated before update on incidencias
  for each row execute function set_updated_at();

-- Row Level Security (activar en producción con auth)
alter table chats enable row level security;
alter table messages enable row level security;
alter table incidencias enable row level security;
alter table incidencia_mensajes enable row level security;
alter table evidencias enable row level security;
alter table audit_log enable row level security;

-- Bucket privado para evidencias (ejecutar en SQL de Storage o dashboard)
-- insert into storage.buckets (id, name, public) values ('evidencias','evidencias', false);