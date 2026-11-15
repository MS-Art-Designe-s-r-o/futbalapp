-- CreateTable
CREATE TABLE "MatchLineupShare" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchLineupShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchLineupComment" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchLineupComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchLineupShare_matchId_userId_key" ON "MatchLineupShare"("matchId", "userId");

-- CreateIndex
CREATE INDEX "MatchLineupComment_matchId_createdAt_idx" ON "MatchLineupComment"("matchId", "createdAt");

-- AddForeignKey
ALTER TABLE "MatchLineupShare" ADD CONSTRAINT "MatchLineupShare_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchLineupShare" ADD CONSTRAINT "MatchLineupShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchLineupComment" ADD CONSTRAINT "MatchLineupComment_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchLineupComment" ADD CONSTRAINT "MatchLineupComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
