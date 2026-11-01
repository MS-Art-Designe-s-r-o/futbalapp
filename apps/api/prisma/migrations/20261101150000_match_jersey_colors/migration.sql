-- AlterTable
-- DROP COLUMN opponentJerseyColor je zámerný: stĺpec nikdy neniesol zmysluplné dáta (dres súpera sa už nevyberá).
ALTER TABLE "Match" DROP COLUMN "opponentJerseyColor",
ADD COLUMN     "jerseyColors" "JerseyColor"[] DEFAULT ARRAY[]::"JerseyColor"[];

-- Backfill: existujúci jeden dres -> pole
UPDATE "Match" SET "jerseyColors" = ARRAY["jerseyColor"] WHERE "jerseyColor" IS NOT NULL AND cardinality("jerseyColors") = 0;
