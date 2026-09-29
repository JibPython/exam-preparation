import { ThinkingLevel } from "@google/genai";

export const GEMINI_MODELS = {
  flash: "gemini-3-flash-preview",
  coverage: "gemini-3.1-pro-preview",
} as const;

// Output limits include reasoning headroom. Gathering/full-note rewrites retain
// the model maximum; these contracts have no fixed maximum lecture size.
export const GEMINI_STAGES = {
  ORGANISING_TOPICS: { model: GEMINI_MODELS.flash, thinkingLevel: ThinkingLevel.LOW, source: true, maxOutputTokens: 32768 },
  GATHERING_CONTENT: { model: GEMINI_MODELS.flash, thinkingLevel: ThinkingLevel.LOW, source: true, maxOutputTokens: 65536 },
  CONDENSING_NOTES: { model: GEMINI_MODELS.flash, thinkingLevel: ThinkingLevel.MEDIUM, source: false, maxOutputTokens: 65536 },
  CHECKING_COVERAGE: { model: GEMINI_MODELS.coverage, thinkingLevel: ThinkingLevel.HIGH, source: true, maxOutputTokens: 49152 },
  CHECKING_COVERAGE_REAUDIT: { model: GEMINI_MODELS.coverage, thinkingLevel: ThinkingLevel.MEDIUM, source: true, maxOutputTokens: 49152 },
  CHECKING_COVERAGE_FINAL_REAUDIT: { model: GEMINI_MODELS.coverage, thinkingLevel: ThinkingLevel.MEDIUM, source: true, maxOutputTokens: 49152 },
  CHECKING_COVERAGE_POST_STYLE: { model: GEMINI_MODELS.coverage, thinkingLevel: ThinkingLevel.HIGH, source: true, maxOutputTokens: 49152 },
  CORRECTING_NOTES: { model: GEMINI_MODELS.flash, thinkingLevel: ThinkingLevel.HIGH, source: true, maxOutputTokens: 65536 },
  CORRECTING_NOTES_FALLBACK: { model: GEMINI_MODELS.coverage, thinkingLevel: ThinkingLevel.HIGH, source: true, maxOutputTokens: 65536 },
  CHECKING_STYLE: { model: GEMINI_MODELS.flash, thinkingLevel: ThinkingLevel.MEDIUM, source: false, maxOutputTokens: 65536 },
} as const;
export type GeminiStage = keyof typeof GEMINI_STAGES;
export type GeminiModel = typeof GEMINI_MODELS[keyof typeof GEMINI_MODELS];

export const GEMINI_CACHE = {
  ttlSeconds: 600,
  // Conservative eligibility floor, not a claim that every model's minimum is
  // identical. The API remains authoritative; unsupported contexts fall back.
  minSourceTokens: 4096,
  operationTimeoutMs: 20000,
  fileReadyTimeoutMs: 60000,
} as const;
