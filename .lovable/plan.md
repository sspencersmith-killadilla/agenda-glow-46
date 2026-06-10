## What you'll get

A dashboard where you upload a City Council agenda PDF and Lovable AI parses it into a structured, browsable list of items. Each item gets a plain-language explanation, owning department guess, estimated cost (when stated), and item type. Pre-loaded with the June 16, 2026 agenda so it's useful immediately.

## Pages

1. **Home / Agenda list** — table of all items for the selected agenda, with filters (department, type), search, and a totals strip (item count, total disclosed cost, items by type).
2. **Item detail** — full plain-language summary, original title, type, department, cost, and a link back to the source.
3. **Charts** — cost-by-department bar chart and items-by-type donut.
4. **Upload** — drop a new agenda PDF; AI parses and saves it as a new agenda you can switch between.

## How it works

- **Backend (Lovable Cloud)** stores `agendas` and `agenda_items` (title, item_number, type, department, cost_estimate, plain_summary, source_excerpt).
- **PDF parsing**: server function extracts text from the uploaded PDF, then Lovable AI (Gemini) returns a structured list of items with department, type, plain-language summary, and any cost figure mentioned. Cost stays null when not disclosed in the title (which is most of them — agendas rarely state dollar amounts on the cover page).
- **Seeding**: the June 16, 2026 agenda is parsed once on first load so the dashboard isn't empty.
- **Frontend**: TanStack Start routes, shadcn table/cards, Recharts for the two charts.

## Important honest caveat

The agenda PDF lists item titles only — actual dollar amounts and confirmed owning departments live in the linked staff reports/ordinances, which aren't in this PDF. AI will infer department from the title (usually accurate: "Airport Fees" → Aviation, "Erwin Park" → Parks) and extract any explicit dollar figures, but most cost fields will show "Not disclosed in agenda." You can later add manual editing if you want to fill those in from staff reports.

## Out of scope (can add later)

- Manual editing of AI-generated fields
- Fetching linked staff reports automatically
- Multi-meeting comparison / trends across agendas
- Auth (dashboard is public by default)
