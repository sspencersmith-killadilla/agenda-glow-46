import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateObject } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { SEED_AGENDA_TITLE, SEED_AGENDA_DATE, SEED_AGENDA_TEXT } from "@/lib/agenda-seed";

const ItemSchema = z.object({
  item_number: z.string(),
  raw_title: z.string(),
  item_type: z.string(),
  department: z.string(),
  cost_estimate: z.string(),
  cost_numeric: z.number(),
  plain_summary: z.string(),
});

const ParseSchema = z.object({
  items: z.array(ItemSchema),
});

const PARSE_INSTRUCTIONS = `Parse this McKinney, TX City Council meeting agenda. Extract EVERY numbered agenda item (skip section headers, invocations, public-comment blurbs, and procedural text). Return JSON matching the schema.

Field rules — IMPORTANT: every field is required, use the empty string "" or 0 when unknown, NEVER null:
- item_number: like "26-0563", or "" if none
- raw_title: full original title
- item_type: one of "Minutes", "Ordinance", "Resolution", "Public Hearing", "Election", "Executive Session", "Other"
- department: best guess owning City department (Parks & Recreation, Aviation, Public Works, Police, Fire, Planning, Finance, City Secretary, City Manager, Economic Development, Legal, IT, etc.)
- cost_estimate: dollar amount stated in the title like "$1,200,000", or "" if not stated
- cost_numeric: same cost as plain number, or 0 if unknown
- plain_summary: two-sentence plain-language explanation for a resident, no jargon`;

function normalizeItems(items: z.infer<typeof ItemSchema>[]) {
  return items.map((it) => ({
    ...it,
    item_number: it.item_number?.trim() || null,
    cost_estimate: it.cost_estimate?.trim() || null,
    cost_numeric: it.cost_numeric && it.cost_numeric > 0 ? it.cost_numeric : null,
  }));
}

async function callAIParser(agendaText: string) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const gateway = createLovableAiGatewayProvider(key);
  const { object } = await generateObject({
    model: gateway("google/gemini-3-flash-preview"),
    schema: ParseSchema,
    prompt: `${PARSE_INSTRUCTIONS}\n\nAGENDA TEXT:\n${agendaText}`,
  });
  return normalizeItems(object.items);
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
    const { object } = await generateObject({
      model: gateway("google/gemini-3-flash-preview"),
      schema: ParseSchema,
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
    const normalized = normalizeItems(object.items);
    const agenda = await insertParsed({
      title: data.title,
      meetingDate: data.meetingDate ?? null,
      sourceFilename: data.sourceFilename ?? null,
      items: normalized,
    });
    return { agendaId: agenda.id, itemCount: normalized.length };
  });
