CREATE TABLE "sales_target" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "period" text NOT NULL,
  "period_type" text DEFAULT 'month' NOT NULL,
  "target_amount" numeric(12,2) NOT NULL,
  "target_deals" integer,
  "currency" text DEFAULT 'EUR' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sales_target_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade
);
