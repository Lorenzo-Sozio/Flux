-- Una riga d'ordine può ora dire cosa vende senza essere a catalogo (rilievo S-03).
--
-- `order_item.product_id` era NOT NULL mentre `quote_item.product_id` è sempre
-- stato nullable: un preventivo con una riga a testo libero — una personalizzazione,
-- una giornata di consulenza, uno sconto una tantum — non poteva quindi diventare
-- un ordine. È la forma più comune di preventivo, quindi la conversione sarebbe
-- fallita proprio dove serve.
--
-- La riga d'ordine prende anche `description`, come quella di preventivo, altrimenti
-- una riga senza prodotto non avrebbe modo di dire cosa sia.
--
-- ⚠️ Il driver Neon HTTP non tiene una transazione fra istruzioni: ogni istruzione
-- è scritta per poter essere rieseguita senza fallire.
ALTER TABLE "order_item" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "description" text;
