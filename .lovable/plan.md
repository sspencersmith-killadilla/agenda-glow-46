## Why 26-0575 has no cost today

Two things stacked:

1. **We can't read `.doc` files.** McKinney's older attachments are legacy Word 97-2003 (`.doc`, binary CFB), not `.docx`. Our extractor only handles `.pdf` and `.docx`, so the file is skipped and enrichment is marked `none`.
2. **Only a Resolution is posted.** Resolutions typically read *"…authorizing the City Manager to execute a contract with Terracon…"* without naming the dollar amount. The amount lives in the staff memo or contract exhibit, which for 26-0575 hasn't been uploaded yet (meeting is upcoming).

We can fix #1. #2 is a data-availability limit we should make visible to the reader instead of silently leaving a blank.

## What we'll build

### 1. Parse `.doc` files (dual path)

In `src/lib/legistar.server.ts > fetchAttachmentText`, add a `.doc` branch that does both:

- **Path A — Gemini direct:** return the bytes as a Gemini file part with `mediaType: "application/msword"`. Gemini sometimes parses these natively.
- **Path B — strings extraction:** walk the binary, keep printable ASCII/UTF-8 runs of ≥4 chars, join with newlines, collapse whitespace. Returns plain text the AI can read past the noise.

Return both as a new result kind `{ kind: "doc", text: string, base64: string }`. In `enrichAgendaItem` we feed the AI both the extracted text *and* the file part — the model uses whichever is cleaner.

### 2. Try harder when the staff report attachment is thin

Right now we only feed Gemini the single "best" attachment chosen by `pickStaffReport`. For items where that attachment is just a Resolution and others exist (contract, exhibit), we should:

- Score *all* attachments, take the top 2 (memo + first non-redline non-signed document), and concatenate their extracted text before the AI call.
- Cap combined text at ~120k chars (already our limit).

### 3. Honest UI when cost truly isn't in the source

On `/item/$id`, when `enrichment_status === 'done'` but `cost_numeric` and `cost_estimate` are both null, show a small inline note under the Cost field: *"No dollar amount stated in the linked staff report or resolution."* When `enrichment_status === 'none'` (no readable doc at all), keep the existing "No staff report" badge but add: *"Only a [Resolution] is posted; the staff memo with the cost may not be uploaded yet."*

### 4. Re-run on existing items

After the code change, the "Re-read staff report" button on the item detail page will pick up the new `.doc` parser on next click. No bulk backfill — per the user's choice, refresh stays manual.

## Files changed

- `src/lib/legistar.server.ts` — add `.doc` branch + return new `doc` kind; expand `pickStaffReport` to return top-N.
- `src/lib/agenda.functions.ts` — feed combined text + optional file part to `callEnrichAI`; record `enrichment_error` like "No dollar amount stated" when the AI returns no cost.
- `src/routes/item.$id.tsx` — small "why no cost" hint under the Cost field.

## What this won't fix

If McKinney never uploads a staff memo with the dollar figure (some items genuinely don't have one until after contract execution), the cost will stay blank. That's a limit of the source data, not our pipeline — and we'll now say so on the page.
