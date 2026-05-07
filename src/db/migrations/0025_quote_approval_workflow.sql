ALTER TABLE "quote" ADD COLUMN "approval_note" text;
ALTER TABLE "quote" ADD COLUMN "approved_by_id" text REFERENCES "user"("id") ON DELETE SET NULL;
ALTER TABLE "quote" ADD COLUMN "approved_at" timestamp;
