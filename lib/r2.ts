import "server-only";

import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./r2-client";

export { r2 };

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
