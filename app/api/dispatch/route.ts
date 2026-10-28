import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PUENTE: pg_cron (Supabase) -> esta ruta (Vercel) -> Relevance AI
// Necesario porque el resolvedor DNS de Supabase no resuelve api-d7b62b.stack.tryrelevance.com
// de forma fiable, pero Vercel si tiene salida a internet.
// Formato del body segun documentacion oficial de Relevance AI (Trigger agent API).
const AGENT_ID = "07426c03-c887-4d84-9d17-1b1f6597e8a5";

export async function POST(req: NextRequest) {
  // 1. Autenticacion: solo el cron puede llamar
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 2. Recoge hasta 300 mensajes pendientes
  const { data: rows, error: readErr } = await supabase
    .from("messages")
    .select("id, chat_id, sent_at, content_type, body")
    .eq("content_type", "text")
    .is("dispatched_at", null)
    .order("sent_at", { ascending: true })
    .limit(300);

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ sent: 0 });

  // 3. Envía a Leonardo en el formato documentado por Relevance AI
  const relevanceRes = await fetch(process.env.RELEVANCE_WEBHOOK_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.RELEVANCE_API_KEY!, // SIN "Bearer"
    },
    body: JSON.stringify({
      message: {
        role: "user",
        content: JSON.stringify({ messages: rows }), // el lote va como texto
      },
      agent_id: AGENT_ID,
    }),
  });

  if (!relevanceRes.ok) {
    const body = await relevanceRes.text().catch(() => "");
    return NextResponse.json(
      { error: `relevance ${relevanceRes.status}`, detail: body.slice(0, 300) },
      { status: 502 }
    );
  }

  // 4. Solo marcamos enviados si Relevance acepto
  const ids = rows.map((r) => r.id);
  const { error: updErr } = await supabase
    .from("messages")
    .update({ dispatched_at: new Date().toISOString() })
    .in("id", ids);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ sent: rows.length });
}