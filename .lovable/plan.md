# Add Grants as a separate category

Right now every agenda item has a single `cost_numeric` field, which the AI fills with whatever dollar figure is most prominent. Grant items get lumped in with regular spending, and there's no way to tell a $500K *outgoing* purchase from a $500K *incoming* grant award — or from a grant that costs the City a $50K match to unlock $450K in state funds.

This plan adds a first-class "Grant" concept so grants show up as their own category with both sides of the money clearly separated.

## What the user will see

- A new **Grant** filter/section alongside the existing department & consent groupings on the agenda page.
- On a grant item's detail page, two distinct figures:
  - **Potential income** — the award amount coming *to* the City (e.g. "$450,000 from TxDOT").
  - **Potential City cost** — the local match / city share the City must put up (e.g. "$50,000 match from General Fund"), or $0 if fully funded.
- A small "Grant" badge on item cards in the list view.
- Grantor (awarding agency) shown when known — e.g. "TxDOT", "FAA", "HUD", "TDEM".

## How it works under the hood (technical)

### 1. Database

New columns on `agenda_items`:
- `is_grant boolean not null default false`
- `grant_award_amount numeric` — money coming in
- `grant_match_amount numeric` — City's required match (outflow)
- `grantor text` — awarding agency name

`cost_numeric` stays as-is for non-grant items. For grant items the UI will prefer `grant_match_amount` when computing "what this costs McKinney."

### 2. AI parsing prompt (`PARSE_INSTRUCTIONS` in `src/lib/agenda.functions.ts`)

Add `"Grant"` to the `item_type` enum and ask the model to additionally return:
```
"is_grant": true if this item is accepting, applying for, or amending a grant,
"grant_award_amount": dollar amount the City would receive, or 0,
"grant_match_amount": dollar amount the City must contribute as match, or 0,
"grantor": awarding agency name, or ""
```

Heuristic guidance in the prompt: titles containing "grant", "award", "accept funding", "interlocal funding agreement", or naming a funding agency (TxDOT, FAA, HUD, FEMA, TDEM, OOG, DOJ, etc.) should be flagged.

### 3. Enrichment prompt (`ENRICH_INSTRUCTIONS`)

Same four fields added so the staff-report pass can refine award/match/grantor from the memo body, where the split is usually spelled out.

### 4. Normalization

Extend `LenientItem` zod schema and `normalizeItems` to coerce and persist the new fields, mirroring the existing `cost_numeric` pattern.

### 5. UI

- `src/routes/index.tsx` — add a "Grants" group/tab; badge on cards where `is_grant`.
- `src/routes/item.$id.tsx` — render the two-figure block with grantor when `is_grant`.

## Out of scope

- Backfilling existing parsed agendas — they'll keep their current categorization until re-parsed. (Happy to add a "re-parse" button in a follow-up if you want.)
- Tracking grant lifecycle (applied → awarded → closed). This is one-shot per agenda item.

Want me to proceed, or adjust the field set (e.g. add `grant_period` dates, separate `federal_vs_state`, etc.) first?
