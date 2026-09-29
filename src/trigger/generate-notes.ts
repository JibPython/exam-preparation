import { GetObjectCommand } from "@aws-sdk/client-s3";
import { task } from "@trigger.dev/sdk";
import { r2 } from "../../lib/r2-client";
import {
  findGenerationSource, setGenerationStage, failGeneration, saveGeneratedNotes,
  type GenerationPayload,
} from "../../lib/generation-data";
import { createNotePipeline } from "../ai/note-pipeline";
import { finaliseNotes } from "../ai/note-contracts";
import { logGenerationError } from "../ai/generation-error";
import type { ProcessingStage } from "../generated/prisma/enums";
import { prepareSourceForGemini } from "../ai/prepare-source";
import { getSourceFormat, MAX_SOURCE_BYTES, SourcePreparationError } from "../../lib/source-formats";

async function readSource(storageKey: string) {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2 bucket is not configured");
  const object = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
  if (!object.Body) throw new Error("R2 returned no source body");
  if (object.ContentLength && object.ContentLength > MAX_SOURCE_BYTES) {
    // Drain no oversized body; destroy the Node stream to release the connection.
    if ("destroy" in object.Body) object.Body.destroy();
    throw new SourcePreparationError("Source must be 10 MB or smaller.");
  }
  return Buffer.from(await object.Body.transformToByteArray());
}

export const generateNotes = task({
  id: "generate-notes",
  queue: { concurrencyLimit: 1 },
  // Avoid a FAILED UI while automatic retries run. Manual retries remain safe.
  retry: { maxAttempts: 1 },

  onFailure: async ({ payload }) => {
    if (!Number.isSafeInteger(payload?.topicId) || !Number.isSafeInteger(payload?.sourceId)) return;
    try {
      await failGeneration(payload);
    } catch (error) {
      logGenerationError("onFailure", error, "persist FAILED status");
      throw new Error("Could not persist final note-generation failure status");
    }
  },

  run: async (payload: GenerationPayload) => {
    if (!Number.isSafeInteger(payload.topicId) || payload.topicId <= 0 ||
        !Number.isSafeInteger(payload.sourceId) || payload.sourceId <= 0) {
      throw new Error("Invalid topicId/sourceId");
    }
    let stage: ProcessingStage = "READING_SOURCE";
    let operation = "find generation source";
    let pipeline: ReturnType<typeof createNotePipeline> | undefined;
    let outcome: "succeeded" | "failed" = "failed";
    const enter = async (next: ProcessingStage) => {
      stage = next;
      operation = "persist processing stage";
      await setGenerationStage(payload, next);
      operation = "execute stage";
    };

    try {
      const source = await findGenerationSource(payload);
      if (!source) throw new Error("Source does not match Topic");
      if (source.topic.generationStatus === "READY") return { topicId: payload.topicId, status: "READY" };
      await enter("READING_SOURCE");
      getSourceFormat(source.fileName, source.fileType);
      const preparedSource = await prepareSourceForGemini(await readSource(source.storageKey), source);
      pipeline = createNotePipeline(preparedSource);
      await enter("ORGANISING_TOPICS");
      const organisation = await pipeline.organiseTopics();
      await enter("GATHERING_CONTENT");
      const gathered = await pipeline.gatherContent(organisation);
      await enter("CONDENSING_NOTES");
      let draft = await pipeline.condenseNotes(organisation, gathered);
      await enter("CHECKING_COVERAGE");
      const coverage = await pipeline.checkCoverage(organisation, gathered, draft);
      await enter("CORRECTING_NOTES");
      if (!coverage.passed) {
        const previousDraft = draft;
        draft = await pipeline.correctNotes(organisation, draft, coverage);
        await enter("CHECKING_COVERAGE");
        const repaired = await pipeline.checkCoverage(organisation, gathered, draft, { type: "correction_reaudit", previousDraft, coverage });
        if (!repaired.passed) {
          // One bounded fallback; unresolved coverage must never reach storage.
          await enter("CORRECTING_NOTES");
          const beforeFallback = draft;
          draft = await pipeline.correctNotes(organisation, draft, repaired, "fallback");
          await enter("CHECKING_COVERAGE");
          const finalRepair = await pipeline.checkCoverage(organisation, gathered, draft, {
            type: "final_reaudit", previousDraft: beforeFallback, coverage: repaired,
          });
          if (!finalRepair.passed) throw new Error("Corrections did not resolve source coverage issues");
        }
      }
      await enter("CHECKING_STYLE");
      draft = await pipeline.checkStyle(organisation, draft);
      // Style edits must not introduce facts or delete restored knowledge.
      const finalCoverage = await pipeline.checkCoverage(organisation, gathered, draft, { type: "post_style" });
      if (!finalCoverage.passed) throw new Error("Style pass did not preserve source coverage");
      await enter("FINALISING");
      operation = "assemble final Markdown";
      const content = finaliseNotes(organisation, draft);
      operation = "save notes and mark READY";
      await saveGeneratedNotes(payload, content);
      outcome = "succeeded";
      return { topicId: payload.topicId, sourceId: payload.sourceId, status: "READY" };
    } catch (error) {
      logGenerationError(stage, error, operation);
      try {
        await failGeneration(payload);
      } catch (failureError) {
        logGenerationError(stage, failureError, "persist FAILED status");
        throw new Error(`Note generation failed during ${stage}; could not persist FAILED status`);
      }
      // Raw SDK/Prisma errors can contain credentials, request data, or PDF content.
      if (error instanceof SourcePreparationError) throw error;
      throw new Error(`Note generation failed during ${stage}`);
    } finally {
      // Temporary Gemini resources and usage reporting must not change READY or
      // replace the original task failure, even if cleanup itself is unavailable.
      try { await pipeline?.close(outcome); }
      catch { console.warn("Gemini cleanup/reporting failed (details omitted)"); }
    }
  },
});
