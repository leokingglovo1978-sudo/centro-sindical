import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PUENTE: pg_cron (Supabase) -> esta ruta (Vercel) -> Relevance AI
// Necesario porque el resolvedor DNS de Supabase no resuelve api.relevanceai.com,
// pero Vercel si tiene salida fiable a internet.
export async function POST(req: NextRequest) {
  // 1. Autenticación: solo el cron puede llamar
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 2. Recoge hasta 300 mensajes pendientes y márcalos enviados
  const { data: rows, error: readErr } = await supabase
    .from("messages")
    .select("id, chat_id, sent_at, content_type, body")
    .eq("content_type", "text")
    .is("dispatched_at", null)
    .order("sent_at", { ascending: true })
    .limit(300);

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ sent: 0 });

  // 3. Envía a Leonardo (Relevance AI) — fire and forget
  const relevanceRes = await fetch(process.env.RELEVANCE_WEBHOOK_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RELEVANCE_API_KEY}`,
    },
    body: JSON.stringify({ messages: rows }),
  });

  if (!relevanceRes.ok) {
    const body = await relevanceRes.text().catch(() => "");
    return NextResponse.json(
      { error: `relevance ${relevanceRes.status}`, detail: body.slice(0, 300) },
      { status: 502 }
    );
  }

  // 4. Solo marcamos enviados si Relevance aceptó
  const ids = rows.map((r) => r.id);
  const { error: updErr } = await supabase
    .from("messages")
    .update({ dispatched_at: new Date().toISOString() })
    .in("id", ids);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ sent: rows.length });
}