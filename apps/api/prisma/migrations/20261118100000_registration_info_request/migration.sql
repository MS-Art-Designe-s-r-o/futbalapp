ALTER TABLE "RegistrationRequest"
  ADD COLUMN "infoToken" TEXT,
  ADD COLUMN "infoRequestedAt" TIMESTAMP(3),
  ADD COLUMN "infoExpiresAt" TIMESTAMP(3),
  ADD COLUMN "infoReceivedAt" TIMESTAMP(3),
  ADD COLUMN "infoMotherClub" TEXT,
  ADD COLUMN "infoGuestClub" TEXT,
  ADD COLUMN "infoClubAffiliation" TEXT,
  ADD COLUMN "requestedTeamId" TEXT;

CREATE UNIQUE INDEX "RegistrationRequest_infoToken_key" ON "RegistrationRequest"("infoToken");
