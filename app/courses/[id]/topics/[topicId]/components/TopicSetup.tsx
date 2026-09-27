import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { r2 } from "@/lib/r2";
import {
  verifyTopicOwnership,
  createSource,
  setTopicGenerationStatus,
} from "@/lib/dal";
import { revalidatePath } from "next/cache";

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

    if (file.type !== "application/pdf") {
      throw new Error("Only PDF files are supported");
    }

    const maxSize = 10 * 1024 * 1024;

    if (file.size > maxSize) {
      throw new Error("PDF must be 10 MB or smaller");
    }

    const fileName = file.name;
    const fileType = file.type;

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const storageKey = `sources/topics/${topicId}/${randomUUID()}.pdf`;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: storageKey,
        Body: fileBuffer,
        ContentType: fileType,
      }),
    );

    await createSource({
      topicId,
      fileName,
      fileType,
      storageKey,
    });

    await setTopicGenerationStatus(topicId, "PROCESSING");

    revalidatePath(`/courses/${courseId}/topics/${topicId}`);
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center gap-8 py-32 px-16 bg-white dark:bg-black sm:items-start">
        <h1 className="underline">{topic.name}</h1>

        <p>Upload source material to generate your notes.</p>
        <form action={uploadSourceAction.bind(null, topic.id)}>
          <input type="file" name="source" accept="application/pdf" required />

          <button type="submit">Upload PDF</button>
        </form>
      </main>
    </div>
  );
}
