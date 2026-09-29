import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import assert from "node:assert/strict";

// Match the project's bundler-style TypeScript imports without loading any environment files.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const requests = [];
const uploads = [];
let responses = [];
const { ThinkingLevel } = await import("@google/genai");
process.env.GEMINI_API_KEY = "test-placeholder-not-a-secret";
mock.module("@google/genai", {
  namedExports: {
    ThinkingLevel,
    GoogleGenAI: class {
      files = {
        upload: async (request) => { uploads.push(request); return { name: "files/test", uri: "test-file-uri", state: "ACTIVE" }; },
        delete: async () => {},
      };
      models = {
        countTokens: async () => ({ totalTokens: 10 }),
        generateContent: async (request) => {
          requests.push(request);
          return { candidates: [{ finishReason: "STOP" }], text: JSON.stringify(responses.shift()) };
        },
      };
    },
  },
});
const { createNotePipeline } = await import("./note-pipeline.ts");

test("separate calls preserve the checklist and restrict style examples to two stages", async () => {
  const canonical = { documentTitle: "Biology", topics: [{ title: "Cells", criteria: ["Define the cell"] }] };
  const draft = { topics: [{ topicIndex: 0, markdown: "Cell - source-backed definition" }] };
  responses = [canonical,
    { items: [{ topicIndex: 0, criterionIndex: 0, gatheredContent: ["Source-backed definition"] }] },
    draft, { passed: true, issues: [] }, draft,
  ];
  const preparedSource = { kind: "document", mimeType: "application/pdf", data: Buffer.from("test-pdf"), originalFileType: "application/pdf", referenceUnit: "page" };
  const sourcePart = { fileData: { mimeType: "application/pdf", fileUri: "test-file-uri" } };
  const pipeline = createNotePipeline(preparedSource);
  const organisation = await pipeline.organiseTopics();
  const gathered = await pipeline.gatherContent(organisation);
  const notes = await pipeline.condenseNotes(organisation, gathered);
  const coverage = await pipeline.checkCoverage(organisation, gathered, notes);
  assert.deepEqual(await pipeline.correctNotes(organisation, notes, coverage), notes);
  await pipeline.checkStyle(organisation, notes);
  assert.equal(requests.length, 5, "passing coverage skips correction request");
  assert.deepEqual(organisation, canonical);
  for (const index of [0, 1, 3]) assert.deepEqual(requests[index].contents[0], sourcePart);
  for (const index of [0, 1, 3]) {
    assert.ok(!JSON.stringify(requests[index]).includes("Master/Time-Daemon"));
  }
  for (const index of [2, 4]) {
    assert.ok(JSON.stringify(requests[index]).includes("Master/Time-Daemon"));
    assert.ok(JSON.stringify(requests[index]).includes("NEVER transfer their facts"));
  }
  assert.ok(requests[2].contents.at(-1).text.includes("Source-backed definition"));
  assert.equal(requests[4].contents.length, 2, "style prefix followed by notes, without source");
  assert.deepEqual(requests[2].contents[0], requests[4].contents[0], "stable style prefix encourages implicit caching");
  assert.equal(requests[2].contents.length, 2, "condensation needs gathered evidence, not the PDF");
  assert.equal(uploads.length, 1, "source uploaded once across stages");
  assert.deepEqual(requests.map((request) => request.model), [
    "gemini-3-flash-preview", "gemini-3-flash-preview", "gemini-3-flash-preview",
    "gemini-3.1-pro-preview", "gemini-3-flash-preview",
  ]);
  assert.deepEqual(requests.map((request) => request.config.thinkingConfig.thinkingLevel), ["LOW", "LOW", "MEDIUM", "HIGH", "MEDIUM"]);
  for (const request of requests) {
    assert.equal(request.config.thinkingConfig.thinkingBudget, undefined);
    assert.equal(request.config.temperature, undefined);
    assert.equal(request.config.responseMimeType, "application/json");
  }
  await pipeline.close("succeeded");
});

test("malformed model output fails without including raw output in the error", async () => {
  responses = [{ secretLookingSourceText: "do-not-expose-test-content" }];
  await assert.rejects(createNotePipeline({ kind: "text", text: "test", originalFileType: "text/plain" }).organiseTopics(), (error) => {
    assert.ok(!error.message.includes("do-not-expose"));
    return true;
  });
});

test("Gemini receives generic image/text inputs with the corresponding reference rules", async () => {
  for (const prepared of [
    { kind: "image", mimeType: "image/png", data: Buffer.from("test-image"), originalFileType: "image/png" },
    { kind: "text", text: "# Source text", originalFileType: "text/markdown" },
    { kind: "document", mimeType: "application/pdf", data: Buffer.from("test-rendering"), originalFileType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", referenceUnit: "slide" },
  ]) {
    responses = [{ documentTitle: "Title", topics: [{ title: "Topic", criteria: ["Criterion"] }] }];
    await createNotePipeline(prepared).organiseTopics();
    const request = requests.at(-1);
    if (prepared.kind === "text") {
      assert.ok(request.contents[0].text.endsWith(prepared.text));
      assert.ok(request.config.systemInstruction.includes("Never invent page numbers, visuals"));
    } else {
      assert.equal(request.contents[0].fileData.mimeType, prepared.mimeType);
      assert.equal(request.contents[0].fileData.fileUri, "test-file-uri");
      assert.equal(await uploads.at(-1).file.text(), prepared.data.toString());
      assert.ok(request.config.systemInstruction.includes(prepared.kind === "image" ? "uploaded image" : "slide N"));
    }
    assert.ok(!JSON.stringify(request).includes("Master/Time-Daemon"));
  }
});

test("audit and correction variants route correctly, retain context and log safe usage; finalisation is deterministic", async (t) => {
  const logs = [];
  t.mock.method(console, "info", (...args) => logs.push(args));
  const { finaliseNotes } = await import("./note-contracts.ts");
  const canonical = { documentTitle: "Test", topics: [{ title: "Topic", criteria: ["Criterion"] }] };
  const draft = { topics: [{ topicIndex: 0, markdown: "Approved notes" }] };
  const pipeline = createNotePipeline({ kind: "text", text: "Evidence", originalFileType: "text/plain" });
  const failed = { passed: false, issues: [
    { topicIndex: 0, criterionIndex: 0, type: "PARTIAL_COVERAGE", description: "Detail", correctionGuidance: "Restore" },
  ] };
  const passed = { passed: true, issues: [] };
  responses = [failed, draft, failed, draft, passed, passed];
  const start = requests.length;
  await pipeline.checkCoverage(canonical, {}, draft);
  await pipeline.correctNotes(canonical, draft, failed);
  await pipeline.checkCoverage(canonical, {}, draft, { type: "correction_reaudit", previousDraft: draft, coverage: failed });
  await pipeline.correctNotes(canonical, draft, failed, "fallback");
  await pipeline.checkCoverage(canonical, {}, draft, { type: "final_reaudit", previousDraft: draft, coverage: failed });
  await pipeline.checkCoverage(canonical, {}, draft, { type: "post_style" });
  assert.deepEqual(requests.slice(start).map((request) => [request.model, request.config.thinkingConfig.thinkingLevel]), [
    ["gemini-3.1-pro-preview", "HIGH"], ["gemini-3-flash-preview", "HIGH"],
    ["gemini-3.1-pro-preview", "MEDIUM"], ["gemini-3.1-pro-preview", "HIGH"],
    ["gemini-3.1-pro-preview", "MEDIUM"], ["gemini-3.1-pro-preview", "HIGH"],
  ]);
  for (const index of [2, 4]) {
    const prompt = requests[start + index].contents.at(-1).text;
    assert.match(prompt, /targeted correction re-audit/);
    assert.ok(prompt.includes(JSON.stringify(failed.issues)));
    assert.ok(prompt.includes(`PREVIOUS DRAFT: ${JSON.stringify(draft)}`));
    assert.match(prompt, /new coverage regressions/);
    assert.ok(requests[start + index].contents[0].text.includes("Evidence"));
  }
  for (const index of [0, 5]) assert.match(requests[start + index].contents.at(-1).text, /Compare EVERY canonical criterion/);
  assert.match(finaliseNotes(canonical, draft), /Approved notes/);
  assert.equal(requests.length - start, 6, "FINALISING does not call Gemini");
  await pipeline.close("succeeded");
  const calls = logs.find(([name]) => name === "Gemini usage summary")[1].calls;
  assert.deepEqual(calls.map((call) => call.operation), ["CHECKING_COVERAGE", "CORRECTING_NOTES", "CHECKING_COVERAGE_REAUDIT", "CORRECTING_NOTES_FALLBACK", "CHECKING_COVERAGE_FINAL_REAUDIT", "CHECKING_COVERAGE_POST_STYLE"]);
  assert.deepEqual(calls.map((call) => [call.model, call.thinkingLevel]), requests.slice(start).map((request) => [request.model, request.config.thinkingConfig.thinkingLevel]));
  assert.doesNotMatch(JSON.stringify(logs), /Approved notes|Evidence|Restore|PREVIOUS DRAFT/);
});
