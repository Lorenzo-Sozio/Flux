ALTER TABLE "user_invitation" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "user_invitation" ADD COLUMN "tenant_role" text DEFAULT 'editor';