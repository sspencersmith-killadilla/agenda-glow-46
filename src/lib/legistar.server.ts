// Legistar WebAPI helpers + docx text extraction for McKinney.
// Server-only (uses fetch + zip decoding).
import { unzipSync, strFromU8 } from "fflate";

const CLIENT = "mckinney";
const BASE = `https://webapi.legistar.com/v1/${CLIENT}`;

export type LegistarMatter = {
  MatterId: number;
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

/** Pick best "staff report" attachment: prefer Memo / Staff Report, fall back to Ordinance/Resolution. */
export function pickStaffReport(atts: LegistarAttachment[]): LegistarAttachment | null {
  if (!atts.length) return null;
  const score = (a: LegistarAttachment) => {
    const n = (a.MatterAttachmentName ?? "").toLowerCase();
    if (n.includes("memo") || n.includes("staff report")) return 100;
    if (n.includes("ordinance") && !n.includes("redline")) return 60;
    if (n.includes("resolution")) return 55;
    if (n.includes("agreement") || n.includes("contract")) return 40;
    return 10;
  };
  return [...atts].sort((a, b) => score(b) - score(a))[0];
}

/** Fetch attachment bytes + extract plain text. Supports .docx and .pdf. */
export async function fetchAttachmentText(
  url: string,
): Promise<{ kind: "text"; text: string } | { kind: "pdf"; base64: string } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const lower = url.toLowerCase();

  if (lower.endsWith(".pdf")) {
    // Encode to base64 for Gemini file part
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    return { kind: "pdf", base64: btoa(binary) };
  }

  if (lower.endsWith(".docx")) {
    try {
      const entries = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" });
      const xml = entries["word/document.xml"];
      if (!xml) return null;
      const raw = strFromU8(xml);
      // Convert paragraphs / breaks to newlines, then strip remaining XML tags.
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

  return null;
}
