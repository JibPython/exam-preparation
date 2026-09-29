import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { createGeminiSession } = await import("./gemini-session.ts");
const { GEMINI_MODELS, GEMINI_CACHE } = await import("./gemini-config.ts");
const { createUsageRecorder } = await import("./gemini-usage.ts");
const pdf = { kind: "document", mimeType: "application/pdf", data: Buffer.from("PRIVATE_SOURCE_BYTES"), originalFileType: "application/pdf", referenceUnit: "page" };
const usage = { promptTokenCount: 10000, cachedContentTokenCount: 8000, candidatesTokenCount: 100, thoughtsTokenCount: 50, totalTokenCount: 10150 };

function fixture(t, overrides = {}, prepared = pdf) {
  const logs = [];
  t.mock.method(console, "info", (...args) => logs.push(args));
  const requests = [], uploads = [], counts = [], cacheCreates = [], deletes = [];
  const ai = {
    files: {
      upload: async (request) => {
        uploads.push(request);
        if (overrides.uploadError) throw overrides.uploadError;
        return { name: "files/private-id", uri: "private-file-uri", state: overrides.fileState ?? "ACTIVE" };
      },
      get: async () => ({ name: "files/private-id", uri: "private-file-uri", state: "ACTIVE" }),
      delete: async ({ name }) => { deletes.push(name); if (overrides.cleanupError) throw overrides.cleanupError; },
    },
    caches: {
      create: async (request) => {
        cacheCreates.push(request);
        if (overrides.cacheError) throw overrides.cacheError;
        return { name: `cachedContents/${request.model}`, expireTime: overrides.expireTime };
      },
      delete: async ({ name }) => { deletes.push(name); if (overrides.cleanupError) throw overrides.cleanupError; },
    },
    models: {
      countTokens: async (request) => {
        counts.push(request);
        if (overrides.countError) throw overrides.countError;
        return { totalTokens: overrides.tokens ?? 8000 };
      },
      generateContent: async (request) => {
        requests.push(request);
        if (overrides.generationError && (!overrides.onlyCached || request.config.cachedContent)) throw overrides.generationError;
        return { text: "PRIVATE_RESPONSE", usageMetadata: overrides.noUsage ? undefined : usage };
      },
    },
  };
  const session = createGeminiSession(ai, prepared, "Stable source fidelity rules");
  const generate = (stage = "ORGANISING_TOPICS") => session.generate(stage, "PRIVATE_PROMPT", { type: "object" });
  return { session, generate, logs, requests, uploads, counts, cacheCreates, deletes, ai };
}

test("one file reused by separate Flash and Pro caches; only source and shared rules cached", async (t) => {
  const f = fixture(t);
  await f.generate();
  await f.generate("GATHERING_CONTENT");
  await f.generate("CHECKING_COVERAGE");
  await f.generate("CORRECTING_NOTES");
  await f.generate("CHECKING_COVERAGE");
  await f.generate("CHECKING_STYLE");
  assert.equal(f.uploads.length, 1);
  assert.equal(f.counts.length, 2);
  assert.equal(f.cacheCreates.length, 2);
  assert.deepEqual(f.cacheCreates.map((r) => r.model), [GEMINI_MODELS.flash, GEMINI_MODELS.coverage]);
  for (const request of f.cacheCreates) {
    assert.equal(request.config.ttl, "600s");
    assert.equal(request.config.systemInstruction, "Stable source fidelity rules");
    assert.deepEqual(request.config.contents, [{ fileData: { fileUri: "private-file-uri", mimeType: "application/pdf" } }]);
    assert.ok(!JSON.stringify(request).includes("PRIVATE_PROMPT"));
  }
  for (const request of f.requests.slice(0, 5)) {
    assert.equal(request.config.cachedContent, `cachedContents/${request.model}`);
    assert.equal(request.config.systemInstruction, undefined, "system instruction lives in cache, not both places");
    assert.deepEqual(request.contents, [{ text: "PRIVATE_PROMPT" }]);
  }
  assert.equal(f.requests.at(-1).config.cachedContent, undefined);
  assert.equal(f.requests.at(-1).config.systemInstruction, "Stable source fidelity rules");
  await f.session.close("succeeded");
  await f.session.close("succeeded");
  assert.deepEqual(f.deletes, [`cachedContents/${GEMINI_MODELS.flash}`, `cachedContents/${GEMINI_MODELS.coverage}`, "files/private-id"]);
  assert.equal(f.logs.filter(([name]) => name === "Gemini usage summary").length, 1);
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_|private-file-uri|private-id|Stable source/);
});

test("tiny source skips caches once per model but keeps the same File API reference first", async (t) => {
  const f = fixture(t, { tokens: 15 });
  await f.generate();
  await f.generate("GATHERING_CONTENT");
  assert.equal(f.cacheCreates.length, 0);
  assert.equal(f.counts.length, 1);
  assert.equal(f.uploads.length, 1);
  assert.deepEqual(f.requests[0].contents[0], f.requests[1].contents[0]);
  assert.equal(f.requests[0].contents[0].fileData.fileUri, "private-file-uri");
  assert.equal(f.logs.find(([name]) => name === "Gemini stage usage")[1].cacheStatus, "below_threshold");
  await f.session.close("succeeded");
});

test("text counts actual source tokens and can cache without a file upload", async (t) => {
  const f = fixture(t, {}, { kind: "text", text: "PRIVATE_TEXT", originalFileType: "text/plain" });
  await f.generate();
  assert.equal(f.uploads.length, 0);
  assert.ok(f.counts[0].contents[0].text.endsWith("PRIVATE_TEXT"));
  assert.deepEqual(f.counts[0].contents, f.cacheCreates[0].config.contents);
  await f.session.close("succeeded");
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_TEXT/);
});

test("source-free transformations do not upload, count, or create a cache", async (t) => {
  const f = fixture(t);
  await f.generate("CONDENSING_NOTES");
  await f.generate("CHECKING_STYLE");
  assert.equal(f.uploads.length + f.counts.length + f.cacheCreates.length, 0);
  assert.ok(f.requests.every((r) => r.contents.length === 1 && !r.config.cachedContent));
  await f.session.close("succeeded");
});

test("token counting or cache creation failure falls back without repeating failed setup", async (t) => {
  for (const operation of ["countError", "cacheError"]) {
    await t.test(operation, async (t) => {
      const f = fixture(t, { [operation]: new Error("PRIVATE_PROVIDER_ERROR") });
      await f.generate();
      await f.generate("GATHERING_CONTENT");
      assert.equal(f.counts.length, 1);
      assert.equal(f.cacheCreates.length, operation === "countError" ? 0 : 1);
      assert.ok(f.requests.every((r) => r.contents[0].fileData && !r.config.cachedContent));
      await f.session.close("succeeded");
      assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_PROVIDER_ERROR/);
    });
  }
});

test("failed File upload falls back to inline bytes without re-uploading every stage", async (t) => {
  const f = fixture(t, { tokens: 1, uploadError: new Error("PRIVATE_UPLOAD_ERROR") });
  await f.generate();
  await f.generate("GATHERING_CONTENT");
  assert.equal(f.uploads.length, 1);
  assert.equal(f.requests[0].contents[0].inlineData.data, pdf.data.toString("base64"));
  assert.deepEqual(f.requests[0].contents[0], f.requests[1].contents[0]);
  await f.session.close("succeeded");
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_UPLOAD_ERROR|PRIVATE_SOURCE_BYTES/);
});

test("failed file processing falls back and still deletes the known temporary file", async (t) => {
  const f = fixture(t, { tokens: 1, fileState: "FAILED" });
  await f.generate();
  assert.ok(f.requests[0].contents[0].inlineData);
  await f.session.close("succeeded");
  assert.deepEqual(f.deletes, ["files/private-id"]);
});

test("processing file is polled before its reference is used", async (t) => {
  const f = fixture(t, { tokens: 1, fileState: "PROCESSING" });
  let polled = 0;
  f.ai.files.get = async () => { polled++; return { name: "files/private-id", uri: "private-file-uri", state: "ACTIVE" }; };
  await f.generate();
  assert.equal(polled, 1);
  assert.ok(f.requests[0].contents[0].fileData);
  await f.session.close("succeeded");
});

test("expired caches fall back without a new cache or losing the source", async (t) => {
  const f = fixture(t, { expireTime: new Date(0).toISOString() });
  await f.generate();
  await f.generate("GATHERING_CONTENT");
  assert.equal(f.cacheCreates.length, 1);
  assert.equal(f.requests[1].config.cachedContent, undefined);
  assert.ok(f.requests[1].contents[0].fileData);
  await f.session.close("succeeded");
});

test("rejected cache reference retries once without cache and retains per-attempt usage", async (t) => {
  const f = fixture(t, { onlyCached: true, generationError: Object.assign(new Error("CachedContent not found PRIVATE_ERROR"), { status: 404 }) });
  await f.generate();
  await f.generate("GATHERING_CONTENT");
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests[0].config.cachedContent);
  assert.equal(f.requests[1].config.cachedContent, undefined);
  assert.ok(f.requests[1].contents[0].fileData);
  await f.session.close("succeeded");
  const summary = f.logs.find(([name]) => name === "Gemini usage summary")[1];
  assert.equal(summary.calls.length, 3);
  assert.equal(summary.calls[0].receivedResponse, false);
  assert.equal(summary.calls[1].cacheStatus, "rejected_fallback");
  assert.equal(summary.callsMissingTokenCounts.promptTokens, 1);
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_ERROR/);
});

test("ordinary generation errors are not retried; cleanup and failed summary still work", async (t) => {
  const f = fixture(t, { generationError: Object.assign(new Error("PRIVATE_ERROR"), { status: 500 }) });
  await assert.rejects(f.generate());
  assert.equal(f.requests.length, 1);
  await f.session.close("failed");
  assert.equal(f.deletes.length, 2);
  const summary = f.logs.find(([name]) => name === "Gemini usage summary")[1];
  assert.equal(summary.outcome, "failed");
  assert.equal(summary.calls[0].promptTokens, null);
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_ERROR/);
});

test("cleanup failures are independent, safe, and do not destroy a response or summary", async (t) => {
  const f = fixture(t, { cleanupError: new Error("PRIVATE_CLEANUP_ERROR") });
  const response = await f.generate();
  await f.generate("CHECKING_COVERAGE");
  await f.session.close("succeeded");
  assert.equal(response.text, "PRIVATE_RESPONSE");
  assert.equal(f.deletes.length, 3);
  assert.equal(f.logs.filter(([name, value]) => name === "Gemini resource status" && value.status === "failed").length, 3);
  assert.equal(f.logs.at(-1)[1].outcome, "succeeded");
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_CLEANUP_ERROR/);
});

test("usage aggregation sums only numeric fields and marks missing counts as unknown", (t) => {
  const logs = [];
  t.mock.method(console, "info", (...args) => logs.push(args));
  const recorder = createUsageRecorder();
  recorder.record("CHECKING_COVERAGE", { ...usage, extra: "PRIVATE_SOURCE", promptTokensDetails: [{ text: "PRIVATE_SOURCE" }] }, "created", true, true);
  recorder.record("CHECKING_COVERAGE", usage, "created", true, true);
  recorder.record("CHECKING_STYLE", undefined, "source_not_needed", false, false);
  const summary = recorder.summary("failed");
  assert.deepEqual(summary.observedTotals, { promptTokens: 20000, cachedTokens: 16000, candidateTokens: 200, thinkingTokens: 100, totalTokens: 20300 });
  assert.deepEqual(summary.callsMissingTokenCounts, { promptTokens: 1, cachedTokens: 1, candidateTokens: 1, thinkingTokens: 1, totalTokens: 1 });
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_SOURCE/);
  assert.equal(GEMINI_CACHE.ttlSeconds, 600);
});
