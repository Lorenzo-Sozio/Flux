-- Listini: quello che paga questo cliente, invece di quello che dice il catalogo.
--
-- Due modi di dirlo, perche' entrambi sono come si lavora davvero (decisione D4):
-- `adjustment_percent` sposta tutti i prezzi base insieme, e una riga di
-- `price_list_item` fissa il prezzo di un prodotto e vince sulla percentuale.
--
-- Il segno e' la direzione della variazione, non uno sconto: -10 e' il dieci per cento
-- in meno, +5 il cinque per cento in piu'.
--
-- Additiva e rieseguibile, come ogni migrazione tenant.
CREATE TABLE IF NOT EXISTS "price_list" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"adjustment_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_list_item" (
	"id" text PRIMARY KEY NOT NULL,
	"price_list_id" text NOT NULL,
	"product_id" text NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Un solo prezzo per prodotto in ogni listino: una seconda riga renderebbe il prezzo
-- dipendente da quale delle due il lettore trova per prima.
CREATE UNIQUE INDEX IF NOT EXISTS "price_list_item_unique" ON "price_list_item" USING btree ("price_list_id","product_id");
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "price_list_id" text;
--> statement-breakpoint
-- Le chiavi esterne si aggiungono solo se non ci sono gia': ripetere un ADD CONSTRAINT
-- fallirebbe, e ogni migrazione qui deve poter essere rieseguita.
DO $$ BEGIN
	ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_price_list_id_price_list_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_list"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Cancellare un listino non cancella i clienti che lo usavano: restano senza listino,
-- cioe' al prezzo di catalogo.
DO $$ BEGIN
	ALTER TABLE "company" ADD CONSTRAINT "company_price_list_id_price_list_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_list"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
