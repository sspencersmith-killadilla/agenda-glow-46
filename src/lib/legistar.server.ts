// Legistar WebAPI helpers + attachment text extraction for any Legistar-hosted organization.
// Server-only (uses fetch + zip decoding).
import { unzipSync, strFromU8 } from "fflate";

export function deriveLegistarClient(organizationName?: string | null): string | null {
  if (!organizationName) return null;
  const stripped = organizationName
    .split(",")[0]
    ?.trim()
    .replace(/^(?:the\s+)?(?:city|town|village|borough|county|municipality)\s+of\s+/i, "")
    .replace(/\s+(?:city\s+council|town\s+council|council|commission|board)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return stripped && stripped.length >= 2 ? stripped : null;
}

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

export function buildMatterUrl(client: string, matterId: number, guid?: string | null): string {
  const base = `https://${encodeURIComponent(client)}.legistar.com/LegislationDetail.aspx?ID=${matterId}`;
  return guid ? `${base}&GUID=${guid}` : base;
}

export async function findMatterByFile(
  client: string,
  matterFile: string,
): Promise<LegistarMatter | null> {
  const base = `https://webapi.legistar.com/v1/${encodeURIComponent(client)}`;
  const url = `${base}/matters?$filter=${encodeURIComponent(`MatterFile eq '${matterFile}'`)}&$top=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const arr = (await res.json()) as LegistarMatter[];
  return arr?.[0] ?? null;
}

export async function getMatterAttachments(
  client: string,
  matterId: number,
): Promise<LegistarAttachment[]> {
  const base = `https://webapi.legistar.com/v1/${encodeURIComponent(client)}`;
  const res = await fetch(`${base}/matters/${matterId}/attachments`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  return (await res.json()) as LegistarAttachment[];
}

export async function getMatterAgendaText(
  client: string,
  matterId: number,
): Promise<string | null> {
  // Sometimes the staff memo body is on the matter itself (MatterText fields)
  // or via /texts. We'll opportunistically try /texts.
  const base = `https://webapi.legistar.com/v1/${encodeURIComponent(client)}`;
  const res = await fetch(`${base}/matters/${matterId}/texts`, {
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


type Kind = "pdf" | "docx" | "doc" | "unknown";

function filenameFromDisposition(cd: string | null): string {
  if (!cd) return "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}

function detectKind(buf: Uint8Array, contentType: string, filename: string, url: string): Kind {
  // Magic bytes — most reliable
  if (buf.length >= 4) {
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf";
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      // ZIP — verify it's a DOCX by looking for word/document.xml
      try {
        const entries = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" });
        if (entries["word/document.xml"]) return "docx";
      } catch {
        /* fall through */
      }
      return "unknown";
    }
    if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return "doc";
  }
  // Content-Type fallback
  const ct = contentType.toLowerCase();
  if (ct.includes("application/pdf")) return "pdf";
  if (ct.includes("wordprocessingml")) return "docx";
  if (ct.includes("application/msword")) return "doc";
  // Filename / URL extension last resort
  const name = filename || url.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".doc")) return "doc";
  return "unknown";
}

/** Fetch attachment bytes + extract plain text. Supports .docx, .pdf, and legacy .doc. */
export async function fetchAttachmentText(url: string): Promise<ExtractedAttachment | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "";
  const filename = filenameFromDisposition(res.headers.get("content-disposition"));
  const kind = detectKind(buf, contentType, filename, url);

  if (kind === "pdf") {
    return { kind: "pdf", base64: bytesToBase64(buf) };
  }

  if (kind === "docx") {
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

  if (kind === "doc") {
    // Legacy Word 97-2003 binary (CFB). Extract printable strings as a noisy-but-usable
    // text fallback and also send raw bytes to the AI as application/msword.
    const text = extractPrintableStrings(buf);
    return { kind: "doc", text, base64: bytesToBase64(buf) };
  }

  return null;
}

