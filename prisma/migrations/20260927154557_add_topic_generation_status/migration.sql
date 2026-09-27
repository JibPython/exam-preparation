-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('NOT_STARTED', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "generationStatus" "GenerationStatus" NOT NULL DEFAULT 'NOT_STARTED';
