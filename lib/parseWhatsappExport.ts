
// lib/parseWhatsappExport.ts
// Parser de exportaciones de WhatsApp (.txt).
// Soporta: Android/iOS/WhatsApp Web, 12h/24h, AM/PM con o sin puntos,
// y DETECCION AUTOMATICA del orden de fecha (dia/mes o mes/dia) por archivo.
// Anonimiza autores con sha256(salt + nombre): nunca se persiste el nombre real.

export type ParsedMessage = {
  sentAt: Date;
  author: string;
  contentType: "text" | "media" | "system";
  body: string;
};

export type ParseResult = {
  messages: ParsedMessage[];
  stats: { text: number; media: number; system: number; skipped: number };
  dateFormat: "DMY" | "MDY";
};

const LINE_RE =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:\s*([AaPp])\.?\s?[Mm]\.?)?\]\s+([^:]+?):\s?([\s\S]*)$/;

const MEDIA_MARKERS = [
  "<media omitted>", "media omitted", "archivo adjunto", "imagen omitida",
  "audio omitido", "video omitido", "sticker omitido", "archivo omitido",
  "documento omitido", "mensaje de voz omitido", "mensaje de album",
  "mensaje de unknown", "<mensaje de album>", "<mensaje de unknown>",
];

const SYSTEM_HINTS = [
  "messages and calls are end-to-end encrypted",
  "los mensajes y las llamadas están cifrados",
  "created this group", "creó el grupo", "creó este grupo",
  "you were added", "te añadió", "añadió a",
  "changed the subject", "cambió el asunto", "cambió el icono",
  "left", "abandonó el grupo", "added you",
  "deleted this message", "eliminó este mensaje", "se eliminó este mensaje",
  "pinned a message", "fijó un mensaje", "security code changed",
  "código de seguridad cambió", "disappearing messages", "mensajes temporales",
  "un admin.", "cambiaste", "cambiaste el número",
];

function to24h(hour: number, ampm: string | undefined): number {
  if (!ampm) return hour;
  const isPM = ampm.toLowerCase() === "p";
  if (isPM && hour !== 12) return hour + 12;
  if (!isPM && hour === 12) return 0;
  return hour;
}

function detectDateOrder(lines: string[]): "DMY" | "MDY" {
  let dmyViolations = 0, mdyViolations = 0, checked = 0;
  for (const line of lines) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const first = Number(m[1]), second = Number(m[2]);
    if (second > 12) dmyViolations++;
    if (first > 12) mdyViolations++;
    if (++checked >= 100) break;
  }
  return mdyViolations < dmyViolations ? "MDY" : "DMY";
}

export function parseWhatsappExport(raw: string): ParseResult {
  const messages: ParsedMessage[] = [];
  const stats = { text: 0, media: 0, system: 0, skipped: 0 };
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const dateFormat = detectDateOrder(lines);
  let current: ParsedMessage | null = null;

  const push = (m: ParsedMessage) => {
    if (m.contentType === "system") { stats.system++; return; }
    if (m.contentType === "media") { stats.media++; } else { stats.text++; }
    messages.push(m);
  };

  // Líneas de sistema sin dos puntos: "[10/13/26, 7:59:22 PM] - Matías añadió a +34..."
  const SYSTEM_LINE_RE =
    /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:\s*([AaPp])\.?\s?[Mm]\.?)?\]\s*-\s*(.+)$/;

  for (const line of lines) {
    const sysMatch = line.match(SYSTEM_LINE_RE);
    if (sysMatch && !line.match(LINE_RE)) {
      if (current) push(current);
      current = null;
      stats.system++;
      continue;
    }
    const match = line.match(LINE_RE);
    if (match) {
      if (current) push(current);
      const [, a, b, y, h, mi, s, ampm, authorRaw, bodyRaw] = match;
      const first = Number(a), second = Number(b);
      const day = dateFormat === "DMY" ? first : second;
      const month = dateFormat === "DMY" ? second : first;
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      const sentAt = new Date(
        Date.UTC(year, month - 1, day, to24h(Number(h), ampm?.toLowerCase()), Number(mi), Number(s || 0))
      );
      const body = bodyRaw.trim();
      const author = authorRaw.trim();
      const isSystemLine = author.startsWith("-");
      const low = body.toLowerCase();
      const isSystemBody = SYSTEM_HINTS.some((p) => low.startsWith(p));
      const isMedia = MEDIA_MARKERS.some((p) => low.startsWith(p));
      current = {
        sentAt,
        author,
        contentType: isSystemLine || isSystemBody ? "system" : isMedia ? "media" : "text",
        body,
      };
    } else if (current && line.trim() !== "") {
      current.body += "\n" + line.trim();
    } else {
      stats.skipped++;
    }
  }
  if (current) push(current);

  return { messages, stats, dateFormat };
}

export async function dedupHash(chatId: string, sentAt: Date, authorHash: string, body: string): Promise<string> {
  const data = `${chatId}|${sentAt.toISOString()}|${authorHash}|${body}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function authorHash(salt: string, author: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${author}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}