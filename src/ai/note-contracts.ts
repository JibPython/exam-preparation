import { z } from "zod";

const text = z.string().trim().min(1);
const index = z.number().int().nonnegative();

export const organisationSchema = z.object({
  documentTitle: text,
  topics: z.array(z.object({ title: text, criteria: z.array(text).min(1) }).strict()).min(1),
}).strict();
export type Organisation = z.infer<typeof organisationSchema>;

export const gatheredSchema = z.object({
  items: z.array(z.object({
    topicIndex: index,
    criterionIndex: index,
    gatheredContent: z.array(text),
  }).strict()),
}).strict();
export type Gathered = z.infer<typeof gatheredSchema>;

export const draftSchema = z.object({
  topics: z.array(z.object({ topicIndex: index, markdown: text }).strict()).min(1),
}).strict();
export type Draft = z.infer<typeof draftSchema>;

export const coverageSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.object({
    topicIndex: index,
    criterionIndex: index,
    type: z.enum(["MISSING_INFORMATION", "PARTIAL_COVERAGE", "FACTUAL_ERROR", "LOST_RELATIONSHIP", "LOST_TECHNICAL_DETAIL", "MISSING_VISUAL", "UNSUPPORTED_ADDITION", "CONTRADICTION"]),
    description: text,
    correctionGuidance: text,
  }).strict()),
}).strict();
export type Coverage = z.infer<typeof coverageSchema>;

export function attachGathered(organisation: Organisation, gathered: Gathered) {
  const items = new Map<string, string[]>();
  for (const item of gathered.items) {
    const key = `${item.topicIndex}:${item.criterionIndex}`;
    if (!organisation.topics[item.topicIndex]?.criteria[item.criterionIndex] || items.has(key)) {
      throw new Error("Gathering returned duplicate or invalid criterion indexes");
    }
    items.set(key, item.gatheredContent);
  }
  return {
    documentTitle: organisation.documentTitle,
    topics: organisation.topics.map((topic, topicIndex) => ({
      title: topic.title,
      criteria: topic.criteria.map((criterion, criterionIndex) => {
        const gatheredContent = items.get(`${topicIndex}:${criterionIndex}`);
        if (!gatheredContent) throw new Error("Gathering omitted a canonical criterion");
        return { criterion, gatheredContent };
      }),
    })),
  };
}

export function validateDraft(organisation: Organisation, draft: Draft): Draft {
  const indexes = new Set(draft.topics.map((topic) => topic.topicIndex));
  if (indexes.size !== organisation.topics.length || draft.topics.length !== indexes.size ||
      draft.topics.some((topic) => !organisation.topics[topic.topicIndex])) {
    throw new Error("Draft changed the canonical topic structure");
  }
  return { topics: [...draft.topics].sort((a, b) => a.topicIndex - b.topicIndex) };
}

export function validateCoverage(organisation: Organisation, coverage: Coverage): Coverage {
  if (coverage.passed !== (coverage.issues.length === 0) || coverage.issues.some(
    (issue) => !organisation.topics[issue.topicIndex]?.criteria[issue.criterionIndex],
  )) throw new Error("Coverage audit returned inconsistent results or invalid indexes");
  return coverage;
}

export function finaliseNotes(organisation: Organisation, draft: Draft): string {
  const checked = validateDraft(organisation, draft);
  // Escape headings only; preserve the approved note bodies byte-for-byte.
  const heading = (value: string) => value.replace(/\s+/g, " ").replace(/([\\`*_{}\[\]<>()#!|])/g, "\\$1");
  return `# ${heading(organisation.documentTitle)}\n\n${checked.topics.map(
    (topic) => `## ${heading(organisation.topics[topic.topicIndex].title)}\n\n${topic.markdown}`,
  ).join("\n\n")}\n`;
}
