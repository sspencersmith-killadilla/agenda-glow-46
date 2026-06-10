import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { SEED_AGENDA_TITLE, SEED_AGENDA_DATE, SEED_AGENDA_TEXT } from "@/lib/agenda-seed";

const ENRICH_INSTRUCTIONS = `You are reading a McKinney, TX City Council staff report / ordinance / resolution document attached to an agenda item. Extract the key facts as JSON. Respond with ONLY a JSON object (no markdown fences, no commentary):

{
  "department": "owning City department, e.g. Parks & Recreation, Aviation, Public Works",
  "cost_estimate": "primary dollar amount as written, like $1,234,567, or \"\" if none",
  "cost_numeric": same cost as plain number, or 0,
  "funding_source": "which fund/budget pays for this, or \"\"",
  "vendor": "contractor / company / counterparty named, or \"\"",
  "recommendation": "the staff recommendation in one sentence, or \"\"",
  "background": "2-3 sentence background of why this is before council",
  "detailed_summary": "one-paragraph plain-language explanation for a resident, no jargon, no acronyms",
  "locations": ["array of specific street addresses or named places in McKinney, TX referenced by this item, e.g. '123 N Tennessee St, McKinney, TX' or 'McKinney National Airport'. Empty array if none. Do NOT include the generic city of McKinney or City Hall unless they are the actual subject."]
}

If a field is unknown, use an empty string (or 0 for cost_numeric, [] for locations). Do not invent numbers or addresses.`;

function extractJsonObject(text: string): Record<string, unknown> {
  let c = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const s = c.indexOf("{");
  const e = c.lastIndexOf("}");
  if (s === -1 || e === -1 || e <= s) throw new Error("AI response was not a JSON object");
  return JSON.parse(c.slice(s, e + 1));
}

const LenientItem = z.object({
  item_number: z.coerce.string().nullish(),
  raw_title: z.coerce.string().catch(""),
  item_type: z.coerce.string().catch("Other"),
  department: z.coerce.string().catch("Unknown"),
  cost_estimate: z.coerce.string().nullish(),
  cost_numeric: z.coerce.number().nullish().catch(null),
  plain_summary: z.coerce.string().catch(""),
});

const PARSE_INSTRUCTIONS = `Parse this McKinney, TX City Council meeting agenda. Extract EVERY numbered agenda item (skip section headers, invocations, public-comment blurbs, and procedural text).

Respond with ONLY a JSON array (no markdown fences, no commentary). Each element:
{
  "item_number": "26-0563" or "",
  "raw_title": "full original title",
  "item_type": one of "Minutes" | "Ordinance" | "Resolution" | "Public Hearing" | "Election" | "Executive Session" | "Other",
  "department": best guess owning City department (Parks & Recreation, Aviation, Public Works, Police, Fire, Planning, Finance, City Secretary, City Manager, Economic Development, Legal, IT, etc.),
  "cost_estimate": dollar amount stated in the title like "$1,200,000", or "",
  "cost_numeric": same cost as a plain number, or 0,
  "plain_summary": "two-sentence plain-language explanation for a resident, no jargon"
}`;

function extractJsonArray(text: string): unknown[] {
  let cleaned = text.trim();
  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // Find the outermost JSON array
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    // Maybe wrapped in an object like { "items": [...] }
    try {
      const obj = JSON.parse(cleaned);
      if (obj && Array.isArray(obj.items)) return obj.items;
    } catch {
      /* fall through */
    }
    throw new Error("AI response did not contain a JSON array");
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("AI response was not a JSON array");
  return parsed;
}

function normalizeItems(rawItems: unknown[]) {
  return rawItems
    .map((raw) => {
      const r = LenientItem.safeParse(raw);
      if (!r.success) return null;
      const it = r.data;
      if (!it.raw_title.trim()) return null;
      const costNum = typeof it.cost_numeric === "number" && it.cost_numeric > 0 ? it.cost_numeric : null;
      return {
        item_number: it.item_number?.trim() || null,
        raw_title: it.raw_title.trim(),
        item_type: it.item_type.trim() || "Other",
        department: it.department.trim() || "Unknown",
        cost_estimate: it.cost_estimate?.trim() || null,
        cost_numeric: costNum,
        plain_summary: it.plain_summary.trim(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

async function callAIParser(agendaText: string) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const gateway = createLovableAiGatewayProvider(key);
  const { text } = await generateText({
    model: gateway("google/gemini-3-flash-preview"),
    prompt: `${PARSE_INSTRUCTIONS}\n\nAGENDA TEXT:\n${agendaText}`,
  });
  const items = normalizeItems(extractJsonArray(text));
  if (items.length === 0) throw new Error("No agenda items could be parsed");
  return items;
}

export const listAgendas = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("agendas")
    .select("*")
    .order("meeting_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getAgenda = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: agenda, error: e1 }, { data: items, error: e2 }] = await Promise.all([
      supabaseAdmin.from("agendas").select("*").eq("id", data.id).single(),
      supabaseAdmin
        .from("agenda_items")
        .select("*")
        .eq("agenda_id", data.id)
        .order("sort_order", { ascending: true }),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    return { agenda, items: items ?? [] };
  });

export const getItem = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: item, error } = await supabaseAdmin
      .from("agenda_items")
      .select("*, agendas(id,title,meeting_date)")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return item;
  });

type ParsedItem = {
  item_number: string | null;
  raw_title: string;
  item_type: string;
  department: string;
  cost_estimate: string | null;
  cost_numeric: number | null;
  plain_summary: string;
};

async function insertParsed(opts: {
  title: string;
  meetingDate: string | null;
  sourceFilename: string | null;
  items: ParsedItem[];
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: agenda, error: aErr } = await supabaseAdmin
    .from("agendas")
    .insert({
      title: opts.title,
      meeting_date: opts.meetingDate,
      source_filename: opts.sourceFilename,
    })
    .select()
    .single();
  if (aErr) throw new Error(aErr.message);

  const rows = opts.items.map((it, idx) => ({
    agenda_id: agenda.id,
    item_number: it.item_number,
    raw_title: it.raw_title,
    item_type: it.item_type,
    department: it.department,
    cost_estimate: it.cost_estimate,
    cost_numeric: it.cost_numeric,
    plain_summary: it.plain_summary,
    sort_order: idx,
  }));
  if (rows.length > 0) {
    const { error: iErr } = await supabaseAdmin.from("agenda_items").insert(rows);
    if (iErr) throw new Error(iErr.message);
  }
  return agenda;
}

export const seedDefaultAgendaIfEmpty = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("agendas")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) return { seeded: false };

  const items = await callAIParser(SEED_AGENDA_TEXT);
  await insertParsed({
    title: SEED_AGENDA_TITLE,
    meetingDate: SEED_AGENDA_DATE,
    sourceFilename: "Agenda.pdf",
    items,
  });
  return { seeded: true };
});

export const parseAgendaFromText = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(300),
        meetingDate: z.string().nullable().optional(),
        sourceFilename: z.string().nullable().optional(),
        text: z.string().min(50).max(200_000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const items = await callAIParser(data.text);
    const agenda = await insertParsed({
      title: data.title,
      meetingDate: data.meetingDate ?? null,
      sourceFilename: data.sourceFilename ?? null,
      items,
    });
    return { agendaId: agenda.id, itemCount: items.length };
  });

export const parseAgendaFromPdf = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(300),
        meetingDate: z.string().nullable().optional(),
        sourceFilename: z.string().nullable().optional(),
        // base64-encoded PDF
        pdfBase64: z.string().min(100),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const { text } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: PARSE_INSTRUCTIONS,
            },
            {
              type: "file",
              mediaType: "application/pdf",
              data: data.pdfBase64,
            },
          ],
        },
      ],
    });
    const normalized = normalizeItems(extractJsonArray(text));
    if (normalized.length === 0) throw new Error("No agenda items could be parsed from the PDF");
    const agenda = await insertParsed({
      title: data.title,
      meetingDate: data.meetingDate ?? null,
      sourceFilename: data.sourceFilename ?? null,
      items: normalized,
    });
    return { agendaId: agenda.id, itemCount: normalized.length };
  });

// ─────────────────────────── Enrichment via Legistar ───────────────────────────

async function callEnrichAI(opts: { text?: string; pdfBase64?: string; itemTitle: string }) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const gateway = createLovableAiGatewayProvider(key);

  const userParts: Array<
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; data: string }
  > = [
    {
      type: "text",
      text: `${ENRICH_INSTRUCTIONS}\n\nAGENDA ITEM TITLE: ${opts.itemTitle}\n${
        opts.text ? `\nDOCUMENT TEXT:\n${opts.text.slice(0, 120_000)}` : ""
      }`,
    },
  ];
  if (opts.pdfBase64) {
    userParts.push({ type: "file", mediaType: "application/pdf", data: opts.pdfBase64 });
  }

  const { text } = await generateText({
    model: gateway("google/gemini-3-flash-preview"),
    messages: [{ role: "user", content: userParts }],
  });
  return extractJsonObject(text);
}

export const enrichAgendaItem = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ itemId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { findMatterByFile, getMatterAttachments, pickStaffReport, fetchAttachmentText } =
      await import("@/lib/legistar.server");

    const { data: item, error } = await supabaseAdmin
      .from("agenda_items")
      .select("*")
      .eq("id", data.itemId)
      .single();
    if (error) throw new Error(error.message);
    if (!item) throw new Error("Item not found");

    try {
      let matterId = item.matter_id as number | null;
      let matterShortName = item.matter_short_name as string | null;
      let matterStatus = item.matter_status as string | null;
      let attachments = (item.attachments as { name: string; url: string }[] | null) ?? [];
      let staffReportUrl = item.staff_report_url as string | null;

      if (!matterId && item.item_number) {
        const matter = await findMatterByFile(item.item_number);
        if (matter) {
          matterId = matter.MatterId;
          matterShortName = matter.MatterName;
          matterStatus = matter.MatterStatusName;
        }
      }

      if (matterId && attachments.length === 0) {
        const atts = await getMatterAttachments(matterId);
        attachments = atts
          .map((a) => ({
            name: a.MatterAttachmentName ?? "Attachment",
            url: a.MatterAttachmentHyperlink ?? "",
          }))
          .filter((a) => a.url);
        const best = pickStaffReport(atts);
        staffReportUrl = best?.MatterAttachmentHyperlink ?? attachments[0]?.url ?? null;
      }

      // Pull the body text — try the staff report attachment first, fall back to /texts.
      let docText: string | null = null;
      let pdfBase64: string | null = null;
      if (staffReportUrl) {
        const extracted = await fetchAttachmentText(staffReportUrl);
        if (extracted?.kind === "text") docText = extracted.text;
        else if (extracted?.kind === "pdf") pdfBase64 = extracted.base64;
      }
      // (No /texts fallback — Legistar's /matters/{id}/texts requires POST and is rarely populated for McKinney.)

      const hasContent = Boolean(docText || pdfBase64);
      if (!hasContent) {
        const { error: uErr } = await supabaseAdmin
          .from("agenda_items")
          .update({
            matter_id: matterId,
            matter_short_name: matterShortName,
            matter_status: matterStatus,
            attachments,
            staff_report_url: staffReportUrl,
            enrichment_status: "none",
            enrichment_error: "No staff report or matter text found",
            enriched_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        if (uErr) throw new Error(uErr.message);
        return { status: "none" as const };
      }

      const parsed = await callEnrichAI({
        text: docText ?? undefined,
        pdfBase64: pdfBase64 ?? undefined,
        itemTitle: item.raw_title,
      });

      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const num = (v: unknown) => {
        if (typeof v === "number" && v > 0) return v;
        if (typeof v === "string") {
          const n = Number(v.replace(/[^0-9.]/g, ""));
          return Number.isFinite(n) && n > 0 ? n : null;
        }
        return null;
      };
      const dept = str(parsed.department) || item.department;
      const cost_estimate = str(parsed.cost_estimate) || item.cost_estimate;
      const cost_numeric = num(parsed.cost_numeric) ?? item.cost_numeric;

      const { error: uErr } = await supabaseAdmin
        .from("agenda_items")
        .update({
          matter_id: matterId,
          matter_short_name: matterShortName,
          matter_status: matterStatus,
          attachments,
          staff_report_url: staffReportUrl,
          department: dept,
          cost_estimate,
          cost_numeric,
          funding_source: str(parsed.funding_source) || null,
          vendor: str(parsed.vendor) || null,
          recommendation: str(parsed.recommendation) || null,
          background: str(parsed.background) || null,
          detailed_summary: str(parsed.detailed_summary) || null,
          enrichment_status: "done",
          enrichment_error: null,
          enriched_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      if (uErr) throw new Error(uErr.message);
      return { status: "done" as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin
        .from("agenda_items")
        .update({
          enrichment_status: "failed",
          enrichment_error: msg.slice(0, 500),
          enriched_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      return { status: "failed" as const, error: msg };
    }
  });

export const enrichAgenda = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ agendaId: z.string().uuid(), limit: z.number().int().min(1).max(60).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pending, error } = await supabaseAdmin
      .from("agenda_items")
      .select("id")
      .eq("agenda_id", data.agendaId)
      .eq("enrichment_status", "pending")
      .order("sort_order", { ascending: true })
      .limit(data.limit ?? 50);
    if (error) throw new Error(error.message);
    const ids = (pending ?? []).map((p) => p.id);

    // Run with concurrency 3
    const results = { done: 0, failed: 0, none: 0 };
    const CONCURRENCY = 3;
    let idx = 0;
    async function worker() {
      while (idx < ids.length) {
        const myIdx = idx++;
        const id = ids[myIdx];
        try {
          const r = await enrichAgendaItem({ data: { itemId: id } });
          results[r.status] += 1;
        } catch {
          results.failed += 1;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    return { processed: ids.length, ...results };
  });
