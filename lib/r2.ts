import "server-only";

import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

export const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function deleteR2Objects(storageKeys: string[]) {
  await Promise.all(
    storageKeys.map((storageKey) =>
      r2.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: storageKey,
        }),
      ),
    ),
  );
}
