// Offline client generation/validation: deliberately does not load secret files.
import { defineConfig } from "prisma/config";

export default defineConfig({ schema: "./schema.prisma" });
