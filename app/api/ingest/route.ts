// app/api/ingest/route.ts
// POST multipart/form-data: file (.txt export) + source_label + uploaded_by
// Pipeline: parse → anonimizar → deduplicar → insertar → marcar chat procesado.
// Tras esto, un job (pg_cron o cron de Vercel) envía los mensajes nuevos al agente.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  parseWhatsappExport,
  dedupHash,
  authorHash,
} from "@/lib/parseWhatsappExport";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service role: bypassa RLS para ingesta
);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const sourceLabel = (form.get("source_label") as string) || null;
  const uploadedBy = (form.get("uploaded_by") as string) || "desconocido";

  if (!file) return NextResponse.json({ error: "file requerido" }, { status: 400 });

  const raw = await file.text();
  if (raw.length > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "export demasiado grande (max 20MB)" }, { status: 413 });
  }

  // 1) Crear lote
  const { data: chat, error: chatErr } = await supabase
    .from("chats")
    .insert({ filename: file.name, source_label: sourceLabel, uploaded_by: uploadedBy })
    .select()
    .single();
  if (chatErr || !chat) {
    return NextResponse.json({ error: chatErr?.message }, { status: 500 });
  }

  try {
    // 2) Parsear
    const { messages, stats } = parseWhatsappExport(raw);

    // 3) Anonimizar + deduplicar
    const rows = await Promise.all(
      messages.map(async (m) => ({
        chat_id: chat.id,
        sent_at: m.sentAt.toISOString(),
        author_hash: await authorHash(chat.author_salt, m.author),
        content_type: m.contentType,
        body: m.body.slice(0, 4000),
        dedup_hash: await dedupHash(chat.id, m.sentAt, await authorHash(chat.author_salt, m.author), m.body),
      }))
    );

    // 4) Insertar ignorando duplicados (misma export subida 2 veces)
    let inserted = 0;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { data, error } = await supabase
        .from("messages")
        .upsert(rows.slice(i, i + CHUNK), { onConflict: "dedup_hash", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      inserted += data?.length ?? 0;
    }

    // 5) Cerrar lote
    await supabase
      .from("chats")
      .update({ status: "processed", message_count: inserted })
      .eq("id", chat.id);

    return NextResponse.json({
      chat_id: chat.id,
      inserted,
      skipped_duplicates: messages.length - inserted,
      stats,
    });
  } catch (e: any) {
    await supabase.from("chats").update({ status: "failed" }).eq("id", chat.id);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}