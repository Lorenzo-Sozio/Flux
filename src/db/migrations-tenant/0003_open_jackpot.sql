-- Rimuove la tabella `opportunity` (audit rilievo D-06).
--
-- Nessuna query, nessuna azione e nessuna interfaccia l'ha mai letta: era rimasta
-- da un modello precedente, sostituita dalle trattative. Verificato vuota su ogni
-- tenant prima di generare questa migrazione, e nessun ordine la referenziava.
--
-- ⚠️ È l'unica migrazione distruttiva del progetto. Ogni istruzione è scritta per
-- poter essere rieseguita senza fallire, perché il driver Neon HTTP non tiene una
-- transazione fra istruzioni: un errore a metà lascia applicato ciò che precede.
--
-- L'ordine conta. `DROP TABLE ... CASCADE` rimuove già il vincolo dalla tabella
-- `order`, quindi il DROP CONSTRAINT generato automaticamente veniva dopo e
-- falliva su un vincolo ormai inesistente.
ALTER TABLE "order" DROP CONSTRAINT IF EXISTS "order_opportunity_id_opportunity_id_fk";--> statement-breakpoint
ALTER TABLE "order" DROP COLUMN IF EXISTS "opportunity_id";--> statement-breakpoint
DROP TABLE IF EXISTS "opportunity" CASCADE;
