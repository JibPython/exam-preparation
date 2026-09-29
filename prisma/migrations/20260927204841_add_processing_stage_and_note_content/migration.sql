/*
  Warnings:

  - Added the required column `content` to the `GeneratedNote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `GeneratedNote` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ProcessingStage" AS ENUM ('READING_SOURCE', 'ORGANISING_TOPICS', 'GATHERING_CONTENT', 'CONDENSING_NOTES', 'CHECKING_COVERAGE', 'CORRECTING_NOTES', 'FINALISING');

-- AlterTable
ALTER TABLE "GeneratedNote" ADD COLUMN     "content" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "processingStage" "ProcessingStage";
