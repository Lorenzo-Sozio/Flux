ALTER TABLE "quote" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_public_token_unique" UNIQUE("public_token");