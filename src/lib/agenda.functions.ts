import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateObject } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { SEED_AGENDA_TITLE, SEED_AGENDA_DATE, SEED_AGENDA_TEXT } from "@/lib/agenda-seed";

const ItemSchema = z.object({
  item_number: z.string().nullable().describe("The agenda item number like 26-0563, or null"),
  raw_title: z.string().describe("The full original item title as written in the agenda"),
  item_type: z.enum([
    "Minutes",
    "Ordinance",
    "Resolution",
    "Public Hearing",
    "Election",
    "Executive Session",
    "Other",
  ]),
  department: z.string().describe(
    "Best guess at the owning City department: Parks & Recreation, Aviation (Airport), Public Works / Engineering, Police, Fire / Emergency Management, Planning, Finance, City Secretary, City Manager, Economic Development, Legal, IT, or other.",
  ),
  cost_estimate: z
    .string()
    .nullable()
    .describe("Dollar amount stated in the title, e.g. '$1,200,000'. Null if not stated."),
  cost_numeric: z
    .number()
    .nullable()
    .describe("Same cost as a plain number, no symbols. Null if unknown."),
  plain_summary: z
    .string()
    .describe(
      "Two-sentence plain-language explanation for a resident: what this item is and why it matters. No jargon.",
    ),
});

const ParseSchema = z.object({
  items: z.array(ItemSchema),
});

async function callAIParser(agendaText: string) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const gateway = createLovableAiGatewayProvider(key);
  const { object } = await generateObject({
    model: gateway("google/gemini-2.5-flash"),
    schema: ParseSchema,
    prompt: `You are parsing a McKinney, TX City Council meeting agenda. Extract EVERY numbered agenda item (skip section headers, invocations, public-comment blurbs, and procedural text). For each item, infer the most likely owning City department from the title, extract any dollar amount stated, and write a two-sentence plain-language summary a resident can understand. If no cost is stated, leave it null. Items also include the Executive Session topics — mark those as Executive Session type with department "Legal".

AGENDA TEXT:
${agendaText}`,
  });
  return object.items;
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

async function insertParsed(opts: {
  title: string;
  meetingDate: string | null;
  sourceFilename: string | null;
  items: z.infer<typeof ItemSchema>[];
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
      model: gateway("google/gemini-2.5-flash"),
      schema: ParseSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Parse this McKinney City Council meeting agenda PDF. Extract every numbered agenda item (skip section headers and procedural text). For each item infer the owning City department, extract any dollar amount stated, and write a two-sentence plain-language summary for a resident.",
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
    const agenda = await insertParsed({
      title: data.title,
      meetingDate: data.meetingDate ?? null,
      sourceFilename: data.sourceFilename ?? null,
      items: object.items,
    });
    return { agendaId: agenda.id, itemCount: object.items.length };
  });
