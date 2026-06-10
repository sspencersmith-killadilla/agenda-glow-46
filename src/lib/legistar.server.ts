// Legistar WebAPI helpers + docx text extraction for McKinney.
// Server-only (uses fetch + zip decoding).
import { unzipSync, strFromU8 } from "fflate";

const CLIENT = "mckinney";
const BASE = `https://webapi.legistar.com/v1/${CLIENT}`;

export type LegistarMatter = {
  MatterId: number;
  MatterGuid?: string | null;
  MatterFile: string;
  MatterName: string | null;
  MatterTitle: string | null;
  MatterTypeName: string | null;
  MatterStatusName: string | null;
  MatterBodyName: string | null;
  MatterAgendaDate: string | null;
};

export type LegistarAttachment = {
  MatterAttachmentId: number;
  MatterAttachmentName: string | null;
  MatterAttachmentHyperlink: string | null;
  MatterAttachmentFileName: string | null;
};

export function buildMatterUrl(matterId: number, guid?: string | null): string {
  const base = `https://mckinney.legistar.com/LegislationDetail.aspx?ID=${matterId}`;
  return guid ? `${base}&GUID=${guid}` : base;
}

export async function findMatterByFile(matterFile: string): Promise<LegistarMatter | null> {
  const url = `${BASE}/matters?$filter=${encodeURIComponent(`MatterFile eq '${matterFile}'`)}&$top=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const arr = (await res.json()) as LegistarMatter[];
  return arr?.[0] ?? null;
}

export async function getMatterAttachments(matterId: number): Promise<LegistarAttachment[]> {
  const res = await fetch(`${BASE}/matters/${matterId}/attachments`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  return (await res.json()) as LegistarAttachment[];
}

export async function getMatterAgendaText(matterId: number): Promise<string | null> {
  // Sometimes the staff memo body is on the matter itself (MatterText fields)
  // or via /texts. We'll opportunistically try /texts.
  const res = await fetch(`${BASE}/matters/${matterId}/texts`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<{ MatterTextPlain?: string | null; MatterTextRtf?: string | null }>;
  const text = arr?.find((t) => t.MatterTextPlain?.trim())?.MatterTextPlain;
  return text?.trim() || null;
}

/** Score attachments by likely usefulness — higher = better. */
function attachmentScore(a: LegistarAttachment): number {
  const n = (a.MatterAttachmentName ?? "").toLowerCase();
  if (n.includes("redline") || n.includes("signed")) return 5;
  if (n.includes("memo") || n.includes("staff report")) return 100;
  if (n.includes("agreement") || n.includes("contract")) return 80;
  if (n.includes("exhibit") || n.includes("fiscal") || n.includes("budget")) return 70;
  if (n.includes("ordinance")) return 60;
  if (n.includes("resolution")) return 55;
  return 20;
}

/** Pick best "staff report" attachment: prefer Memo / Staff Report, fall back to Ordinance/Resolution. */
export function pickStaffReport(atts: LegistarAttachment[]): LegistarAttachment | null {
  if (!atts.length) return null;
  return [...atts].sort((a, b) => attachmentScore(b) - attachmentScore(a))[0];
}

/** Pick top-N attachments by score — used to combine memo + contract when both exist. */
export function pickTopAttachments(atts: LegistarAttachment[], n = 2): LegistarAttachment[] {
  return [...atts]
    .sort((a, b) => attachmentScore(b) - attachmentScore(a))
    .slice(0, n);
}

function bytesToBase64(buf: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Walk binary bytes, keep printable ASCII runs of length >= minLen. */
function extractPrintableStrings(buf: Uint8Array, minLen = 4): string {
  const out: string[] = [];
  let run = "";
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    // Printable ASCII (space..~), tab, newline
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) {
      run += String.fromCharCode(b);
    } else {
      if (run.length >= minLen) out.push(run);
      run = "";
    }
  }
  if (run.length >= minLen) out.push(run);
  return out
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ExtractedAttachment =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string }
  | { kind: "doc"; text: string; base64: string };

/** Fetch attachment bytes + extract plain text. Supports .docx, .pdf, and legacy .doc. */
export async function fetchAttachmentText(url: string): Promise<ExtractedAttachment | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const lower = url.toLowerCase();

  if (lower.endsWith(".pdf")) {
    return { kind: "pdf", base64: bytesToBase64(buf) };
  }

  if (lower.endsWith(".docx")) {
    try {
      const entries = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" });
      const xml = entries["word/document.xml"];
      if (!xml) return null;
      const raw = strFromU8(xml);
      const text = raw
        .replace(/<w:p[ >]/g, "\n<w:p ")
        .replace(/<w:br\s*\/>/g, "\n")
        .replace(/<w:tab\s*\/>/g, "\t")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return { kind: "text", text };
    } catch {
      return null;
    }
  }

  if (lower.endsWith(".doc")) {
    // Legacy Word 97-2003 binary (CFB). No reliable pure-JS parser, so:
    //  - extract printable strings as a noisy-but-usable text fallback
    //  - also send the raw bytes to the AI as application/msword
    const text = extractPrintableStrings(buf);
    return { kind: "doc", text, base64: bytesToBase64(buf) };
  }

  return null;
}
