import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

/**
 * Returns an AI SDK provider + model id pair for Gemini.
 *
 * Prefers the user's own GEMINI_API_KEY (billed to their Google account).
 * Falls back to Lovable AI Gateway with LOVABLE_API_KEY when no Gemini key
 * is configured. Throws if neither is available.
 */
export function getGeminiModel() {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const google = createGoogleGenerativeAI({ apiKey: geminiKey });
    // Direct Google API uses bare model names.
    return google("gemini-2.5-flash");
  }

  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) {
    const gateway = createLovableAiGatewayProvider(lovableKey);
    return gateway("google/gemini-3-flash-preview");
  }

  throw new Error(
    "No AI key configured. Set GEMINI_API_KEY (recommended) or LOVABLE_API_KEY.",
  );
}
