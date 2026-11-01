-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "parentEventId" TEXT,
ADD COLUMN     "tournamentOrder" INTEGER;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "isFriendly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TournamentParticipant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "clubName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TournamentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TournamentParticipant_eventId_clubName_key" ON "TournamentParticipant"("eventId", "clubName");

-- CreateIndex
CREATE INDEX "Event_parentEventId_idx" ON "Event"("parentEventId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
