-- Perché una trattativa è stata persa (audit rilievo S-09).
--
-- `deal.lost_reason` esisteva già come testo libero e non lo scriveva nessuno:
-- il prodotto sapeva quanto era stato perso e mai perché. Un campo libero
-- comunque non si aggrega — «prezzo», «Prezzo», «troppo caro» e «costo» sono
-- quattro righe diverse in qualsiasi analisi.
--
-- Serve inoltre la fase di abbandono, che non è ricavabile da `stage_id`: quando
-- la trattativa entra nella colonna «Persa», la fase in cui la conversazione si è
-- davvero fermata è quella precedente, e viene sovrascritta.
--
-- ⚠️ Il driver Neon HTTP non tiene una transazione fra istruzioni: ogni
-- istruzione è additiva e rieseguibile.
CREATE TABLE IF NOT EXISTS "deal_loss_reason" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "loss_reason_id" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "lost_competitor" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "lost_at_stage_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deal" ADD CONSTRAINT "deal_loss_reason_id_fk"
    FOREIGN KEY ("loss_reason_id") REFERENCES "deal_loss_reason"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deal" ADD CONSTRAINT "deal_lost_at_stage_id_fk"
    FOREIGN KEY ("lost_at_stage_id") REFERENCES "pipeline_stage"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
