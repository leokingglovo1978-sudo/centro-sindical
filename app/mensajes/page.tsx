import { createClient } from "@supabase/supabase-js";

// Página DEL SERVIDOR: la clave service_role solo existe en Vercel, jamás en el navegador.
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function Mensajes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  let query = supabase
    .from("messages")
    .select("id, sent_at, author_hash, content_type, body, chats(source_label, filename)", { count: "exact" })
    .order("sent_at", { ascending: false })
    .limit(200);
  if (q) query = query.ilike("body", `%${q}%`);
  const { data: rows, count } = await query;

  return (
    <main style={{ maxWidth: 900, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui" }}>
      <p><a href="/" style={{ color: "#60a5fa" }}>← Subir otra exportación</a></p>
      <h1>Mensajes procesados</h1>
      <p style={{ color: "#94a3b8" }}>
        {(count ?? 0).toLocaleString("es")} mensajes en la base de datos · mostrando los últimos 200
        {q ? ` · filtrados por “${q}”` : ""}
      </p>
      <form method="GET" action="/mensajes" style={{ marginBottom: "1rem" }}>
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar (ej: pago, bloqueo, Almería...)"
          style={{
            width: "70%", padding: "0.7rem", borderRadius: 6,
            border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0",
          }}
        />
        <button type="submit" style={{
          marginLeft: "0.5rem", padding: "0.7rem 1rem", borderRadius: 6, border: 0,
          background: "#16a34a", color: "white", cursor: "pointer",
        }}>Buscar</button>
      </form>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#94a3b8" }}>
            <th style={{ padding: "0.5rem" }}>Fecha</th>
            <th style={{ padding: "0.5rem" }}>Grupo</th>
            <th style={{ padding: "0.5rem" }}>Autor</th>
            <th style={{ padding: "0.5rem" }}>Mensaje</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r: any) => (
            <tr key={r.id} style={{ borderTop: "1px solid #1e293b", verticalAlign: "top" }}>
              <td style={{ padding: "0.5rem", whiteSpace: "nowrap", color: "#94a3b8" }}>
                {new Date(r.sent_at).toLocaleString("es")}
              </td>
              <td style={{ padding: "0.5rem", color: "#93c5fd" }}>
                {r.chats?.source_label ?? r.chats?.filename ?? "—"}
              </td>
              <td style={{ padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#94a3b8" }}>
                {r.author_hash.slice(0, 8)}…
              </td>
              <td style={{ padding: "0.5rem", maxWidth: 480 }}>
                {r.content_type === "media" ? <em style={{ color: "#f59e0b" }}>[multimedia]</em> : r.body}
              </td>
            </tr>
          ))}
          {(rows ?? []).length === 0 && (
            <tr><td colSpan={4} style={{ padding: "1rem", color: "#94a3b8" }}>Sin resultados.</td></tr>
          )}
        </tbody>
      </table>
    </main>
  );
}