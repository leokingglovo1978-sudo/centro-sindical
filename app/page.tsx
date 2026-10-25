'use client';

import { useState } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setResult("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("source_label", label);
      form.append("uploaded_by", "delegado-piloto");
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const data = await res.json();
      setResult(res.ok ? `✅ Procesado: ${data.inserted} mensajes guardados (${data.skipped_duplicates} duplicados omitidos)` : `❌ Error: ${data.error}`);
    } catch (err: any) {
      setResult(`❌ Error de red: ${err.message}`);
    }
    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 520, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Centro Sindical — Subir exportación</h1>
      <p style={{ color: "#94a3b8" }}>
        Exporta el chat en WhatsApp (Exportar chat → Sin archivos) y sube aquí el .txt
      </p>
      <form onSubmit={handleUpload} style={{ display: "grid", gap: "1rem" }}>
        <input
          type="text"
          placeholder='Etiqueta (ej: "Riders Almería - pagos")'
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ padding: "0.6rem", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0" }}
        />
        <input
          type="file"
          accept=".txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ padding: "0.6rem" }}
        />
        <button
          type="submit"
          disabled={!file || loading}
          style={{ padding: "0.7rem", borderRadius: 6, border: 0, background: "#16a34a", color: "white", cursor: "pointer" }}
        >
          {loading ? "Procesando..." : "Subir y procesar"}
        </button>
      </form>
      {result && <p style={{ marginTop: "1rem" }}>{result}</p>}
    </main>
  );
}
