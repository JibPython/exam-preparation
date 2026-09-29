import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { r2 } from "@/lib/r2";
import {
  verifyTopicOwnership,
  createSource,
  startTopicProcessing,
  setTopicGenerationStatus,
} from "@/lib/dal";
import { tasks } from "@trigger.dev/sdk";
import type { generateNotes } from "@/src/trigger/generate-notes";
import { revalidatePath } from "next/cache";
import { getSourceFormat, MAX_SOURCE_BYTES, SOURCE_ACCEPT, validateSourceBytes } from "@/lib/source-formats";

type TopicSetupProps = {
  topic: {
    id: number;
    name: string;
    generationStatus: string;
  };
  courseId: number;
};

export default function TopicSetup({ topic, courseId }: TopicSetupProps) {
  async function uploadSourceAction(topicId: number, formData: FormData) {
    "use server";

    await verifyTopicOwnership(topicId);

    const file = formData.get("source");

    if (!(file instanceof File)) {
      throw new Error("No file provided");
    }

    const format = getSourceFormat(file.name, file.type);
    if (!file.size || file.size > MAX_SOURCE_BYTES) {
      throw new Error("Source must be non-empty and 10 MB or smaller.");
    }

    const fileName = file.name;
    const fileType = format.mimeType;

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    validateSourceBytes(fileBuffer, format);

    const storageKey = `sources/topics/${topicId}/${randomUUID()}.${format.extension}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: storageKey,
        Body: fileBuffer,
        ContentType: fileType,
      }),
    );

    const source = await createSource({
      topicId,
      fileName,
      fileType,
      storageKey,
    });

    try {
      await startTopicProcessing(topicId);
      await tasks.trigger<typeof generateNotes>("generate-notes", {
        topicId,
        sourceId: source.id,
      }, {
        idempotencyKey: `generate-notes:${source.id}`,
        concurrencyKey: `topic:${topicId}`,
      });
    } catch {
      try {
        await setTopicGenerationStatus(topicId, "FAILED");
      } catch {
        throw new Error("Could not queue note generation or update its failure status.");
      }
      revalidatePath(`/courses/${courseId}/topics/${topicId}`);
      throw new Error("Could not queue note generation. Please try again later.");
    }
    revalidatePath(`/courses/${courseId}/topics/${topicId}`);
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center gap-8 py-32 px-16 bg-white dark:bg-black sm:items-start">
        <h1 className="underline">{topic.name}</h1>

        <p>Upload source material to generate your notes.</p>
        <p>PDF, PPTX, DOCX, PNG, JPEG, WebP, TXT or Markdown. One file, up to 10 MB.</p>
        <form action={uploadSourceAction.bind(null, topic.id)}>
          <input type="file" name="source" accept={SOURCE_ACCEPT} required />

          <button type="submit">Upload source material</button>
        </form>
      </main>
    </div>
  );
}
