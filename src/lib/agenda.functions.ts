import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { getGeminiModel } from "@/lib/google-ai.server";

export const testAIConnection = createServerFn({ method: "POST" }).handler(
  async () => {
    const usingLovable = Boolean(process.env.LOVABLE_API_KEY);
    const sample = `CITY COUNCIL REGULAR MEETING — SAMPLE
CONSENT AGENDA
24-0001  Consider approval of a $12,500 purchase of office supplies for the City Secretary's Office.`;
    const started = Date.now();
    try {
      const items = await callAIParser(sample);
      return {
        ok: true,
        usingLovable,
        ms: Date.now() - started,
        itemsParsed: items.length,
        sampleItem: items[0]?.raw_title ?? null,
      };
    } catch (err) {
      return {
        ok: false,
        usingLovable,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
);

function buildEnrichInstructions(organizationName?: string | null): string {
  const orgLabel = organizationName?.trim()
    ? `${organizationName.trim()} governing body`
    : "city council or public organization";
  const locationHint = organizationName?.trim()
    ? ` in ${organizationName.trim()}`
    : "";
  return `You are reading a ${orgLabel} staff report / ordinance / resolution document attached to an agenda item. Extract the key facts as JSON. Respond with ONLY a JSON object (no markdown fences, no commentary):

{
  "department": "owning department or office, e.g. Parks & Recreation, Aviation, Public Works",
  "cost_estimate": "primary dollar amount as written, like $1,234,567, or \"\" if none",
  "cost_numeric": same cost as plain number, or 0,
  "funding_source": "which fund/budget pays for this, or \"\"",
  "vendor": "contractor / company / counterparty named, or \"\"",
  "recommendation": "the staff recommendation in one sentence, or \"\"",
  "background": "2-3 sentence background of why this is before the governing body",
  "detailed_summary": "one-paragraph plain-language explanation for a resident or community member, no jargon, no acronyms",
  "locations": ["array of specific street addresses or named places${locationHint} referenced by this item, e.g. '123 Main St' or 'Municipal Airport'. Empty array if none. Do NOT include the generic city/organization name or City Hall unless they are the actual subject."],
  "is_grant": true if this item is accepting, applying for, amending, or administering a grant or external funding award; false otherwise,
  "grant_award_amount": dollar amount the organization would RECEIVE from the grantor (incoming money) as a plain number, or 0,
  "grant_match_amount": dollar amount the organization must CONTRIBUTE as local match / share (outgoing money) as a plain number, or 0,
  "grantor": "name of the awarding agency or funder, e.g. state DOT, FAA, HUD, FEMA, EPA, DOJ, or \"\" if not a grant"
}

If a field is unknown, use an empty string (or 0 for numeric fields, [] for locations, false for is_grant). Do not invent numbers or addresses.`;
}

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
  on_consent: z.coerce.boolean().catch(false),
  is_grant: z.coerce.boolean().catch(false),
  grant_award_amount: z.coerce.number().nullish().catch(null),
  grant_match_amount: z.coerce.number().nullish().catch(null),
  grantor: z.coerce.string().nullish(),
});

function buildParseInstructions(organizationName?: string | null): string {
  const orgLabel = organizationName?.trim()
    ? `${organizationName.trim()} meeting agenda`
    : "public meeting or council agenda";
  return `Parse this ${orgLabel}. Extract EVERY numbered agenda item (skip section headers, invocations, public-comment blurbs, and procedural text).

The agenda is divided into sections. Items appearing under a heading like "CONSENT AGENDA", "CONSENT MINUTES", "CONSENT ORDINANCES", or "CONSENT RESOLUTIONS" are on the consent agenda (passed in one vote with no debate). Items under "INDIVIDUAL CONSIDERATION", "PUBLIC HEARINGS", or similar are NOT on consent.

Flag GRANT items: any item whose title mentions a grant, award, "accept funding", "interlocal funding agreement", or names a funding agency such as state DOT, FAA, HUD, FEMA, DOJ, EPA, regional council of governments, or similar. For grants, separate money the organization RECEIVES (grant_award_amount, incoming) from money the organization must CONTRIBUTE as local match (grant_match_amount, outgoing).

Respond with ONLY a JSON array (no markdown fences, no commentary). Each element:
{
  "item_number": "26-0563" or "",
  "raw_title": "full original title",
  "item_type": one of "Minutes" | "Ordinance" | "Resolution" | "Public Hearing" | "Election" | "Executive Session" | "Grant" | "Other",
  "department": best guess owning department or office (Parks & Recreation, Aviation, Public Works, Police, Fire, Planning, Finance, Clerk / Secretary, Administration, Economic Development, Legal, IT, etc.),
  "cost_estimate": dollar amount stated in the title like "$1,200,000", or "",
  "cost_numeric": same cost as a plain number, or 0,
  "plain_summary": "two-sentence plain-language explanation for a resident, no jargon",
  "on_consent": true if this item appears under a CONSENT section, false otherwise,
  "is_grant": true if this item is accepting/applying for/amending a grant or external funding award,
  "grant_award_amount": dollar amount the organization would RECEIVE (incoming) as a plain number, or 0,
  "grant_match_amount": dollar amount the organization must CONTRIBUTE as local match (outgoing) as a plain number, or 0,
  "grantor": awarding agency name (e.g. "FAA", "HUD", "FEMA"), or ""
}`;
}

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
      const awardNum =
        typeof it.grant_award_amount === "number" && it.grant_award_amount > 0
          ? it.grant_award_amount
          : null;
      const matchNum =
        typeof it.grant_match_amount === "number" && it.grant_match_amount > 0
          ? it.grant_match_amount
          : null;
      const isGrant = Boolean(it.is_grant) || awardNum != null || /\bgrant\b/i.test(it.raw_title);
      return {
        item_number: it.item_number?.trim() || null,
        raw_title: it.raw_title.trim(),
        item_type: it.item_type.trim() || "Other",
        department: it.department.trim() || "Unknown",
        cost_estimate: it.cost_estimate?.trim() || null,
        cost_numeric: costNum,
        plain_summary: it.plain_summary.trim(),
        on_consent: Boolean(it.on_consent),
        is_grant: isGrant,
        grant_award_amount: awardNum,
        grant_match_amount: matchNum,
        grantor: it.grantor?.trim() || null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

async function callAIParser(agendaText: string, organizationName?: string | null) {
  const { text } = await generateText({
    model: getGeminiModel(),
    prompt: `${buildParseInstructions(organizationName)}\n\nAGENDA TEXT:\n${agendaText}`,
  });
  const items = normalizeItems(extractJsonArray(text));
  if (items.length === 0) throw new Error("No agenda items could be parsed");
  return items;
}

async function findOrCreateOrganizationByName(rawName: string) {
  const name = rawName.trim();
  if (!name) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing, error: selErr } = await supabaseAdmin
    .from("organizations")
    .select("*")
    .ilike("name", name)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return existing;

  const { data: created, error: insErr } = await supabaseAdmin
    .from("organizations")
    .insert({ name })
    .select()
    .single();
  if (insErr) throw new Error(insErr.message);
  return created;
}

export const listOrganizations = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const createOrganization = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ name: z.string().trim().min(1, "Enter a city or organization name").max(120) }).parse(input),
  )
  .handler(async ({ data }) => {
    const org = await findOrCreateOrganizationByName(data.name);
    if (!org) throw new Error("Enter a city or organization name");
    return org;
  });

export const listAgendas = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("agendas")
    .select("*, organizations(id, name)")
    .order("meeting_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const deleteAgenda = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: e1 } = await supabaseAdmin.from("agenda_items").delete().eq("agenda_id", data.id);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await supabaseAdmin.from("agendas").delete().eq("id", data.id);
    if (e2) throw new Error(e2.message);
    return { deleted: true };
  });

export const deleteAllAgendas = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error: e1 } = await supabaseAdmin.from("agenda_items").delete().not("id", "is", null);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await supabaseAdmin.from("agendas").delete().not("id", "is", null);
  if (e2) throw new Error(e2.message);
  return { deleted: true };
});

export const getAgenda = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: agenda, error: e1 }, { data: items, error: e2 }] = await Promise.all([
      supabaseAdmin.from("agendas").select("*, organizations(id, name)").eq("id", data.id).single(),
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
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: item, error } = await supabaseAdmin
      .from("agenda_items")
      .select("*, agendas(id,title,meeting_date,organization_id,organizations(id,name))")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!item) throw new Error("Item not found");
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
  on_consent: boolean;
  is_grant: boolean;
  grant_award_amount: number | null;
  grant_match_amount: number | null;
  grantor: string | null;
};

async function insertParsed(opts: {
  title: string;
  meetingDate: string | null;
  sourceFilename: string | null;
  organizationId: string | null;
  items: ParsedItem[];
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: agenda, error: aErr } = await supabaseAdmin
    .from("agendas")
    .insert({
      title: opts.title,
      meeting_date: opts.meetingDate,
      source_filename: opts.sourceFilename,
      organization_id: opts.organizationId,
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
    on_consent: it.on_consent,
    is_grant: it.is_grant,
    grant_award_amount: it.grant_award_amount,
    grant_match_amount: it.grant_match_amount,
    grantor: it.grantor,
    sort_order: idx,
  }));
  if (rows.length > 0) {
    const { error: iErr } = await supabaseAdmin.from("agenda_items").insert(rows);
    if (iErr) throw new Error(iErr.message);
  }
  return agenda;
}

async function resolveOrganization(opts: {
  organizationId?: string | null;
  organizationName?: string | null;
}): Promise<{ id: string | null; name: string | null }> {
  if (opts.organizationId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .select("id, name")
      .eq("id", opts.organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return { id: data.id, name: data.name };
  }
  if (opts.organizationName?.trim()) {
    const org = await findOrCreateOrganizationByName(opts.organizationName);
    if (org) return { id: org.id, name: org.name };
  }
  return { id: null, name: null };
}

export const parseAgendaFromText = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(300),
        meetingDate: z.string().nullable().optional(),
        sourceFilename: z.string().nullable().optional(),
        organizationId: z.string().uuid().nullable().optional(),
        organizationName: z.string().max(120).nullable().optional(),
        text: z.string().min(50).max(200_000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const org = await resolveOrganization({
      organizationId: data.organizationId ?? null,
      organizationName: data.organizationName ?? null,
    });
    const items = await callAIParser(data.text, org.name);
    const agenda = await insertParsed({
      title: data.title,
      meetingDate: data.meetingDate ?? null,
      sourceFilename: data.sourceFilename ?? null,
      organizationId: org.id,
      items,
    });
    return { agendaId: agenda.id, organizationId: org.id, itemCount: items.length };
  });

export const parseAgendaFromPdf = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(300),
        meetingDate: z.string().nullable().optional(),
        sourceFilename: z.string().nullable().optional(),
        organizationId: z.string().uuid().nullable().optional(),
        organizationName: z.string().max(120).nullable().optional(),
        // Storage object path inside the "agenda-pdfs" bucket. The browser
        // uploads the PDF directly to storage so we never pay the cost of
        // base64-encoding ~20MB through the RPC payload (which OOM'd the Worker).
        pdfPath: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const org = await resolveOrganization({
      organizationId: data.organizationId ?? null,
      organizationName: data.organizationName ?? null,
    });
    const { data: blob, error: dlError } = await supabaseAdmin.storage
      .from("agenda-pdfs")
      .download(data.pdfPath);
    if (dlError || !blob) {
      throw new Error(`Failed to load PDF from storage: ${dlError?.message ?? "missing file"}`);
    }
    const pdfBytes = new Uint8Array(await blob.arrayBuffer());

    const { text } = await generateText({
      model: getGeminiModel(),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildParseInstructions(org.name) },
            { type: "file", mediaType: "application/pdf", data: pdfBytes },
          ],
        },
      ],
    });

    // Best-effort cleanup; ignore failures.
    void supabaseAdmin.storage.from("agenda-pdfs").remove([data.pdfPath]);

    const normalized = normalizeItems(extractJsonArray(text));
    if (normalized.length === 0) throw new Error("No agenda items could be parsed from the PDF");
    const agenda = await insertParsed({
      title: data.title,
      meetingDate: data.meetingDate ?? null,
      sourceFilename: data.sourceFilename ?? null,
      organizationId: org.id,
      items: normalized,
    });
    return { agendaId: agenda.id, organizationId: org.id, itemCount: normalized.length };
  });

// ─────────────────────────── Enrichment via Legistar ───────────────────────────

type AiFilePart = { mediaType: string; base64: string };

async function callEnrichAI(opts: {
  text?: string;
  files?: AiFilePart[];
  itemTitle: string;
  organizationName?: string | null;
}) {
  const userParts: Array<
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; data: string }
  > = [
    {
      type: "text",
      text: `${buildEnrichInstructions(opts.organizationName)}\n\nAGENDA ITEM TITLE: ${opts.itemTitle}\n${
        opts.text ? `\nDOCUMENT TEXT:\n${opts.text.slice(0, 120_000)}` : ""
      }`,
    },
  ];
  for (const f of opts.files ?? []) {
    userParts.push({ type: "file", mediaType: f.mediaType, data: f.base64 });
  }

  const { text } = await generateText({
    model: getGeminiModel(),
    messages: [{ role: "user", content: userParts }],
  });
  return extractJsonObject(text);
}

export const enrichAgendaItem = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ itemId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      deriveLegistarClient,
      findMatterByFile,
      getMatterAttachments,
      pickStaffReport,
      pickTopAttachments,
      fetchAttachmentText,
      buildMatterUrl,
    } = await import("@/lib/legistar.server");

    const { data: item, error } = await supabaseAdmin
      .from("agenda_items")
      .select("*, agendas(id, title, organizations(id, name))")
      .eq("id", data.itemId)
      .single();
    if (error) throw new Error(error.message);
    if (!item) throw new Error("Item not found");
    const orgName =
      (item.agendas as { organizations?: { name?: string | null } | null } | null)?.organizations
        ?.name ?? null;
    const legistarClient = deriveLegistarClient(orgName);

    try {
      let matterId = item.matter_id as number | null;
      let matterGuid = (item as { matter_guid?: string | null }).matter_guid ?? null;
      let matterUrl = (item as { matter_url?: string | null }).matter_url ?? null;
      let matterShortName = item.matter_short_name as string | null;
      let matterStatus = item.matter_status as string | null;
      let attachments = (item.attachments as { name: string; url: string }[] | null) ?? [];
      let staffReportUrl = item.staff_report_url as string | null;
      let rawAttachments: Awaited<ReturnType<typeof getMatterAttachments>> = [];

      if (!legistarClient && !matterId) {
        const { error: uErr } = await supabaseAdmin
          .from("agenda_items")
          .update({
            enrichment_status: "none",
            enrichment_error: "Assign a city or organization name to look up staff reports on Legistar",
            enriched_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        if (uErr) throw new Error(uErr.message);
        return { status: "none" as const };
      }

      if (!matterId && item.item_number && legistarClient) {
        const matter = await findMatterByFile(legistarClient, item.item_number);
        if (matter) {
          matterId = matter.MatterId;
          matterGuid = matter.MatterGuid ?? null;
          matterShortName = matter.MatterName;
          matterStatus = matter.MatterStatusName;
        }
      }
      if (matterId && !matterUrl && legistarClient) {
        matterUrl = buildMatterUrl(legistarClient, matterId, matterGuid);
      }

      if (matterId && legistarClient) {
        rawAttachments = await getMatterAttachments(legistarClient, matterId);
        if (attachments.length === 0 && rawAttachments.length > 0) {
          attachments = rawAttachments
            .map((a) => ({
              name: a.MatterAttachmentName ?? "Attachment",
              url: a.MatterAttachmentHyperlink ?? "",
            }))
            .filter((a) => a.url);
          const best = pickStaffReport(rawAttachments);
          staffReportUrl = best?.MatterAttachmentHyperlink ?? attachments[0]?.url ?? null;
        }
      }

      // Pull the body text — combine top 2 attachments (memo + contract/exhibit when present).
      const topAtts = pickTopAttachments(rawAttachments, 2);
      const urlsToFetch = topAtts
        .map((a) => a.MatterAttachmentHyperlink)
        .filter((u): u is string => Boolean(u));
      // Always include staffReportUrl if we have it and somehow missed it.
      if (staffReportUrl && !urlsToFetch.includes(staffReportUrl)) {
        urlsToFetch.unshift(staffReportUrl);
      }

      const textChunks: string[] = [];
      const files: AiFilePart[] = [];
      for (const url of urlsToFetch) {
        const extracted = await fetchAttachmentText(url);
        if (!extracted) continue;
        if (extracted.kind === "text") {
          textChunks.push(extracted.text);
        } else if (extracted.kind === "pdf") {
          files.push({ mediaType: "application/pdf", base64: extracted.base64 });
        } else if (extracted.kind === "doc") {
          // Gemini doesn't accept application/msword as a file part, so only
          // send the printable-strings text we extracted from the CFB binary.
          if (extracted.text) textChunks.push(extracted.text);
        }
      }
      const combinedText = textChunks.join("\n\n--- NEXT DOCUMENT ---\n\n");

      const hasContent = Boolean(combinedText || files.length > 0);
      if (!hasContent) {
        const onlyResolution =
          attachments.length > 0 &&
          attachments.every((a) => /resolution|ordinance/i.test(a.name)) &&
          !attachments.some((a) => /memo|staff report|agreement|contract|exhibit/i.test(a.name));
        const msg = attachments.length === 0
          ? "No attachments posted on Legistar yet"
          : onlyResolution
            ? "Only a resolution/ordinance is posted — staff memo with cost not uploaded yet"
            : "Could not extract text from any posted attachment";
        const { error: uErr } = await supabaseAdmin
          .from("agenda_items")
          .update({
            matter_id: matterId,
            matter_guid: matterGuid,
            matter_url: matterUrl,
            matter_short_name: matterShortName,
            matter_status: matterStatus,
            attachments,
            staff_report_url: staffReportUrl,
            enrichment_status: "none",
            enrichment_error: msg,
            enriched_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        if (uErr) throw new Error(uErr.message);
        return { status: "none" as const };
      }

      const parsed = await callEnrichAI({
        text: combinedText || undefined,
        files: files.length > 0 ? files : undefined,
        itemTitle: item.raw_title,
        organizationName: orgName,
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

      const locationsRaw = Array.isArray((parsed as { locations?: unknown }).locations)
        ? ((parsed as { locations: unknown[] }).locations
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter((v) => v.length > 3 && v.length < 250))
        : [];
      // Dedupe
      const locations = Array.from(new Set(locationsRaw)).slice(0, 10);

      const grant_award_amount = num(parsed.grant_award_amount) ?? item.grant_award_amount;
      const grant_match_amount = num(parsed.grant_match_amount) ?? item.grant_match_amount;
      const grantor = str(parsed.grantor) || item.grantor;
      const is_grant =
        Boolean(parsed.is_grant) ||
        item.is_grant ||
        grant_award_amount != null ||
        Boolean(grantor) ||
        /\bgrant\b/i.test(item.raw_title);

      const { error: uErr } = await supabaseAdmin
        .from("agenda_items")
        .update({
          matter_id: matterId,
          matter_guid: matterGuid,
          matter_url: matterUrl,
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
          locations,
          is_grant,
          grant_award_amount,
          grant_match_amount,
          grantor: grantor || null,
          enrichment_status: "done",
          enrichment_error: cost_numeric == null && !cost_estimate && grant_award_amount == null && grant_match_amount == null
            ? "No dollar amount stated in the linked staff report or resolution"
            : null,
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
  .validator((input: unknown) =>
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
