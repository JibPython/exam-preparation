import test from "node:test";
import assert from "node:assert/strict";
import {
  attachGathered, validateDraft, validateCoverage, finaliseNotes,
  organisationSchema, gatheredSchema,
} from "./note-contracts.ts";
import { noteStyleExamples } from "./note-style-examples.ts";

const organisation = {
  documentTitle: "Source title",
  topics: [
    { title: "First topic", criteria: ["Define X", "Explain Y"] },
    { title: "Second topic", criteria: ["Describe Z"] },
  ],
};
const items = [
  { topicIndex: 1, criterionIndex: 0, gatheredContent: ["Z evidence"] },
  { topicIndex: 0, criterionIndex: 1, gatheredContent: ["Y evidence"] },
  { topicIndex: 0, criterionIndex: 0, gatheredContent: ["X evidence"] },
];

test("gathering attaches out-of-order evidence without changing canonical wording or order", () => {
  const before = structuredClone(organisation);
  const result = attachGathered(organisation, { items });
  assert.deepEqual(organisation, before);
  assert.equal(result.topics[0].title, "First topic");
  assert.deepEqual(result.topics[0].criteria, [
    { criterion: "Define X", gatheredContent: ["X evidence"] },
    { criterion: "Explain Y", gatheredContent: ["Y evidence"] },
  ]);
});

test("gathering rejects missing, duplicate and out-of-range indexes", () => {
  assert.throws(() => attachGathered(organisation, { items: items.slice(1) }));
  assert.throws(() => attachGathered(organisation, { items: [...items, items[0]] }));
  assert.throws(() => attachGathered(organisation, { items: [...items, { ...items[0], topicIndex: 5 }] }));
});

test("empty evidence remains explicit for the auditor, without inventing content", () => {
  const result = attachGathered(organisation, { items: items.map((item) => ({ ...item, gatheredContent: [] })) });
  assert.deepEqual(result.topics[0].criteria[0].gatheredContent, []);
});

test("machine schemas reject regenerated topics and empty organisation", () => {
  assert.equal(gatheredSchema.safeParse({ items, topics: organisation.topics }).success, false);
  assert.equal(organisationSchema.safeParse({ documentTitle: "Nothing", topics: [] }).success, false);
});

test("draft validation rejects missing, duplicate and invented topics", () => {
  assert.throws(() => validateDraft(organisation, { topics: [{ topicIndex: 0, markdown: "X" }] }));
  assert.throws(() => validateDraft(organisation, { topics: [{ topicIndex: 0, markdown: "X" }, { topicIndex: 0, markdown: "Y" }] }));
  assert.throws(() => validateDraft(organisation, { topics: [{ topicIndex: 0, markdown: "X" }, { topicIndex: 5, markdown: "Y" }] }));
});

test("audit cannot claim success alongside issues or reference invented criteria", () => {
  const issue = { topicIndex: 0, criterionIndex: 0, type: "PARTIAL_COVERAGE", description: "Missing X", correctionGuidance: "Restore X" };
  assert.throws(() => validateCoverage(organisation, { passed: true, issues: [issue] }));
  assert.throws(() => validateCoverage(organisation, { passed: false, issues: [] }));
  assert.throws(() => validateCoverage(organisation, { passed: false, issues: [{ ...issue, criterionIndex: 9 }] }));
});

test("finalisation preserves exact note bodies, tables, and visual markers in canonical order", () => {
  const first = "- X → Y\n\n[VISUAL REQUIRED — page 2: labelled diagram]";
  const second = "| A | B |\n|---|---|\n| 1 | 2 |";
  assert.equal(finaliseNotes(organisation, { topics: [
    { topicIndex: 1, markdown: second }, { topicIndex: 0, markdown: first },
  ] }), `# Source title\n\n## First topic\n\n${first}\n\n## Second topic\n\n${second}\n`);
});

test("all eight style examples retain representative user wording", () => {
  assert.equal(noteStyleExamples.length, 8);
  assert.equal(noteStyleExamples[0].condensedNotes, "Allows programs/DS written in diff languages, OS to communicate even if deployed independently");
  assert.ok(noteStyleExamples[1].condensedNotes.includes("don’t have to implement message passing"));
  assert.ok(noteStyleExamples[7].condensedNotes.startsWith("ADD IMAGE FROM SLIDE 8\nADD IMAGE FROM SLIDE 9"));
});
