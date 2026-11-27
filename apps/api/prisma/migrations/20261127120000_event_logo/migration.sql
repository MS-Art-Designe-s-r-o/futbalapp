-- AlterTable
ALTER TABLE "Event" ADD COLUMN "logoUrl" TEXT;

-- Logo Mestského futbalového zväzu Košice pri turnaji „Pohár predsedu MFZ Košice“ (súbor je na webe v /logos)
UPDATE "Event"
SET "logoUrl" = 'https://fkknv.sk/logos/mfz-kosice.jpg'
WHERE "type" = 'TOURNAMENT' AND "title" ILIKE '%MFZ Košice%' AND "logoUrl" IS NULL;
