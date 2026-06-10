# Enriching agenda items with staff-report data

Right now each item only has what the AI can guess from its one-line title (department, cost, two-sentence summary). McKinney publishes a **staff report PDF** for almost every numbered item — that's where the real cost, funding source, vendor, background, and recommendation live. Pulling those in is the single biggest accuracy upgrade we can make.

## What it takes

### 1. Get a URL for each item's staff report
McKinney runs its agendas on **Granicus Legistar** (`mckinney.legistar.com`). Each item on the printed agenda has a Legistar "File #" (e.g. `26-0563`) and a matching detail page at:
`https://mckinney.legistar.com/LegislationDetail.aspx?ID=<n>&GUID=...`
which links to the staff report PDF + attachments.

Two options for getting that link:
- **(a) Scrape the Legistar meeting page** for the agenda date → gives us the per-item detail URLs and attachment URLs cleanly. Most reliable.
- **(b) Have the AI extract any URLs already present in the uploaded agenda PDF.** Works for the seeded agenda since the PDF embeds Legistar links, but breaks for hand-typed agendas.

Recommend (a) as primary, (b) as fallback.

### 2. Store the new fields
Add columns to `agenda_items`:
- `staff_report_url` (text)
- `attachments` (jsonb — array of `{name, url}`)
- `enrichment_status` (text: `pending` | `done` | `failed` | `none`)
- `enriched_at` (timestamptz)

And expanded detail fields the AI will fill from the report:
- `funding_source`, `vendor`, `recommendation`, `background` (text)
- `detailed_summary` (longer plain-language explanation, ~1 paragraph)
- override `cost_numeric` / `cost_estimate` when the report states a real number

### 3. Enrichment server function
New `enrichAgendaItem({ itemId })` server fn that:
1. Reads the row, fetches `staff_report_url` PDF as bytes.
2. Sends the PDF to Gemini 3 Flash with a strict prompt asking for the fields above as JSON.
3. Updates the row, sets `enrichment_status='done'`.

Plus `enrichAgenda({ agendaId })` that loops items with `enrichment_status='pending'` (with small concurrency, e.g. 3 at a time).

### 4. Trigger it
- After a new agenda is parsed (`parseAgendaFromText` / `parseAgendaFromPdf` / `seedDefaultAgendaIfEmpty`), kick off enrichment in the background.
- Add a manual **"Refresh staff report"** button on the item detail page for re-runs.
- Show enrichment progress on the dashboard (e.g. "24/36 enriched").

### 5. UI surface
On `/item/$id`:
- New sections: Funding source, Vendor, Staff recommendation, Background, Full summary.
- "View original staff report" link + attachment list.
- Badge showing enrichment status.

On the dashboard:
- Use the corrected `cost_numeric` from staff reports so the cost totals/charts stop saying "Not disclosed" for most items.

## Trade-offs & caveats
- **Legistar scraping is fragile** — if McKinney changes the site we'd need to adjust. No official API.
- **Cost & time**: ~30–50 items per agenda × one PDF call each = noticeable AI spend per agenda, but only once per agenda.
- **Robots/ToS**: Legistar pages are public; we should fetch politely (sequential or low concurrency, identifying user-agent).
- **Fallback path**: if no `staff_report_url` is found for an item, leave `enrichment_status='none'` and keep the title-only summary.

## Suggested first slice (smallest useful step)
Just steps 2 + 3 + manual button in step 4, using option (b) for URL discovery on the already-seeded June 16 agenda. That proves the pipeline end-to-end on real data before we build the Legistar scraper.

---

**Questions before I build:**
1. Go with **Legistar scraping (a)** up front, or ship the **smallest slice** first (manual button, AI-extracted URLs) and add scraping after?
2. Auto-enrich every item on upload, or only on-demand per item (cheaper but slower for users)?
