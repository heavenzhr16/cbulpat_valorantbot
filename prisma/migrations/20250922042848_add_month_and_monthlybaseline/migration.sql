/*
  Warnings:

  - Added the required column `month` to the `Match` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "MonthlyBaseline" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playerId" INTEGER NOT NULL,
    "month" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MonthlyBaseline_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Match" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "winner" TEXT NOT NULL,
    "score" TEXT,
    "season" TEXT,
    "month" TEXT NOT NULL
);
INSERT INTO "new_Match" ("createdAt", "id", "score", "season", "winner") SELECT "createdAt", "id", "score", "season", "winner" FROM "Match";
DROP TABLE "Match";
ALTER TABLE "new_Match" RENAME TO "Match";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyBaseline_playerId_month_key" ON "MonthlyBaseline"("playerId", "month");
