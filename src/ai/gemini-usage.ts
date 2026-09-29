import type { GenerateContentResponseUsageMetadata } from "@google/genai";
import { GEMINI_STAGES, type GeminiStage } from "./gemini-config";

const tokenCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

function usageEntry(stage: GeminiStage, usage: GenerateContentResponseUsageMetadata | undefined,
    cacheStatus: string, explicitCache: boolean, receivedResponse: boolean) {
    const config = GEMINI_STAGES[stage];
    const entry = {
      stage: stage.startsWith("CHECKING_COVERAGE") ? "CHECKING_COVERAGE" :
        stage.startsWith("CORRECTING_NOTES") ? "CORRECTING_NOTES" : stage,
      operation: stage, model: config.model, thinkingLevel: config.thinkingLevel,
      explicitCache, cacheStatus, receivedResponse,
      promptTokens: tokenCount(usage?.promptTokenCount),
      cachedTokens: tokenCount(usage?.cachedContentTokenCount),
      candidateTokens: tokenCount(usage?.candidatesTokenCount),
      thinkingTokens: tokenCount(usage?.thoughtsTokenCount),
      totalTokens: tokenCount(usage?.totalTokenCount),
    };
    return entry;
}

export function createUsageRecorder() {
  const calls: ReturnType<typeof usageEntry>[] = [];
  function record(...args: Parameters<typeof usageEntry>) {
    const entry = usageEntry(...args);
    calls.push(entry);
    console.info("Gemini stage usage", entry);
    return entry;
  }
  function summary(outcome: "succeeded" | "failed") {
    const totals = { promptTokens: 0, cachedTokens: 0, candidateTokens: 0, thinkingTokens: 0, totalTokens: 0 };
    const missing = { ...totals };
    for (const call of calls) {
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
        totals[key] += call[key] ?? 0;
        if (call[key] === null) missing[key]++;
      }
    }
    // Cached tokens are a subset of promptTokens, not extra input. Missing
    // metadata is unknown usage, never a claim that a failed request was free.
    const result = { outcome, calls: [...calls], observedTotals: totals, callsMissingTokenCounts: missing };
    console.info("Gemini usage summary", result);
    return result;
  }
  return { record, summary };
}
