-- CreateTable
CREATE TABLE "Niche" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT '',
    "period" TEXT NOT NULL DEFAULT 'day',
    "everyHours" INTEGER NOT NULL DEFAULT 6,
    "fetchedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Niche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nicheId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "views" INTEGER NOT NULL,
    "seconds" DOUBLE PRECISION NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT '',
    "clipCreatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Niche_userId_platform_categoryId_key" ON "Niche"("userId", "platform", "categoryId");

-- CreateIndex
CREATE INDEX "Recommendation_userId_views_idx" ON "Recommendation"("userId", "views");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_userId_platform_externalId_key" ON "Recommendation"("userId", "platform", "externalId");

-- AddForeignKey
ALTER TABLE "Niche" ADD CONSTRAINT "Niche_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "Niche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
