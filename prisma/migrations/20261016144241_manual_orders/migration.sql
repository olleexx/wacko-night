-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "note" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'ONLINE';
