-- CreateTable
CREATE TABLE "TournamentNomination" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentNomination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentNomination_eventId_idx" ON "TournamentNomination"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentNomination_eventId_memberId_key" ON "TournamentNomination"("eventId", "memberId");

-- AddForeignKey
ALTER TABLE "TournamentNomination" ADD CONSTRAINT "TournamentNomination_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentNomination" ADD CONSTRAINT "TournamentNomination_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

