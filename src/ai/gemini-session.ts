import { setTimeout as delay } from "node:timers/promises";
import type { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { sourceInput, type PreparedSource } from "./prepare-source";
import { GEMINI_CACHE, GEMINI_STAGES, type GeminiStage, type GeminiModel } from "./gemini-config";
import { createUsageRecorder } from "./gemini-usage";

type CacheState = { status: string; name?: string; expiresAt?: number };
const httpOptions = { timeout: GEMINI_CACHE.operationTimeoutMs };

// Read only numeric status, never SDK error text/objects (which may contain source).
function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return;
  return typeof error.status === "number" ? error.status : undefined;
}

export function createGeminiSession(ai: GoogleGenAI, prepared: PreparedSource, systemInstruction: string) {
  const usage = createUsageRecorder();
  const caches = new Map<GeminiModel, CacheState>();
  const cacheNames = new Set<string>();
  let fileName: string | undefined;
  let sourcePromise: Promise<Part> | undefined;
  let closed = false;

  function event(operation: string, status: string, model?: string, error?: unknown) {
    console.info("Gemini resource status", { operation, status, model, httpStatus: httpStatus(error) });
  }

  async function prepareReference(): Promise<Part> {
    if (prepared.kind === "text") return sourceInput(prepared);
    try {
      let file = await ai.files.upload({
        file: new Blob([new Uint8Array(prepared.data)], { type: prepared.mimeType }),
        config: { mimeType: prepared.mimeType, httpOptions },
      });
      fileName = file.name;
      const deadline = Date.now() + GEMINI_CACHE.fileReadyTimeoutMs;
      while (file.state === "PROCESSING" && fileName && Date.now() < deadline) {
        await delay(1000);
        file = await ai.files.get({ name: fileName, config: { httpOptions } });
      }
      if (!fileName || !file.uri || file.state !== "ACTIVE") throw new Error("File not ready");
      event("file", "uploaded");
      return { fileData: { fileUri: file.uri, mimeType: prepared.mimeType } };
    } catch (error) {
      event("file", "inline_fallback", undefined, error);
      // Compute base64 once only on fallback; no source bytes enter diagnostics.
      return sourceInput(prepared);
    }
  }

  function source(): Promise<Part> {
    return sourcePromise ??= prepareReference();
  }

  async function cacheFor(model: GeminiModel, part: Part): Promise<CacheState> {
    const existing = caches.get(model);
    if (existing) {
      if (existing.name && Date.now() >= (existing.expiresAt ?? 0)) {
        existing.name = undefined;
        existing.status = "expired_fallback";
        event("cache", existing.status, model);
      }
      return existing;
    }
    const state: CacheState = { status: "count_failed_fallback" };
    caches.set(model, state);
    try {
      // Count the source, not its bytes. Omitting small system instructions from
      // the count deliberately errs toward skipping small caches.
      const count = await ai.models.countTokens({ model, contents: [part], config: { httpOptions } });
      if (typeof count.totalTokens !== "number" || !Number.isFinite(count.totalTokens)) {
        event("cache", state.status, model);
        return state;
      }
      if (count.totalTokens < GEMINI_CACHE.minSourceTokens) {
        state.status = "below_threshold";
        event("cache", state.status, model);
        return state;
      }
      state.status = "creation_failed_fallback";
      const cached = await ai.caches.create({ model, config: {
        contents: [part], systemInstruction, ttl: `${GEMINI_CACHE.ttlSeconds}s`, httpOptions,
      } });
      if (!cached.name) throw new Error("Cache name missing");
      state.name = cached.name;
      cacheNames.add(cached.name);
      state.expiresAt = cached.expireTime ? Date.parse(cached.expireTime) : Date.now() + GEMINI_CACHE.ttlSeconds * 1000;
      state.status = "created";
      console.info("Gemini cache created", {
        model, ttlSeconds: GEMINI_CACHE.ttlSeconds, sourceTokens: count.totalTokens,
        // No names, URIs, source data, instructions, or raw metadata.
      });
    } catch (error) {
      event("cache", state.status, model, error);
    }
    return state;
  }

  async function generate(stage: GeminiStage, prompt: string, responseJsonSchema: object, prefix?: string) {
    const config = GEMINI_STAGES[stage];
    const part = config.source ? await source() : undefined;
    const cache = part ? await cacheFor(config.model, part) : { status: "source_not_needed" };
    async function attempt(): Promise<GenerateContentResponse> {
      const explicitCache = Boolean(cache.name);
      let response: GenerateContentResponse | undefined;
      try {
        response = await ai.models.generateContent({
          model: config.model,
          contents: [
            ...(part && !explicitCache ? [part] : []),
            ...(prefix ? [{ text: prefix }] : []), { text: prompt },
          ],
          config: {
            ...(explicitCache ? { cachedContent: cache.name } : { systemInstruction }),
            responseMimeType: "application/json", responseJsonSchema,
            thinkingConfig: { thinkingLevel: config.thinkingLevel },
            maxOutputTokens: config.maxOutputTokens,
          },
        });
        return response;
      } finally {
        usage.record(stage, response?.usageMetadata, cache.status, explicitCache, Boolean(response));
      }
    }
    try {
      return await attempt();
    } catch (error) {
      // Only retry a definitively rejected cache reference, never a timeout,
      // quota error, malformed model answer, or generic generation failure.
      const status = httpStatus(error);
      const cacheRejected = (status === 400 || status === 403 || status === 404) && error instanceof Error &&
        /cached[\s_]*content|cache.*(?:expired|not found|permission|unsupported)/i.test(error.message);
      if (!cache.name || !cacheRejected) throw error;
      cache.name = undefined;
      cache.status = "rejected_fallback";
      event("cache", cache.status, config.model, error);
      return attempt();
    }
  }

  async function close(outcome: "succeeded" | "failed") {
    if (closed) return;
    closed = true;
    try {
      // Caches first, then their temporary file. Every deletion is independent.
      for (const name of cacheNames) {
        try { await ai.caches.delete({ name, config: { httpOptions } }); }
        catch (error) { event("cache_cleanup", "failed", undefined, error); }
      }
      if (fileName) {
        try { await ai.files.delete({ name: fileName, config: { httpOptions } }); }
        catch (error) { event("file_cleanup", "failed", undefined, error); }
      }
    } finally {
      usage.summary(outcome);
    }
  }
  return { generate, close };
}
