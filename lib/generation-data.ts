// Trusted worker data access; no browser session or Next.js server-only marker.
import { prisma } from "../prisma";
import type { ProcessingStage } from "../src/generated/prisma/enums";

export type GenerationPayload = { topicId: number; sourceId: number };

export async function findGenerationSource({ topicId, sourceId }: GenerationPayload) {
  return prisma.source.findFirst({
    where: { id: sourceId, topicId },
    select: { storageKey: true, fileName: true, fileType: true, topic: { select: { generationStatus: true } } },
  });
}

export async function setGenerationStage(payload: GenerationPayload, processingStage: ProcessingStage) {
  await prisma.topic.update({
    where: { id: payload.topicId, sources: { some: { id: payload.sourceId } } },
    data: { generationStatus: "PROCESSING", processingStage },
  });
}

export async function failGeneration(payload: GenerationPayload) {
  await prisma.topic.updateMany({
    where: {
      id: payload.topicId,
      sources: { some: { id: payload.sourceId } },
      generationStatus: { not: "READY" },
    },
    data: { generationStatus: "FAILED", processingStage: null },
  });
}

export async function saveGeneratedNotes(payload: GenerationPayload, content: string) {
  // The note and READY become visible together; the unique topicId prevents duplicates.
  await prisma.$transaction(async (tx) => {
    await tx.topic.update({
      where: { id: payload.topicId, sources: { some: { id: payload.sourceId } } },
      data: { generationStatus: "READY", processingStage: null },
    });
    await tx.generatedNote.upsert({
      where: { topicId: payload.topicId },
      create: { topicId: payload.topicId, content },
      update: { content },
    });
  });
}
