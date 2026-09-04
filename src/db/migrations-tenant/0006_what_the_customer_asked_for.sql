-- Un ordine può portare una nota, come già la porta un preventivo.
--
-- `quote.notes` esiste da sempre e `order.notes` no: il preventivo poteva dire
-- «consegnare al piano terra, citofono Rossi» e l'ordine che ne nasce, cioè il
-- documento che qualcuno prepara davvero, no. L'asimmetria si vedeva poco finché gli
-- ordini nascevano solo dai preventivi.
--
-- Si vede adesso, perché un ordine può arrivare da un assistente che l'ha preso a
-- parole: ritiro o consegna, per quando, a che indirizzo. Sono le tre cose che un
-- operatore deve leggere per prepararlo, e senza questa colonna finivano nel nulla —
-- l'ordine compariva con le righe giuste e nessuno sapeva se andasse consegnato.
--
-- ⚠️ Il driver Neon HTTP non tiene una transazione fra istruzioni: ogni istruzione è
-- scritta per poter essere rieseguita senza fallire.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint

-- E la **riga** può dire per esteso che cosa è stato chiesto.
--
-- `description` dice che cosa si prepara — la voce del listino, quella a cui il prezzo
-- appartiene — e non è il posto dove infilare anche il resto: chi legge un ordine deve
-- poter distinguere l'articolo dalle indicazioni, e un unico campo che li mescola si
-- legge male proprio quando ci sono entrambi.
--
-- Ci finiscono due cose. Le **modifiche** che il cliente ha chiesto su quella riga, con
-- le sue parole: «poco piccante» cambia come si prepara la pizza, e senza un posto dove
-- scriverlo l'ordine si prepara sbagliato. E **come l'ha chiamata**, quando è diverso
-- dalla voce di listino: chi ha preso l'ordine ha fatto una corrispondenza, e questa è
-- l'unica riga su cui una persona può accorgersi che era sbagliata.
ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "notes" text;
