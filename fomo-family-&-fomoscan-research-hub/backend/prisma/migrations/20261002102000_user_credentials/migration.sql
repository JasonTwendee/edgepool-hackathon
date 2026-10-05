-- AlterTable: credential login columns (nullable; wallet users keep NULLs).
ALTER TABLE "users" ADD COLUMN     "username" VARCHAR(32);
ALTER TABLE "users" ADD COLUMN     "email" VARCHAR(100);
ALTER TABLE "users" ADD COLUMN     "password_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
