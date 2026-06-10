# Use your own Gemini API key for PDF parsing

Right now every AI call (PDF parsing, staff-report extraction, item enrichment) goes through Lovable AI Gateway and draws from your Lovable workspace credits. When credits run out you see the "payment required" error.

This plan switches those calls to use **your own Google AI Studio Gemini API key** so they bill directly to your Google account and never touch Lovable credits.

## Steps

1. **Add the secret.** I'll prompt you to paste `GEMINI_API_KEY` into Lovable's secure secret form (the same key you use on your other project — grab it from https://aistudio.google.com/apikey if you don't have it handy).

2. **Install the Google provider package.** Add `@ai-sdk/google` so the AI SDK can talk to Google's API directly (same surface as the Lovable provider; `generateText`/`Output.object` keep working unchanged).

3. **Add a Google provider helper.** Create `src/lib/google-ai.server.ts` exporting `createGoogleProvider()` that reads `process.env.GEMINI_API_KEY` and returns the Google provider.

4. **Switch the three AI calls in `src/lib/agenda.functions.ts`** from `gateway("google/gemini-3-flash-preview")` to `google("gemini-2.5-flash")` (Google's direct API uses bare model names — `gemini-3-flash-preview` is a Lovable-only alias). Affects:
   - `callAIParser` (PDF parsing)
   - `extractStaffReportFields` (staff report enrichment)
   - the agenda-item enrichment loop

5. **Keep a graceful fallback.** If `GEMINI_API_KEY` is missing, fall back to the Lovable gateway so nothing breaks for future contributors. If both are missing, surface a clear error.

## What stays the same

- All Zod schemas, prompts, parsing logic, and the dashboard UI.
- Lovable Cloud (database, auth) is unchanged.
- The image-generation / other Lovable features (if any added later) still use `LOVABLE_API_KEY`.

## Cost note

Google's Gemini API has a generous free tier (`gemini-2.5-flash` is free up to daily limits) and pay-as-you-go beyond that — billed to your Google account, not Lovable.

Ready to switch to build mode and add the key?