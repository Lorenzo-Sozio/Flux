CREATE TABLE "deal_comment" (
  "id" text PRIMARY KEY NOT NULL,
  "deal_id" text NOT NULL,
  "user_id" text NOT NULL,
  "content" text NOT NULL,
  "parent_id" text,
  "edited_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "deal_comment" ADD CONSTRAINT "deal_comment_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deal_comment" ADD CONSTRAINT "deal_comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deal_comment" ADD CONSTRAINT "deal_comment_parent_id_deal_comment_id_fk" FOREIGN KEY ("parent_id") REFERENCES "deal_comment"("id") ON DELETE set null ON UPDATE no action;
