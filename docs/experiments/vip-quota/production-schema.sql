-- CreateTable
CREATE TABLE "PaidQuotaAttempt" (
    "fixtureApiId" INTEGER NOT NULL,
    "experiment" TEXT NOT NULL,
    "kickoffDay" TEXT NOT NULL,
    "spendDay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservedMicroUsd" INTEGER NOT NULL,
    "actualMicroUsd" INTEGER,
    "configJson" TEXT NOT NULL,
    "modelRequests" INTEGER NOT NULL DEFAULT 0,
    "usageReliable" BOOLEAN NOT NULL DEFAULT false,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PaidQuotaAttempt_pkey" PRIMARY KEY ("fixtureApiId")
);

-- CreateIndex
CREATE INDEX "PaidQuotaAttempt_spendDay_idx" ON "PaidQuotaAttempt"("spendDay");

-- CreateIndex
CREATE INDEX "PaidQuotaAttempt_kickoffDay_idx" ON "PaidQuotaAttempt"("kickoffDay");
