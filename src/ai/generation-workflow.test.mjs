import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import assert from "node:assert/strict";

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

const events = [];
const auditContexts = [];
const corrections = [];
let source;
let audits;
let failureStage;
let saveError;
let failureStatusError;
let cleanupError;
const outcomes = [];
const canonical = { documentTitle: "Test", topics: [{ title: "Topic", criteria: ["Criterion"] }] };
const draft = { topics: [{ topicIndex: 0, markdown: "- Source-backed notes" }] };
const passed = { passed: true, issues: [] };
const failed = { passed: false, issues: [{ topicIndex: 0, criterionIndex: 0, type: "PARTIAL_COVERAGE", description: "Missing detail", correctionGuidance: "Restore detail" }] };
const work = async (name, value) => {
  events.push(`work:${name}`);
  if (failureStage === name) throw new Error("sensitive-test-error-do-not-expose");
  return value;
};
mock.module("@trigger.dev/sdk", { namedExports: { task: (options) => options } });
mock.module(new URL("../../lib/r2-client.ts", import.meta.url).href, {
  namedExports: { r2: { send: async () => ({ Body: { transformToByteArray: () => work("read", Buffer.from("%PDF-1.7\n%%EOF")) } }) } },
});
mock.module(new URL("../../lib/generation-data.ts", import.meta.url).href, {
  namedExports: {
    findGenerationSource: async () => source,
    setGenerationStage: async (_payload, stage) => { events.push(`stage:${stage}`); },
    failGeneration: async () => { events.push("FAILED"); if (failureStatusError) throw failureStatusError; },
    saveGeneratedNotes: async (_payload, markdown) => { if (saveError) throw saveError; events.push("READY"); assert.ok(markdown.includes("Source-backed notes")); },
  },
});
mock.module(new URL("./note-pipeline.ts", import.meta.url).href, {
  namedExports: { createNotePipeline: () => ({
    organiseTopics: () => work("organise", canonical),
    gatherContent: () => work("gather", {}),
    condenseNotes: () => work("condense", draft),
    checkCoverage: (_organisation, _gathered, _draft, context) => { auditContexts.push(context); return work("audit", audits.shift()); },
    correctNotes: (_organisation, _draft, coverage, variant = "flash") => { corrections.push({ coverage, variant }); return work("correct", draft); },
    checkStyle: () => work("style", draft),
    close: async (outcome) => { outcomes.push(outcome); if (cleanupError) throw cleanupError; },
  }) },
});
process.env.R2_BUCKET_NAME = "test-bucket";
const { generateNotes } = await import("../trigger/generate-notes.ts");
const payload = { topicId: 1, sourceId: 2 };
function reset() {
  events.length = 0;
  auditContexts.length = 0;
  corrections.length = 0;
  failureStage = undefined;
  saveError = undefined;
  failureStatusError = undefined;
  cleanupError = undefined;
  outcomes.length = 0;
  source = { storageKey: "test.pdf", fileName: "test.pdf", fileType: "application/pdf", topic: { generationStatus: "PROCESSING" } };
  audits = [passed, passed];
}

test("real orchestration enters eight stages and skips unnecessary correction work", async () => {
  reset();
  assert.equal((await generateNotes.run(payload)).status, "READY");
  assert.deepEqual(outcomes, ["succeeded"]);
  assert.deepEqual(events, [
    "stage:READING_SOURCE", "work:read",
    "stage:ORGANISING_TOPICS", "work:organise",
    "stage:GATHERING_CONTENT", "work:gather",
    "stage:CONDENSING_NOTES", "work:condense",
    "stage:CHECKING_COVERAGE", "work:audit",
    "stage:CORRECTING_NOTES",
    "stage:CHECKING_STYLE", "work:style", "work:audit",
    "stage:FINALISING", "READY",
  ]);
});

test("coverage issues trigger separate correction and re-audit", async () => {
  reset();
  audits = [failed, passed, passed];
  await generateNotes.run(payload);
  assert.ok(events.includes("work:correct"));
  assert.equal(events.filter((event) => event === "work:audit").length, 3);
  assert.equal(events.at(-1), "READY");
  assert.deepEqual(corrections.map((call) => call.variant), ["flash"]);
  assert.deepEqual(auditContexts.map((context) => context?.type), [undefined, "correction_reaudit", "post_style"]);
  assert.deepEqual(auditContexts[1], { type: "correction_reaudit", previousDraft: draft, coverage: failed });
});

test("failed Flash repair gets exactly one Pro fallback and final re-audit before style", async () => {
  reset();
  const unresolved = { ...failed, issues: [{ ...failed.issues[0], description: "Still missing" }] };
  audits = [failed, unresolved, passed, passed];
  await generateNotes.run(payload);
  assert.deepEqual(corrections, [{ coverage: failed, variant: "flash" }, { coverage: unresolved, variant: "fallback" }]);
  assert.deepEqual(auditContexts.map((context) => context?.type), [undefined, "correction_reaudit", "final_reaudit", "post_style"]);
  assert.deepEqual(auditContexts[2], { type: "final_reaudit", previousDraft: draft, coverage: unresolved });
  assert.equal(events.at(-1), "READY");
});

test("unresolved coverage and style regressions cannot be saved", async () => {
  for (const results of [[failed, failed, failed], [passed, failed], [failed, failed, passed, failed]]) {
    reset();
    audits = results;
    await assert.rejects(generateNotes.run(payload), /Note generation failed/);
    assert.equal(events.at(-1), "FAILED");
    assert.ok(!events.includes("READY"));
    assert.ok(!events.includes("stage:FINALISING"));
    assert.ok(corrections.length <= 2, "at most one Flash and one fallback correction");
    if (results[2] === failed) {
      assert.equal(corrections.filter((call) => call.variant === "fallback").length, 1);
      assert.equal(auditContexts.length, 3, "stops after the final failed re-audit");
      assert.ok(!events.includes("work:style"));
    }
  }
});

test("stage failures mark FAILED and expose only the stage, not raw errors", async () => {
  reset();
  failureStage = "gather";
  await assert.rejects(generateNotes.run(payload), { message: "Note generation failed during GATHERING_CONTENT" });
  assert.equal(events.at(-1), "FAILED");
  assert.ok(!events.includes("work:condense"));
  assert.deepEqual(outcomes, ["failed"]);
});

test("cleanup failures cannot replace READY or the original generation failure", async () => {
  reset();
  cleanupError = new Error("Cleanup unavailable");
  assert.equal((await generateNotes.run(payload)).status, "READY");
  assert.equal(events.at(-1), "READY");
  reset();
  cleanupError = new Error("Cleanup unavailable");
  failureStage = "gather";
  await assert.rejects(generateNotes.run(payload), { message: "Note generation failed during GATHERING_CONTENT" });
  assert.deepEqual(outcomes, ["failed"]);
});

test("completed runs are idempotent and invalid source pairs do no stage work", async () => {
  reset();
  source.topic.generationStatus = "READY";
  assert.equal((await generateNotes.run(payload)).status, "READY");
  assert.deepEqual(events, []);
  source = null;
  await assert.rejects(generateNotes.run(payload));
  assert.deepEqual(events, ["FAILED"]);
});

test("unsupported stored source metadata fails during reading and marks the Topic FAILED", async () => {
  reset();
  source.fileName = "unsupported.exe";
  await assert.rejects(generateNotes.run(payload), /Supported sources:/);
  assert.deepEqual(events, ["stage:READING_SOURCE", "FAILED"]);
});

test("FINALISING logs the original save error before FAILED and sanitises the thrown error", async (t) => {
  reset();
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  saveError = new Error("Null constraint violation on updatedAt");
  await assert.rejects(generateNotes.run(payload), { message: "Note generation failed during FINALISING" });
  assert.equal(events.at(-1), "FAILED");
  assert.ok(!events.includes("READY"));
  assert.equal(logs[0][1].stage, "FINALISING");
  assert.equal(logs[0][1].error.message, saveError.message);
  assert.equal(logs[0][1].operation, "save notes and mark READY");
  failureStatusError = new Error("Connection closed");
  audits = [passed, passed];
  await assert.rejects(generateNotes.run(payload), /could not persist FAILED status/);
  assert.equal(logs.at(-2)[1].error.message, saveError.message);
  assert.equal(logs.at(-1)[1].error.message, failureStatusError.message);
  await assert.rejects(generateNotes.onFailure({ payload }), /Could not persist/);
  assert.equal(logs.at(-1)[1].stage, "onFailure");
});
