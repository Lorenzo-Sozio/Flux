// ⚠️ First, and as a side effect: `src/db` reads DATABASE_URL while it is imported.
import "dotenv/config";

import { eq } from "drizzle-orm";

import { createTenantDb, platformDb } from "../db";
import {
  activities,
  appointments,
  companies,
  contacts,
  contracts,
  deals,
  leads,
  orderItems,
  orders,
  pipelineStages,
  priceListItems,
  priceLists,
  products,
  quoteItems,
  quotes,
  tasks,
  tickets,
  users,
} from "../db/schema";
import { sameDatabase } from "../lib/db-url";

/**
 * Fills a workspace with a plausible business, for looking at the product with
 * something in it. A landscape gardening firm: maintenance contracts with blocks of
 * flats and hotels, one-off jobs for private gardens, a catalogue priced by the hour,
 * the square metre and the plant.
 *
 *   npx tsx src/scripts/seed-demo.ts postgresql://…/workspace [admin@example.com]
 *
 * ⚠️ **Demonstration data, and it says so.** Every row it writes has an id beginning
 * `demo-`, so it can be found and removed afterwards, and re-running adds nothing it
 * has already written. It is not a fixture for tests — those build their own — and it
 * must never be pointed at a workspace with real customers in it.
 */
const url = process.argv[2];
const adminEmail = (process.argv[3] ?? "admin@flux.local").trim().toLowerCase();

if (!url) {
  console.error("Usage: npx tsx src/scripts/seed-demo.ts <workspace-postgres-url> [admin-email]");
  process.exit(1);
}
// The registry is not a workspace: the same guard the admin panel applies.
if (sameDatabase(url, process.env.DATABASE_URL)) {
  console.error("That is the platform database. Pass a workspace's own connection string.");
  process.exit(1);
}

const db = createTenantDb("seed-demo", url);

/** Days from today, as a date. Negative is the past. */
function day(offset: number): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}
const iso = (offset: number) => day(offset).toISOString().slice(0, 10);
const money = (n: number) => n.toFixed(2);

async function seed() {
  // ── Who the work belongs to ────────────────────────────────────────────────
  //
  // Owner ids point at the workspace's own `user` table, which is filled from the
  // platform registry when somebody is added to the workspace. The seed needs one to
  // hang everything on, so it copies the administrator across if it is not there yet.
  const [admin] = await platformDb.select().from(users).where(eq(users.email, adminEmail));
  if (!admin) {
    console.error(`No platform account for ${adminEmail}. Create one first, or pass another address.`);
    process.exit(1);
  }
  await db
    .insert(users)
    .values({ id: admin.id, name: admin.name ?? "Titolare", email: admin.email ?? adminEmail, role: "owner" })
    .onConflictDoNothing();
  const owner = admin.id;

  const stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);
  if (stages.length === 0) {
    console.error("This workspace has no pipeline stages: migrate and seed it from the admin panel first.");
    process.exit(1);
  }
  const stageAt = (i: number) => stages[Math.min(i, stages.length - 1)].id;
  const wonStage = stages.find((s) => s.isWon) ?? stages[stages.length - 1];
  const lostStage = stages.find((s) => s.isLost) ?? stages[stages.length - 1];

  // ── The catalogue ──────────────────────────────────────────────────────────
  const catalogue = [
    ["prato-mq", "Manutenzione prato", "Taglio, rifilatura bordi e raccolta", "GIA-PRA-01", 1.8, "mq"],
    ["taglio-ora", "Taglio erba a ore", "Intervento con operatore e attrezzatura", "GIA-TAG-01", 28, "ora"],
    ["siepe-ml", "Potatura siepe", "Potatura e sagomatura, smaltimento incluso", "GIA-SIE-01", 6.5, "ml"],
    ["alberi-ora", "Potatura alberi ad alto fusto", "Con piattaforma aerea, due operatori", "GIA-ALB-01", 45, "ora"],
    [
      "irrigazione-mq",
      "Impianto di irrigazione a goccia",
      "Fornitura e posa, esclusa centralina",
      "GIA-IRR-01",
      12.5,
      "mq",
    ],
    ["centralina", "Centralina irrigazione 6 zone", "Programmabile, con sensore pioggia", "GIA-IRR-02", 210, "pz"],
    ["rotoli-mq", "Prato a rotoli", "Fornitura e posa su terreno preparato", "GIA-PRA-02", 9.9, "mq"],
    ["semina-mq", "Semina prato", "Preparazione del terreno e semina", "GIA-PRA-03", 3.2, "mq"],
    ["terriccio", "Terriccio universale 70 L", "Sacco da 70 litri", "GIA-MAT-01", 8.5, "sacco"],
    ["corteccia", "Corteccia decorativa 50 L", "Pacciamatura, sacco da 50 litri", "GIA-MAT-02", 6.9, "sacco"],
    ["lauro", "Lauroceraso h. 150 cm", "Pianta in vaso, per siepi", "GIA-PIA-01", 18, "pz"],
    ["acero", "Acero rosso", "Pianta in zolla, h. 250 cm", "GIA-PIA-02", 65, "pz"],
    ["progetto", "Progettazione del giardino", "Rilievo, tavole e computo metrico", "GIA-PRO-01", 350, "a corpo"],
    ["smaltimento", "Smaltimento verde", "Trasporto e conferimento in discarica", "GIA-SMA-01", 35, "mc"],
    [
      "antiparassitario",
      "Trattamento antiparassitario",
      "Endoterapia o irrorazione, per pianta",
      "GIA-TRA-01",
      90,
      "intervento",
    ],
  ] as const;

  await db
    .insert(products)
    .values(
      catalogue.map(([id, name, description, sku, price, unit]) => ({
        id: `demo-prod-${id}`,
        name,
        description,
        sku,
        price: money(price),
        taxPercent: "22",
        unit,
        category: "Giardinaggio",
        isActive: true,
      })),
    )
    .onConflictDoNothing();

  // ── Price lists ────────────────────────────────────────────────────────────
  await db
    .insert(priceLists)
    .values([
      {
        id: "demo-pl-privati",
        name: "Privati",
        description: "Listino di riferimento, prezzi di catalogo",
        adjustmentPercent: "0",
      },
      {
        id: "demo-pl-condomini",
        name: "Condomini e amministratori",
        description: "Volumi ricorrenti, sconto sul listino base",
        adjustmentPercent: "-8",
      },
      {
        id: "demo-pl-enti",
        name: "Enti pubblici",
        description: "Convenzioni e gare, con prezzi concordati su alcune voci",
        adjustmentPercent: "-12",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(priceListItems)
    .values([
      { id: "demo-pli-1", priceListId: "demo-pl-enti", productId: "demo-prod-prato-mq", unitPrice: "1.40" },
      { id: "demo-pli-2", priceListId: "demo-pl-enti", productId: "demo-prod-siepe-ml", unitPrice: "5.20" },
      { id: "demo-pli-3", priceListId: "demo-pl-condomini", productId: "demo-prod-taglio-ora", unitPrice: "25.00" },
    ])
    .onConflictDoNothing();

  // ── Customers ──────────────────────────────────────────────────────────────
  const customers = [
    [
      "terrazze",
      "Condominio Le Terrazze",
      "Amministrazione condominiale",
      "demo-pl-condomini",
      "Via Silvio Pellico 12",
      "Bergamo",
      "BG",
      "24122",
    ],
    [
      "bianchi",
      "Studio Amministrazioni Bianchi",
      "Gestisce undici condomini in città",
      "demo-pl-condomini",
      "Viale Papa Giovanni XXIII 58",
      "Bergamo",
      "BG",
      "24121",
    ],
    [
      "serena",
      "Hotel Villa Serena",
      "Parco di 4.000 mq e due terrazze",
      "demo-pl-privati",
      "Via del Lago 3",
      "Sarnico",
      "BG",
      "24067",
    ],
    [
      "treviolo",
      "Comune di Treviolo",
      "Verde pubblico, appalto triennale",
      "demo-pl-enti",
      "Piazza Municipio 1",
      "Treviolo",
      "BG",
      "24048",
    ],
    [
      "glicine",
      "Ristorante Il Glicine",
      "Dehors e pergolato",
      "demo-pl-privati",
      "Via Borgo Palazzo 101",
      "Bergamo",
      "BG",
      "24125",
    ],
    [
      "tigli",
      "Residence I Tigli",
      "Aree comuni e piscina",
      "demo-pl-condomini",
      "Via Tiraboschi 22",
      "Dalmine",
      "BG",
      "24044",
    ],
    [
      "verdi",
      "Azienda Agricola Verdi",
      "Vivaio, fornitore e cliente",
      "demo-pl-privati",
      "Cascina Bassa 7",
      "Stezzano",
      "BG",
      "24040",
    ],
    [
      "golf",
      "Golf Club La Rotonda",
      "Diciotto buche, manutenzione stagionale",
      "demo-pl-enti",
      "Via Campi 44",
      "Curno",
      "BG",
      "24035",
    ],
  ] as const;

  await db
    .insert(companies)
    .values(
      customers.map(([id, name, notes, priceListId, street, city, state, zipCode], i) => ({
        id: `demo-co-${id}`,
        name,
        industry: "Giardinaggio e verde",
        website: `https://www.${id}.example.it`,
        phone: `035 ${200000 + i * 137}`,
        email: `info@${id}.example.it`,
        street,
        city,
        state,
        zipCode,
        country: "Italia",
        language: "it",
        notes,
        priceListId,
        ownerId: owner,
        vatNumber: `0${3456789012 + i}`,
      })),
    )
    .onConflictDoNothing();

  const people = [
    ["rossi", "Marco", "Rossi", "Amministratore", "demo-co-terrazze"],
    ["bianchi", "Elena", "Bianchi", "Titolare dello studio", "demo-co-bianchi"],
    ["conti", "Giulia", "Conti", "Direttrice", "demo-co-serena"],
    ["ferrari", "Paolo", "Ferrari", "Responsabile ufficio tecnico", "demo-co-treviolo"],
    ["greco", "Anna", "Greco", "Titolare", "demo-co-glicine"],
    ["moretti", "Luca", "Moretti", "Amministratore di condominio", "demo-co-tigli"],
    ["verdi", "Sara", "Verdi", "Responsabile vivaio", "demo-co-verdi"],
    ["barbieri", "Davide", "Barbieri", "Segretario del circolo", "demo-co-golf"],
    ["rinaldi", "Chiara", "Rinaldi", "Consigliere condominiale", "demo-co-terrazze"],
    ["gatti", "Stefano", "Gatti", "Manutenzione interna", "demo-co-serena"],
  ] as const;

  await db
    .insert(contacts)
    .values(
      people.map(([id, firstName, lastName, position, companyId], i) => ({
        id: `demo-ct-${id}`,
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.it`,
        phone: `035 ${300000 + i * 211}`,
        mobile: `34${i} 1${200000 + i * 173}`,
        position,
        companyId,
        ownerId: owner,
        language: "it",
        city: "Bergamo",
        country: "Italia",
      })),
    )
    .onConflictDoNothing();

  // ── Leads: the work that has not been qualified yet ────────────────────────
  const prospects = [
    [
      "fumagalli",
      "Marta",
      "Fumagalli",
      "Giardino privato 300 mq, vuole un preventivo per l'impianto di irrigazione",
      "sito web",
      "new",
    ],
    ["locatelli", "Andrea", "Locatelli", "Siepe di 40 metri da potare due volte l'anno", "passaparola", "contacting"],
    ["pellegrini", "Sofia", "Pellegrini", "Nuova villetta, prato da rifare completamente", "fiera", "engaged"],
    [
      "carminati",
      "Roberto",
      "Carminati",
      "Amministra tre condomini, cerca un unico fornitore",
      "passaparola",
      "qualified",
    ],
    ["donati", "Ilaria", "Donati", "Terrazzo con fioriere, manutenzione mensile", "google", "new"],
    ["mazzoleni", "Giorgio", "Mazzoleni", "Abbattimento di due pioppi pericolanti", "telefono", "contacting"],
    ["riva", "Valentina", "Riva", "Bed and breakfast, giardino da riprogettare", "sito web", "engaged"],
    ["sangalli", "Matteo", "Sangalli", "Solo preventivo, budget molto basso", "google", "unqualified"],
    ["bonomi", "Francesca", "Bonomi", "Piscina con area verde attorno, 800 mq", "fiera", "qualified"],
    ["perico", "Alessandro", "Perico", "Vuole un contratto di manutenzione annuale", "sito web", "engaged"],
  ] as const;

  await db
    .insert(leads)
    .values(
      prospects.map(([id, firstName, lastName, notes, source, status], i) => ({
        id: `demo-ld-${id}`,
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        phone: `03${i} 4${100000 + i * 97}`,
        companyName: i % 3 === 0 ? "Privato" : null,
        source,
        status,
        notes,
        ownerId: owner,
        city: ["Bergamo", "Seriate", "Albino", "Curno", "Treviolo"][i % 5],
        country: "Italia",
        createdAt: day(-40 + i * 3),
      })),
    )
    .onConflictDoNothing();

  // ── The pipeline ───────────────────────────────────────────────────────────
  const pipeline = [
    ["terrazze-irr", "Impianto irrigazione Le Terrazze", 8400, 0, "demo-co-terrazze", "demo-ct-rossi", 20, 18],
    ["serena-parco", "Riqualificazione parco Villa Serena", 21500, 1, "demo-co-serena", "demo-ct-conti", 40, 35],
    ["treviolo-verde", "Verde pubblico Treviolo 2027", 46000, 2, "demo-co-treviolo", "demo-ct-ferrari", 55, 60],
    ["glicine-dehors", "Pergolato e fioriere Il Glicine", 3800, 1, "demo-co-glicine", "demo-ct-greco", 35, 21],
    ["tigli-manut", "Manutenzione aree comuni I Tigli", 12600, 3, "demo-co-tigli", "demo-ct-moretti", 70, 14],
    ["golf-stagione", "Manutenzione stagionale Golf Club", 33000, 2, "demo-co-golf", "demo-ct-barbieri", 50, 45],
    ["bianchi-quadro", "Accordo quadro Studio Bianchi", 18000, 3, "demo-co-bianchi", "demo-ct-bianchi", 65, 30],
    ["verdi-forniture", "Fornitura piante Azienda Verdi", 5200, 0, "demo-co-verdi", "demo-ct-verdi", 25, 25],
    ["terrazze-prato", "Rifacimento prato Le Terrazze", 6900, 1, "demo-co-terrazze", "demo-ct-rinaldi", 30, 28],
  ] as const;

  await db
    .insert(deals)
    .values([
      ...pipeline.map(([id, name, amount, stageIndex, companyId, contactId, probability, closeIn]) => ({
        id: `demo-dl-${id}`,
        name,
        amount: money(amount),
        currency: "EUR",
        stageId: stageAt(stageIndex),
        companyId,
        contactId,
        ownerId: owner,
        probability,
        status: "open",
        expectedCloseDate: day(closeIn),
        healthScore: Math.round(40 + ((amount / 1000) % 55)),
        createdAt: day(-60 + closeIn),
      })),
      {
        id: "demo-dl-serena-inverno",
        name: "Potature invernali Villa Serena",
        amount: money(4200),
        currency: "EUR",
        stageId: wonStage.id,
        companyId: "demo-co-serena",
        contactId: "demo-ct-gatti",
        ownerId: owner,
        probability: 100,
        status: "won",
        expectedCloseDate: day(-20),
        closedAt: day(-18),
        createdAt: day(-75),
      },
      {
        id: "demo-dl-curno-scuole",
        name: "Verde scuole Curno",
        amount: money(15800),
        currency: "EUR",
        stageId: lostStage.id,
        companyId: "demo-co-treviolo",
        contactId: "demo-ct-ferrari",
        ownerId: owner,
        probability: 0,
        status: "lost",
        lostCompetitor: "Cooperativa Il Cedro",
        lostReason: "Offerta più bassa dell'8% sul canone annuo",
        expectedCloseDate: day(-30),
        closedAt: day(-26),
        createdAt: day(-90),
      },
    ])
    .onConflictDoNothing();

  // ── Quotes, and the lines they are made of ─────────────────────────────────
  //
  // Figures are written out rather than computed, so what the screen adds up is
  // checked against something: `document-totals.ts` owns the arithmetic, and a seed
  // that used it would agree with itself whatever it did.
  const quoteRows = [
    {
      id: "demo-qt-terrazze",
      number: "PR-2026-014",
      deal: "demo-dl-terrazze-irr",
      company: "demo-co-terrazze",
      contact: "demo-ct-rossi",
      status: "sent",
      issued: -12,
      valid: 18,
      lines: [
        ["irrigazione-mq", "Impianto di irrigazione a goccia, area verde interna", 520, 12.5],
        ["centralina", "Centralina 6 zone con sensore pioggia", 2, 210],
        ["smaltimento", "Smaltimento materiale di risulta", 4, 35],
      ],
    },
    {
      id: "demo-qt-serena",
      number: "PR-2026-015",
      deal: "demo-dl-serena-parco",
      company: "demo-co-serena",
      contact: "demo-ct-conti",
      status: "viewed",
      issued: -8,
      valid: 22,
      lines: [
        ["progetto", "Progettazione del parco e computo metrico", 1, 350],
        ["rotoli-mq", "Prato a rotoli, zona piscina", 900, 9.9],
        ["acero", "Aceri rossi a bordo vialetto", 8, 65],
        ["irrigazione-mq", "Estensione impianto irrigazione", 620, 12.5],
      ],
    },
    {
      id: "demo-qt-glicine",
      number: "PR-2026-016",
      deal: "demo-dl-glicine-dehors",
      company: "demo-co-glicine",
      contact: "demo-ct-greco",
      status: "accepted",
      issued: -20,
      valid: 10,
      lines: [
        ["lauro", "Lauroceraso per schermatura del dehors", 24, 18],
        ["terriccio", "Terriccio per messa a dimora", 30, 8.5],
        ["taglio-ora", "Posa e sistemazione", 16, 28],
      ],
    },
    {
      id: "demo-qt-tigli",
      number: "PR-2026-017",
      deal: "demo-dl-tigli-manut",
      company: "demo-co-tigli",
      contact: "demo-ct-moretti",
      status: "draft",
      issued: -2,
      valid: 28,
      lines: [
        ["prato-mq", "Manutenzione prato aree comuni, canone annuo", 3200, 1.8],
        ["siepe-ml", "Potatura siepe perimetrale, due passaggi", 240, 6.5],
        ["antiparassitario", "Trattamenti sui tigli", 6, 90],
      ],
    },
    {
      id: "demo-qt-golf",
      number: "PR-2026-018",
      deal: "demo-dl-golf-stagione",
      company: "demo-co-golf",
      contact: "demo-ct-barbieri",
      status: "sent",
      issued: -5,
      valid: 25,
      lines: [
        ["prato-mq", "Manutenzione fairway e green, stagione", 14000, 1.8],
        ["alberi-ora", "Potature di rimonda sulle alberature", 60, 45],
        ["smaltimento", "Smaltimento verde stagionale", 40, 35],
      ],
    },
  ] as const;

  const lineFigures = (lines: readonly (readonly [string, string, number, number])[]) =>
    lines.map(([product, description, quantity, unitPrice], index) => {
      const net = Math.round(quantity * unitPrice * 100) / 100;
      const tax = Math.round(net * 0.22 * 100) / 100;
      return { product, description, quantity, unitPrice, net, tax, index };
    });

  for (const quote of quoteRows) {
    const figures = lineFigures(quote.lines);
    const subtotal = Math.round(figures.reduce((sum, l) => sum + l.net, 0) * 100) / 100;
    const taxAmount = Math.round(figures.reduce((sum, l) => sum + l.tax, 0) * 100) / 100;

    await db
      .insert(quotes)
      .values({
        id: quote.id,
        quoteNumber: quote.number,
        dealId: quote.deal,
        companyId: quote.company,
        contactId: quote.contact,
        ownerId: owner,
        status: quote.status,
        issuedAt: day(quote.issued),
        expiresAt: day(quote.valid),
        subtotal: money(subtotal),
        taxAmount: money(taxAmount),
        totalAmount: money(subtotal + taxAmount),
        currency: "EUR",
        notes: "Prezzi IVA esclusa. Intervento subordinato alle condizioni meteo.",
        createdAt: day(quote.issued),
      })
      .onConflictDoNothing();

    await db
      .insert(quoteItems)
      .values(
        figures.map((line) => ({
          id: `${quote.id}-li-${line.index}`,
          quoteId: quote.id,
          productId: `demo-prod-${line.product}`,
          description: line.description,
          quantity: line.quantity,
          unitPrice: money(line.unitPrice),
          taxPercent: "22",
          taxAmount: money(line.tax),
          totalPrice: money(line.net),
          order: line.index,
        })),
      )
      .onConflictDoNothing();
  }

  // ── Orders: the quotes that were accepted ──────────────────────────────────
  const acceptedFigures = lineFigures(quoteRows[2].lines);
  const acceptedNet = Math.round(acceptedFigures.reduce((sum, l) => sum + l.net, 0) * 100) / 100;
  const acceptedTax = Math.round(acceptedFigures.reduce((sum, l) => sum + l.tax, 0) * 100) / 100;

  await db
    .insert(orders)
    .values([
      {
        id: "demo-or-glicine",
        orderNumber: "ORD-2026-008",
        quoteId: "demo-qt-glicine",
        dealId: "demo-dl-glicine-dehors",
        companyId: "demo-co-glicine",
        contactId: "demo-ct-greco",
        ownerId: owner,
        status: "processing",
        orderDate: day(-16),
        subtotal: money(acceptedNet),
        taxAmount: money(acceptedTax),
        totalAmount: money(acceptedNet + acceptedTax),
        currency: "EUR",
        notes: "Consegna piante prevista per la settimana prossima.",
        createdAt: day(-16),
      },
      {
        id: "demo-or-serena-inverno",
        orderNumber: "ORD-2026-009",
        dealId: "demo-dl-serena-inverno",
        companyId: "demo-co-serena",
        contactId: "demo-ct-gatti",
        ownerId: owner,
        status: "completed",
        orderDate: day(-18),
        subtotal: money(4200),
        taxAmount: money(924),
        totalAmount: money(5124),
        currency: "EUR",
        createdAt: day(-18),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(orderItems)
    .values([
      ...acceptedFigures.map((line) => ({
        id: `demo-or-glicine-li-${line.index}`,
        orderId: "demo-or-glicine",
        productId: `demo-prod-${line.product}`,
        description: line.description,
        quantity: line.quantity,
        unitPrice: money(line.unitPrice),
        taxPercent: "22",
        taxAmount: money(line.tax),
        totalPrice: money(line.net),
        order: line.index,
      })),
      {
        id: "demo-or-serena-inverno-li-0",
        orderId: "demo-or-serena-inverno",
        productId: "demo-prod-alberi-ora",
        description: "Potature invernali sulle alberature del parco",
        quantity: 80,
        unitPrice: money(45),
        taxPercent: "22",
        taxAmount: money(792),
        totalPrice: money(3600),
        order: 0,
      },
      {
        id: "demo-or-serena-inverno-li-1",
        orderId: "demo-or-serena-inverno",
        productId: "demo-prod-smaltimento",
        description: "Smaltimento del materiale di risulta",
        quantity: 17,
        unitPrice: money(35),
        taxPercent: "22",
        taxAmount: money(130.9),
        totalPrice: money(595),
        order: 1,
      },
    ])
    .onConflictDoNothing();

  // ── Contracts: the work that comes back every year ─────────────────────────
  await db
    .insert(contracts)
    .values([
      {
        id: "demo-cn-terrazze",
        title: "Manutenzione aree verdi Le Terrazze",
        companyId: "demo-co-terrazze",
        contactId: "demo-ct-rossi",
        ownerId: owner,
        status: "active",
        amount: money(4800),
        currency: "EUR",
        billingPeriod: "quarterly",
        startDate: iso(-300),
        endDate: iso(65),
        autoRenew: true,
        renewalTermMonths: 12,
        noticeDays: 60,
        notes: "Dieci passaggi da marzo a ottobre, sfalcio e siepi.",
      },
      {
        id: "demo-cn-tigli",
        title: "Manutenzione Residence I Tigli",
        companyId: "demo-co-tigli",
        contactId: "demo-ct-moretti",
        ownerId: owner,
        status: "active",
        amount: money(12600),
        currency: "EUR",
        billingPeriod: "monthly",
        startDate: iso(-120),
        endDate: iso(245),
        autoRenew: true,
        renewalTermMonths: 12,
        noticeDays: 90,
        notes: "Comprende la piscina e l'irrigazione automatica.",
      },
      {
        id: "demo-cn-golf",
        title: "Stagione sportiva Golf Club La Rotonda",
        companyId: "demo-co-golf",
        contactId: "demo-ct-barbieri",
        ownerId: owner,
        status: "draft",
        amount: money(33000),
        currency: "EUR",
        billingPeriod: "monthly",
        startDate: iso(30),
        autoRenew: false,
        noticeDays: 30,
        notes: "In attesa della delibera del consiglio direttivo.",
      },
    ])
    .onConflictDoNothing();

  // ── The week's work ────────────────────────────────────────────────────────
  await db
    .insert(tasks)
    .values(
      [
        ["sopralluogo", "Sopralluogo a Villa Serena", "in_progress", "high", 1, "demo-co-serena"],
        ["preventivo-golf", "Rivedere il preventivo del Golf Club", "todo", "high", 2, "demo-co-golf"],
        ["ordinare-piante", "Ordinare i lauri per Il Glicine", "todo", "normal", 3, "demo-co-glicine"],
        [
          "fattura-terrazze",
          "Emettere la fattura del trimestre a Le Terrazze",
          "todo",
          "normal",
          5,
          "demo-co-terrazze",
        ],
        ["manutenzione-mezzi", "Tagliando del trattorino e affilatura lame", "todo", "low", 9, null],
        ["richiamare-carminati", "Richiamare l'amministratore Carminati", "todo", "high", 0, null],
        ["consuntivo", "Consuntivo delle potature invernali", "done", "normal", -6, "demo-co-serena"],
        [
          "gara-treviolo",
          "Preparare i documenti per la gara di Treviolo",
          "in_progress",
          "critical",
          7,
          "demo-co-treviolo",
        ],
      ].map(([id, title, status, priority, due, companyId]) => ({
        id: `demo-tk-${id}`,
        title: title as string,
        status: status as string,
        priority: priority as string,
        dueDate: day(due as number),
        companyId: companyId as string | null,
        ownerId: owner,
        createdAt: day((due as number) - 10),
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(appointments)
    .values(
      [
        ["serena", "Sopralluogo parco Villa Serena", "demo-co-serena", "demo-ct-conti", 1, 9, 11],
        ["terrazze", "Assemblea condominiale Le Terrazze", "demo-co-terrazze", "demo-ct-rossi", 3, 18, 20],
        ["golf", "Presentazione offerta al direttivo", "demo-co-golf", "demo-ct-barbieri", 6, 15, 16],
        ["treviolo", "Apertura buste gara verde pubblico", "demo-co-treviolo", "demo-ct-ferrari", 9, 10, 12],
        ["glicine", "Consegna e posa piante Il Glicine", "demo-co-glicine", "demo-ct-greco", 2, 8, 13],
        ["vivaio", "Visita al vivaio Verdi per la selezione", "demo-co-verdi", "demo-ct-verdi", -3, 14, 16],
      ].map(([id, title, companyId, contactId, offset, from, to]) => {
        const startAt = day(offset as number);
        startAt.setHours(from as number, 0, 0, 0);
        const endAt = day(offset as number);
        endAt.setHours(to as number, 0, 0, 0);
        return {
          id: `demo-ap-${id}`,
          title: title as string,
          companyId: companyId as string,
          contactId: contactId as string,
          ownerId: owner,
          startAt,
          endAt,
          timezone: "Europe/Rome",
          location: "Presso il cliente",
          status: (offset as number) < 0 ? "completed" : "scheduled",
          icalUid: `demo-ap-${id}@flux.local`,
        };
      }),
    )
    .onConflictDoNothing();

  await db
    .insert(activities)
    .values(
      [
        [
          "call-rossi",
          "call",
          "Chiamata con l'amministratore",
          "Chiede di anticipare il primo sfalcio a marzo.",
          "demo-co-terrazze",
          "demo-ct-rossi",
          "demo-dl-terrazze-irr",
          -6,
        ],
        [
          "mail-conti",
          "email",
          "Inviato il preventivo del parco",
          "Preventivo PR-2026-015 inviato con le tavole di progetto.",
          "demo-co-serena",
          "demo-ct-conti",
          "demo-dl-serena-parco",
          -8,
        ],
        [
          "meet-barbieri",
          "meeting",
          "Incontro al circolo",
          "Vogliono i green tagliati tre volte a settimana in estate.",
          "demo-co-golf",
          "demo-ct-barbieri",
          "demo-dl-golf-stagione",
          -4,
        ],
        [
          "note-ferrari",
          "note",
          "Capitolato della gara",
          "Richiesta certificazione per il verde pubblico e mezzi elettrici.",
          "demo-co-treviolo",
          "demo-ct-ferrari",
          "demo-dl-treviolo-verde",
          -10,
        ],
        [
          "call-moretti",
          "call",
          "Rinnovo del contratto",
          "Disponibile a firmare per due anni con prezzo bloccato.",
          "demo-co-tigli",
          "demo-ct-moretti",
          "demo-dl-tigli-manut",
          -2,
        ],
        [
          "note-greco",
          "note",
          "Ordine confermato",
          "Confermata la posa dei lauri, consegna la prossima settimana.",
          "demo-co-glicine",
          "demo-ct-greco",
          "demo-dl-glicine-dehors",
          -16,
        ],
      ].map(([id, type, subject, description, companyId, contactId, dealId, offset]) => ({
        id: `demo-ac-${id}`,
        type: type as string,
        subject: subject as string,
        description: description as string,
        companyId: companyId as string,
        contactId: contactId as string,
        dealId: dealId as string,
        ownerId: owner,
        createdAt: day(offset as number),
      })),
    )
    .onConflictDoNothing();

  // ── Support ────────────────────────────────────────────────────────────────
  await db
    .insert(tickets)
    .values([
      {
        id: "demo-ti-irrigazione",
        ticketNumber: "TK-2026-031",
        subject: "Irrigazione ferma nel settore piscina",
        description: "Da lunedì il settore 4 non parte. La centralina non segnala errori.",
        channel: "phone",
        priority: "high",
        severity: "high",
        status: "in_progress",
        companyId: "demo-co-tigli",
        contactId: "demo-ct-moretti",
        ownerId: owner,
        createdAt: day(-2),
      },
      {
        id: "demo-ti-siepe",
        ticketNumber: "TK-2026-032",
        subject: "Siepe non potata sul lato nord",
        description: "L'ultimo passaggio ha saltato il tratto dietro i box.",
        channel: "email",
        priority: "normal",
        severity: "normal",
        status: "open",
        companyId: "demo-co-terrazze",
        contactId: "demo-ct-rinaldi",
        ownerId: owner,
        createdAt: day(-5),
      },
      {
        id: "demo-ti-fattura",
        ticketNumber: "TK-2026-033",
        subject: "Richiesta copia della fattura del trimestre",
        description: "Serve per la rendicontazione dell'assemblea.",
        channel: "email",
        priority: "low",
        severity: "low",
        status: "resolved",
        companyId: "demo-co-bianchi",
        contactId: "demo-ct-bianchi",
        ownerId: owner,
        createdAt: day(-9),
        resolvedAt: day(-8),
      },
      {
        id: "demo-ti-prato",
        ticketNumber: "TK-2026-034",
        subject: "Chiazze gialle sul prato nuovo",
        description: "Comparse dopo il caldo della scorsa settimana, area sud.",
        channel: "chat",
        priority: "normal",
        severity: "normal",
        status: "new",
        companyId: "demo-co-serena",
        contactId: "demo-ct-gatti",
        ownerId: owner,
        createdAt: day(-1),
      },
    ])
    .onConflictDoNothing();

  console.log(
    "demo data written: catalogue, price lists, customers, leads, pipeline, quotes, orders, contracts, work and tickets",
  );
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Seed failed:", e?.message ?? e);
    process.exit(1);
  });
