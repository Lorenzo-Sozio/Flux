-- Lo SLA smette di correre di notte e nei fine settimana (audit rilievo S-07).
--
-- Le scadenze erano calcolate sull'orologio da parete: una promessa di quattro ore
-- su un ticket arrivato venerdì alle 17:00 scadeva alle 21:00 di venerdì, quando
-- non c'era nessuno, e lunedì la squadra leggeva di aver mancato qualcosa che
-- nessuno poteva rispettare. Lo stesso conto sbaglia ogni metrica del supporto
-- nella stessa direzione, in silenzio.
--
-- Il calendario è uno per workspace: una riga sola, con la settimana in JSON
-- perché sono sette voci lette sempre insieme e mai interrogate una per una.
--
-- ⚠️ Il driver Neon HTTP non tiene una transazione fra istruzioni: ogni istruzione
-- è additiva e rieseguibile.
CREATE TABLE IF NOT EXISTS "business_calendar" (
  "id" text PRIMARY KEY NOT NULL,
  "time_zone" text DEFAULT 'Europe/Rome' NOT NULL,
  "week" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_holiday" (
  "id" text PRIMARY KEY NOT NULL,
  "day" text NOT NULL,
  "name" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_holiday_day_idx" ON "business_holiday" ("day");--> statement-breakpoint

-- Le politiche esistenti continuano a misurare come prima finché qualcuno non
-- decide diversamente: cambiare di nascosto il significato di una promessa già
-- presa non è una correzione, è una sorpresa.
ALTER TABLE "sla" ADD COLUMN IF NOT EXISTS "use_business_hours" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- A che punto della finestra è già stato avvisato, per non ripetersi a ogni giro
-- del job: 0 nessun avviso, 50 e 80 le due soglie.
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "sla_warn_level" integer DEFAULT 0 NOT NULL;
