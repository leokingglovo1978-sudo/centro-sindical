import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Endpoint robusto para que la tool guardar_ficha de Relevance AI
// guarde incidencias sin depender de headers de Supabase desde Relevance.
// Autenticado con la misma x-cron-secret que el puente dispatch.
export async function POST(req: NextRequest) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body no es JSON valido" }, { status: 400 });
  }

  // Coercion de tipos: la tool envia todo como texto, aqui lo convertimos
  const ficha = {
    asunto: String(body.asunto ?? "").slice(0, 500),
    resumen: String(body.resumen ?? "").slice(0, 4000),
    categoria: String(body.categoria ?? "incidencias_operativas"),
    zona: body.zona ? String(body.zona).slice(0, 200) : null,
    urgencia: Math.min(3, Math.max(1, parseInt(body.urgencia, 10) || 2)),
    grado_confirmacion: ["hecho_confirmado", "testimonio", "hipotesis", "rumor"].includes(body.grado_confirmacion)
      ? body.grado_confirmacion
      : "testimonio",
    estado: "pendiente",
    volumen_mensajes: parseInt(body.volumen_mensajes, 10) || 0,
    casos_unicos: parseInt(body.casos_unicos, 10) || 0,
    agent_output: String(body.agent_output ?? "").slice(0, 8000),
  };

  if (!ficha.asunto || !ficha.resumen) {
    return NextResponse.json({ error: "asunto y resumen son obligatorios" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from("incidencias")
    .insert(ficha)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}