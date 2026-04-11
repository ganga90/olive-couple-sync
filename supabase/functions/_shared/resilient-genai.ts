/**
 * Resilient GenAI Call with Retry + Model Fallback
 * =================================================
 * Shared module for exponential backoff retry on transient errors
 * (503 Service Unavailable, 429 Too Many Requests).
 * Falls back to alternative model tiers before giving up.
 */

import { GoogleGenAI } from "https://esm.sh/@google/genai@1.0.0";

export async function resilientGenerateContent(
  genai: GoogleGenAI,
  params: { model: string; contents: any; config?: any },
  options?: { maxRetries?: number; fallbackModels?: string[] }
): Promise<any> {
  const maxRetries = options?.maxRetries ?? 2;
  const fallbackModels = options?.fallbackModels ?? [];
  const allModels = [params.model, ...fallbackModels];

  for (let modelIdx = 0; modelIdx < allModels.length; modelIdx++) {
    const currentModel = allModels[modelIdx];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await genai.models.generateContent({
          ...params,
          model: currentModel,
        });
        if (modelIdx > 0 || attempt > 0) {
          console.log(`[GenAI Retry] Succeeded on model="${currentModel}" attempt=${attempt + 1}`);
        }
        return response;
      } catch (err: any) {
        const msg = err?.message || String(err);
        const isTransient =
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('Service Unavailable') ||
          msg.includes('overloaded') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('Too Many Requests') ||
          msg.includes('quota') ||
          err?.status === 429 ||
          err?.status === 503;

        if (!isTransient) throw err;

        const isLastAttempt = attempt === maxRetries;
        const isLastModel = modelIdx === allModels.length - 1;

        if (isLastAttempt && isLastModel) throw err;

        if (isLastAttempt) {
          console.warn(`[GenAI Retry] Model "${currentModel}" exhausted retries, trying fallback model "${allModels[modelIdx + 1]}"`);
          break;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 8000);
        console.warn(`[GenAI Retry] Transient error on "${currentModel}" (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error('[GenAI Retry] All retries and fallback models exhausted');
}
