// lib/parseWhatsappExport.ts
// Parser de exportaciones de WhatsApp (.txt) — Android e iOS, 12h y 24h.
// Anonimiza autores con sha256(salt + nombre): nunca se persiste el nombre real.

export type ParsedMessage = {
  sentAt: Date;
  author: string;          // nombre original (solo en memoria, jamás en BD)
  contentType: "text" | "media" | "system";
  body: string;
};

export type ParseResult = {
  messages: ParsedMessage[];
  stats: { text: number; media: number; system: number; skipped: number };
};

// Líneas de mensaje cubren los formatos:
// Android: [25/10/2026, 09:15:23] Nombre: texto
// iOS 24h: [25/10/2026 9:15:23] Nombre: texto
// iOS 12h: [25/10/2026, 9:15:23 p. m.] Nombre: texto
const LINE_RE =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+([ap])\.\s?m\.)?\]\s+([^:]+?):\s?([\s\S]*)$/i;

const MEDIA_MARKERS = [
  "<media omitted>",
  "media omitted",
  "archivo adjunto",
  "imagen omitida",
  "audio omitido",
  "video omitido",
  "sticker omitido",
  "archivo omitido",
  "documento omitido",
];

const SYSTEM_PREFIXES = [
  "messages and calls are end-to-end encrypted",
  "los mensajes y las llamadas están cifrados de extremo a extremo",
  "created this group",
  "creó este grupo",
  "you were added",
  "te añadió",
  "changed the subject",
  "cambió el asunto",
  "changed this group's icon",
  "cambió el icono",
  "left",
  "abandonó el grupo",
  "added you",
  "added",
  "añadió a",
  "deleted this message",
  "eliminó este mensaje",
  "this message was deleted",
  "se eliminó este mensaje",
  "pinned a message",
  "fijó un mensaje",
  "security code changed",
  "código de seguridad cambió",
  "disappearing messages",
  "los mensajes temporales",
  "null",
];

function to24h(hour: number, ampm: string | undefined): number {
  if (!ampm) return hour;
  const isPM = ampm.toLowerCase() === "p";
  if (isPM && hour !== 12) return hour + 12;
  if (!isPM && hour === 12) return 0;
  return hour;
}

export function parseWhatsappExport(raw: string): ParseResult {
  const messages: ParsedMessage[] = [];
  const stats = { text: 0, media: 0, system: 0, skipped: 0 };
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let current: ParsedMessage | null = null;

  const push = (m: ParsedMessage) => {
    if (m.contentType === "system") { stats.system++; return; }
    if (m.contentType === "media") { stats.media++; } else { stats.text++; }
    messages.push(m);
  };

  for (const line of lines) {
    const match = line.match(LINE_RE);
    if (match) {
      if (current) push(current);
      const [, d, mo, y, h, mi, s, ampm, author, bodyRaw] = match;
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      const sentAt = new Date(
        Date.UTC(year, Number(mo) - 1, Number(d), to24h(Number(h), ampm?.toLowerCase()), Number(mi), Number(s || 0))
      );
      const body = bodyRaw.trim();
      const isSystem = SYSTEM_PREFIXES.some((p) => body.toLowerCase().startsWith(p));
      const isMedia = MEDIA_MARKERS.some((p) => body.toLowerCase().startsWith(p));
      current = {
        sentAt,
        author: author.trim(),
        contentType: isSystem ? "system" : isMedia ? "media" : "text",
        body: isMedia || isSystem ? body : body,
      };
    } else if (current && line.trim() !== "") {
      // Continuación de mensaje multilínea
      current.body += "\n" + line.trim();
    } else {
      stats.skipped++;
    }
  }
  if (current) push(current);

  return { messages, stats };
}

// dedup_hash determinista por chat: evita duplicados aunque suban la misma export 2 veces
export async function dedupHash(chatId: string, sentAt: Date, authorHash: string, body: string): Promise<string> {
  const data = `${chatId}|${sentAt.toISOString()}|${authorHash}|${body}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Anonimización: salt por chat, nombre nunca sale del proceso
export async function authorHash(salt: string, author: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${author}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}