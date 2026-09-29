import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { finaliseNotes } from "./note-contracts.ts";
import { logGenerationError } from "./generation-error.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"].includes(error.code) && specifier.startsWith(".")) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

let state;
let failAt;
const payload = { topicId: 1, sourceId: 2 };
mock.module(new URL("../../prisma.ts", import.meta.url).href, { namedExports: { prisma: {
  $transaction: async (callback) => {
    const pending = structuredClone(state);
    await callback({
      topic: { update: async ({ where, data }) => {
        assert.deepEqual(where, { id: 1, sources: { some: { id: 2 } } });
        if (failAt === "topic") throw new Error("Topic update failed");
        Object.assign(pending.topic, data);
      } },
      generatedNote: { upsert: async ({ where, create, update }) => {
        assert.deepEqual(where, { topicId: 1 });
        if (failAt === "note") throw new Error("Note insert failed");
        pending.notes[where.topicId] = pending.notes[where.topicId]
          ? { ...pending.notes[where.topicId], ...update } : create;
      } },
    });
    if (failAt === "commit") throw new Error("Commit failed");
    state = pending;
  },
} } });
const { saveGeneratedNotes } = await import("../../lib/generation-data.ts");

test("verified draft assembles, saves atomically, and retries update one note", async () => {
  state = { topic: { generationStatus: "PROCESSING", processingStage: "FINALISING" }, notes: {} };
  failAt = undefined;
  const markdown = finaliseNotes(
    { documentTitle: "Test", topics: [{ title: "Topic", criteria: ["Criterion"] }] },
    { topics: [{ topicIndex: 0, markdown: "- Approved note" }] },
  );
  assert.equal(markdown, "# Test\n\n## Topic\n\n- Approved note\n");
  await saveGeneratedNotes(payload, markdown);
  assert.deepEqual(state.topic, { generationStatus: "READY", processingStage: null });
  assert.equal(state.notes[1].content, markdown);
  await saveGeneratedNotes(payload, `${markdown}Updated\n`);
  assert.equal(Object.keys(state.notes).length, 1);
  assert.equal(state.notes[1].content, `${markdown}Updated\n`);
});

test("topic, upsert, and commit errors propagate without publishing READY", async () => {
  for (const failure of ["topic", "note", "commit"]) {
    state = { topic: { generationStatus: "PROCESSING", processingStage: "FINALISING" }, notes: {} };
    const before = structuredClone(state);
    failAt = failure;
    await assert.rejects(saveGeneratedNotes(payload, "Notes"), /failed/);
    assert.deepEqual(state, before);
  }
});

test("schema and generated client retain timestamps required by the migration", async () => {
  const generated = await readFile(new URL("../generated/prisma/internal/class.ts", import.meta.url), "utf8");
  const embeddedSchema = JSON.parse(generated.match(/"inlineSchema":\s*("(?:\\.|[^"\\])*")/)[1]);
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20260927204841_add_processing_stage_and_note_content/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /"updatedAt" TIMESTAMP\(3\) NOT NULL;/);
  for (const source of [schema, embeddedSchema]) {
    const model = source.match(/model GeneratedNote \{([^}]+)\}/)[1];
    assert.match(model, /updatedAt\s+DateTime\s+@updatedAt/, "Prisma must supply the required timestamp");
    assert.match(model, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
    assert.match(model, /topicId\s+Int\s+@unique/);
  }
});

test("diagnostics retain technical error and frames but omit credentials and payloads", (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const error = new Error("Null constraint violation on the fields: (`updatedAt`)");
  error.code = "P2011";
  error.meta = { source: "private source" };
  logGenerationError("FINALISING", error, "save notes and mark READY");
  assert.equal(logs[0][1].error.message, error.message);
  assert.equal(logs[0][1].error.code, "P2011");
  assert.match(logs[0][1].error.stack, /finalisation.test.mjs/);
  for (const message of [
    "Connection failed postgresql://user:fake-password@host/db",
    "API_KEY=fake-key Bearer fake-token",
    'request: { content: "private source" }',
    'Invalid invocation\n{\n content: "private source"\n})\nNull constraint violation',
  ]) logGenerationError("FINALISING", new Error(message), "save");
  logGenerationError("FINALISING", { bytes: "private source" }, "save");
  assert.doesNotMatch(JSON.stringify(logs), /fake-password|fake-key|fake-token|private source/);
});
