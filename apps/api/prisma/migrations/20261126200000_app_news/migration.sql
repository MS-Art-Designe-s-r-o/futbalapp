-- CreateTable
CREATE TABLE "AppNews" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "videoUrl" TEXT,
    "videoStoragePath" TEXT,
    "videoMimeType" TEXT,
    "videoSize" INTEGER,
    "videoFilename" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "AppNews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppNewsView" (
    "id" TEXT NOT NULL,
    "newsId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppNewsView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppNews_videoStoragePath_key" ON "AppNews"("videoStoragePath");

-- CreateIndex
CREATE INDEX "AppNews_publishedAt_idx" ON "AppNews"("publishedAt");

-- CreateIndex
CREATE INDEX "AppNewsView_userId_idx" ON "AppNewsView"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AppNewsView_newsId_userId_key" ON "AppNewsView"("newsId", "userId");

-- AddForeignKey
ALTER TABLE "AppNewsView" ADD CONSTRAINT "AppNewsView_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "AppNews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppNewsView" ADD CONSTRAINT "AppNewsView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
