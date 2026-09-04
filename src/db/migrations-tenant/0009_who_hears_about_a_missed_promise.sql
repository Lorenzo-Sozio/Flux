-- Escalation on an SLA policy goes to a group (audit rilievo S-07).
--
-- The remedy asked for escalation "to the manager", and the schema has no
-- hierarchy: a user has no manager, and adding one means an org chart somebody
-- has to keep true. A support team already exists here as a user group, so the
-- policy names a group and the people in it hear about the breach. It works on
-- day one for a team of three, and nobody has to declare who reports to whom.
--
-- Nullable, and null on every policy that exists today: a workspace that has not
-- chosen a group keeps exactly the behaviour it has now, which is that the person
-- holding the ticket is warned and nobody else.
ALTER TABLE "sla" ADD COLUMN IF NOT EXISTS "escalation_group_id" text;
--> statement-breakpoint
-- Separately, and guarded, because a constraint cannot be added twice and this
-- migration may be re-applied to a database that already has it.
DO $$
BEGIN
  ALTER TABLE "sla"
    ADD CONSTRAINT "sla_escalation_group_id_user_group_id_fk"
    FOREIGN KEY ("escalation_group_id") REFERENCES "user_group"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;
