## Plan: Move AI parsing back to Lovable AI Gateway

### Current state
`src/lib/google-ai.server.ts` prefers `GEMINI_API_KEY` (direct Google API) and falls back to `LOVABLE_API_KEY` only when the user key is missing. Both secrets are configured.

### Changes

1. **Reverse provider priority in `src/lib/google-ai.server.ts`**
   - Check `LOVABLE_API_KEY` first and route through Lovable AI Gateway (`google/gemini-3-flash-preview`).
   - Keep `GEMINI_API_KEY` as a fallback so the user retains an escape hatch.
   - Rename the file or the helper to reflect that it is no longer Gemini-specific (optional — can keep filename for now).

2. **Update UI copy on the dashboard**
   - Rename "Test Gemini connection" button to "Test AI connection".
   - Update status labels: instead of "Your key / Lovable fallback", show "Lovable AI" vs "Fallback (your key)".

3. **Update server function name**
   - Rename `testGeminiConnection` → `testAIConnection` in `src/lib/agenda.functions.ts` and update the import/call site in `src/routes/index.tsx`.

### Technical details
- Lovable AI Gateway already supports the same `generateText` + file-parts API through the OpenAI-compatible adapter, so PDF parsing and enrichment continue to work unchanged.
- No new dependencies needed.

### Outcome
All agenda parsing and enrichment goes through Lovable AI Gateway by default. The user's own Gemini key remains available as a manual fallback if they ever need it.