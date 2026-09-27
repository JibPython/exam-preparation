/*
  Warnings:

  - Added the required column `storageKey` to the `Source` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "storageKey" TEXT NOT NULL;
