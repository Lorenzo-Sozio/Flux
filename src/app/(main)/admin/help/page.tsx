"use client";

import { useRef, useState } from "react";

import Link from "next/link";

import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  ChevronRight,
  CreditCard,
  HelpCircle,
  Info,
  Layers,
  Search,
  Settings2,
  Shield,
  Users,
  Zap,
} from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Data ─────────────────────────────────────────────────────────────────────

const sections = [
  {
    id: "panoramica",
    icon: BookOpen,
    color: "text-slate-600",
    bg: "bg-slate-50 dark:bg-slate-950/30",
    border: "border-slate-200 dark:border-slate-800",
    title: "Panoramica",
    subtitle: "Il pannello di amministrazione",
    href: null,
    description:
      "Il pannello admin è l'area riservata agli utenti con ruolo Admin o Owner. Da qui puoi gestire tutti i tenant della piattaforma, configurare i piani di abbonamento, monitorare le metriche di fatturazione e intervenire manualmente sulle sottoscrizioni.",
    topics: [
      {
        q: "Chi può accedere al pannello admin?",
        a: "Solo gli utenti con ruolo Admin o Owner possono accedere alle pagine sotto /admin. Il ruolo Owner ha tutti i permessi; il ruolo Admin può gestire tenant, billing e piani ma non può modificare il proprio ruolo o quello degli altri owner. Gli utenti con ruolo Editor o Viewer non vedranno nemmeno il link al pannello admin.",
      },
      {
        q: "Qual è la differenza tra Admin e Owner?",
        a: "L'Owner è il primo utente creato sulla piattaforma e ha controllo totale, inclusa la possibilità di gestire altri admin. L'Admin può fare tutto quello che fa l'Owner nel pannello di amministrazione, ma non può promuovere altri utenti al ruolo Owner né rimuovere un Owner esistente.",
      },
      {
        q: "Come navigo tra le sezioni admin?",
        a: "In cima a ogni pagina admin trovi la barra di navigazione con tre voci: Tenants (gestione organizzazioni), Billing (metriche e sottoscrizioni), Plans (configurazione piani). La voce attiva è evidenziata in nero. Clicca su Help in qualsiasi momento per tornare a questa documentazione.",
      },
      {
        q: "Qual è il flusso di configurazione consigliato per un nuovo ambiente?",
        a: "1. Configura i piani di abbonamento (sezione Plans). 2. Collega i piani a Stripe inserendo i Product ID e Price ID. 3. Crea i tenant manualmente oppure attendi che si registrino autonomamente. 4. Monitora le sottoscrizioni e le metriche dalla sezione Billing. In sviluppo e staging puoi usare il pulsante 'Seed Default Plans' per popolare automaticamente i piani base.",
      },
    ],
  },
  {
    id: "tenant",
    icon: Building2,
    color: "text-indigo-500",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    border: "border-indigo-200 dark:border-indigo-800",
    title: "Tenant",
    subtitle: "Gestione organizzazioni multi-tenant",
    href: "/admin/tenants",
    description:
      "Un tenant è un'organizzazione indipendente ospitata sulla piattaforma. Ogni tenant ha il proprio sottodominio, database isolato, utenti e configurazioni. Come admin della piattaforma puoi creare nuovi tenant, vederne i dettagli e gestire i loro membri.",
    topics: [
      {
        q: "Cos'è un tenant e come funziona l'isolamento?",
        a: "Ogni tenant è un'istanza completamente separata del CRM: dati isolati nel proprio database (nessuna contaminazione tra clienti), sottodominio dedicato (es. acme.tuo-dominio.com), utenti e configurazioni indipendenti. Il database della piattaforma (platform DB) contiene solo dati di billing e metadati tenant; i dati CRM reali stanno nel DB del singolo tenant.",
      },
      {
        q: "Come creo un nuovo tenant?",
        a: "Vai su Admin → Tenants → compila il form 'Crea Nuovo Tenant'. Inserisci il nome dell'organizzazione (es. 'Acme Corp') e il sottodominio desiderato (es. 'acme' → accedibile su acme.tuo-dominio.com). Il sistema crea automaticamente: il record tenant nel DB di piattaforma, un database isolato per il tenant, la sottoscrizione al piano Free, e un URL di accesso dedicato.",
      },
      {
        q: "Cosa vedo nel dettaglio di un tenant?",
        a: "La pagina /admin/tenants/[subdomain] mostra: informazioni generali (nome, sottodominio, data creazione), il pannello Membri con la lista degli utenti del tenant e i loro ruoli, e la sottoscrizione billing attuale. Da qui puoi gestire i membri direttamente.",
      },
      {
        q: "Come gestisco i membri di un tenant?",
        a: "Nel pannello Membri del dettaglio tenant puoi vedere tutti gli utenti del tenant con il rispettivo ruolo (Owner, Admin, Editor, Viewer). Come admin di piattaforma puoi aggiungere nuovi membri, modificare i ruoli esistenti e rimuovere utenti. Attenzione: non puoi rimuovere il solo Owner di un tenant.",
      },
      {
        q: "Cosa succede quando un tenant viene creato senza password?",
        a: "Il tenant viene creato attivo immediatamente. Se vuoi che il cliente si registri autonomamente, configura il flusso di self-registration sul tuo sottodominio principale. In alternativa, crea il tenant dal pannello admin e poi aggiungi manualmente il primo utente Owner con email e password temporanea.",
      },
      {
        q: "Posso eliminare un tenant?",
        a: "L'eliminazione diretta non è disponibile dal pannello admin per sicurezza (evitare cancellazioni accidentali di dati clienti). Per disattivare un tenant usa invece Billing → Sospendi tenant. La sospensione blocca l'accesso preservando tutti i dati. Per l'eliminazione definitiva è necessario un intervento diretto sul database.",
      },
    ],
  },
  {
    id: "billing-dashboard",
    icon: BarChart3,
    color: "text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200 dark:border-emerald-800",
    title: "Billing Dashboard",
    subtitle: "Metriche, sottoscrizioni e gestione manuale",
    href: "/admin/billing",
    description:
      "La Billing Dashboard è il centro di controllo finanziario della piattaforma. Mostra le metriche aggregate di ricavo (MRR, ARR, ARPU), il tasso di abbandono e la lista completa di tutte le sottoscrizioni attive, con strumenti per interventi manuali.",
    topics: [
      {
        q: "Cosa significa MRR e come viene calcolato?",
        a: "MRR (Monthly Recurring Revenue) è il ricavo mensile ricorrente totale della piattaforma. Viene calcolato sommando per ogni sottoscrizione attiva o past_due: (prezzo per utente) × (numero utenti). Le sottoscrizioni in stato 'trialing', 'suspended' o 'canceled' non contribuiscono al MRR. I prezzi sono in centesimi; la dashboard divide automaticamente per 100 per mostrare il valore in euro.",
      },
      {
        q: "Cosa significa ARR e come si differenzia da MRR?",
        a: "ARR (Annual Recurring Revenue) è semplicemente MRR × 12. Rappresenta il proiezione annuale del ricavo ricorrente attuale, assumendo nessuna variazione. È la metrica preferita per valutare il valore di un SaaS a lungo termine.",
      },
      {
        q: "Cosa significa ARPU?",
        a: "ARPU (Average Revenue Per User / tenant) è il ricavo medio per tenant attivo, calcolato come MRR ÷ numero tenant attivi. Aiuta a capire il valore medio di ogni cliente: un ARPU in crescita indica che i clienti stanno adottando piani più costosi o aggiungendo add-on.",
      },
      {
        q: "Cosa significa Churn Rate?",
        a: "Il Churn Rate è la percentuale di tenant che hanno annullato la sottoscrizione rispetto al totale dei tenant della piattaforma. Calcolato come: (tenant cancellati ÷ totale tenant) × 100. Un churn rate elevato segnala problemi di retention e richiede analisi delle cause.",
      },
      {
        q: "Come cambio il piano di un tenant manualmente?",
        a: "Nella tabella Sottoscrizioni trova il tenant → clicca il menu azioni (⋮) → 'Cambia Piano'. Seleziona il nuovo piano e conferma. Il cambio è immediato: la cache delle entitlement viene invalidata e il tenant avrà accesso alle funzionalità del nuovo piano entro pochi secondi. Nota: il cambio manuale non crea prorations su Stripe; è uno strumento per correzioni e promozioni, non per i rinnovi normali.",
      },
      {
        q: "Come sospendo un tenant?",
        a: "Menu azioni (⋮) → 'Sospendi'. Il tenant viene portato in stato 'suspended': tutti gli utenti vedranno un banner di sospensione e non potranno accedere alle funzionalità del CRM. I dati rimangono intatti. La sospensione è reversibile in qualsiasi momento con l'azione 'Riattiva'.",
      },
      {
        q: "Come riattivo un tenant sospeso?",
        a: "Menu azioni (⋮) → 'Riattiva'. Il sistema verifica prima lo stato della sottoscrizione Stripe: se la subscription Stripe è ancora attiva o in trial, il tenant viene riportato ad 'active'; se la subscription Stripe è stata cancellata nel frattempo, il tenant viene portato a 'free' per evitare di dare accesso a funzionalità non pagate.",
      },
      {
        q: "Come effettuo un downgrade a Free manuale?",
        a: "Menu azioni (⋮) → 'Downgrade a Free'. Questa operazione: cancella la subscription Stripe (se presente), rimuove tutti gli add-on attivi, azzera i riferimenti Stripe e porta il tenant al piano Free. Usa questa azione per casi di morosità prolungata o richiesta esplicita del cliente. L'operazione è irreversibile senza un nuovo checkout.",
      },
      {
        q: "Cosa significa lo stato 'past_due'?",
        a: "Lo stato past_due indica che il pagamento dell'ultimo rinnovo è fallito (es. carta scaduta). Il tenant entra in un periodo di grazia di 7 giorni durante i quali può ancora accedere alla piattaforma. Se il pagamento viene risolto (aggiornando la carta nel portale di fatturazione), il webhook invoice.payment_succeeded riporta automaticamente lo stato ad 'active'. Alla scadenza della grazia, Stripe tenterà ulteriori addebiti e potrà cancellare la subscription.",
      },
      {
        q: "Come filtro le sottoscrizioni per stato?",
        a: "Usa le tre tab nella parte inferiore della dashboard: 'All' mostra tutte le sottoscrizioni, 'Active' filtra solo quelle in stato active o trialing, 'Issues' mostra quelle in stato past_due o suspended. La ricerca nella tabella filtra per nome tenant, sottodominio o piano.",
      },
    ],
  },
  {
    id: "piani",
    icon: Layers,
    color: "text-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950/30",
    border: "border-violet-200 dark:border-violet-800",
    title: "Piani di Abbonamento",
    subtitle: "Creazione e configurazione dei piani",
    href: "/admin/plans",
    description:
      "I piani definiscono cosa può fare un tenant: quali moduli usa, quanti utenti può avere, quali limiti quantitativi si applicano e a quale prezzo. Ogni parametro del form ha un impatto diretto sull'esperienza del cliente e sulle entrate della piattaforma.",
    topics: [
      {
        q: "Cos'è il 'nome interno' (slug) e perché è importante?",
        a: "Lo slug è l'identificatore tecnico del piano (es. 'professional'). Viene usato nella logica di business per riconoscere il piano, nelle regole condizionali (es. 'il piano enterprise non può essere upgradato') e nei log di sistema. Non può essere modificato dopo la creazione. Usa sempre lettere minuscole, numeri e trattini; niente spazi.",
      },
      {
        q: "Cosa significa 'Sort Order'?",
        a: "Il sort order determina l'ordine di visualizzazione dei piani nella pagina pubblica dei prezzi e nelle liste admin. I piani vengono ordinati dal valore più basso al più alto (0 = primo). Convenzionalmente: Free=0, Basic=1, Professional=2, Enterprise=3.",
      },
      {
        q: "Differenza tra 'Active', 'Public' e 'Custom'?",
        a: "'Active' significa che il piano può ricevere nuovi abbonamenti. Disattivarlo nasconde il piano dai nuovi checkout senza toccare le sottoscrizioni esistenti. 'Public' controlla se il piano appare nella pagina pubblica dei prezzi (/pricing). Disattivalo per piani legacy o riservati. 'Custom' indica che il piano è negoziato individualmente con il cliente e non è mostrato pubblicamente; viene assegnato solo dall'admin manualmente.",
      },
      {
        q: "Come funziona il pricing? In che unità sono i prezzi?",
        a: "Nel form i prezzi si inseriscono in euro con decimali (es. 25.00). Internamente vengono convertiti in centesimi (2500) che è l'unità usata da Stripe e nel database. La conversione è automatica: quello che digiti è quello che il cliente paga. Il campo 'Annual price / user / mo' è il prezzo mensile equivalente quando il cliente sceglie il piano annuale (es. €20 al mese fatturati annualmente = €240/anno).",
      },
      {
        q: "Cos'è 'Auto-calc' per il prezzo annuale?",
        a: "Attivando Auto-calc, il prezzo annuale viene ricalcolato automaticamente ogni volta che modifichi il prezzo mensile o la percentuale di sconto. Formula: prezzo_annuale = prezzo_mensile × (1 - sconto/100). Esempio: €25 mensili con 20% di sconto → €20 annuali. Disattiva Auto-calc se vuoi impostare un prezzo annuale indipendente dallo sconto.",
      },
      {
        q: "Cosa sono 'Included Users', 'Min Users' e 'Max Users'?",
        a: "'Included Users' è il numero di utenti incluso nel prezzo base del piano (es. 5 utenti inclusi). 'Min Users' è il minimo acquistabile (es. non puoi comprare meno di 1 sede). 'Max Users' è il limite massimo del piano (attiva 'Unlimited' per i piani enterprise senza tetto). Gli utenti oltre il limite 'Max Users' non possono essere aggiunti al tenant fino a un upgrade o aggiunta di add-on.",
      },
      {
        q: "Cosa sono i 'Extra User pricing'?",
        a: "I prezzi extra utente definiscono quanto costa aggiungere una postazione aggiuntiva oltre gli utenti inclusi nel piano. Ad esempio: piano Professional con 5 utenti inclusi a €25/mese → ogni utente extra costa €20/mese. I prezzi mensile e annuale per gli extra utenti corrispondono ai Price ID Stripe configurati nella tab Stripe.",
      },
      {
        q: "Cosa sono i 'Trial Days'?",
        a: "I Trial Days definiscono il periodo di prova gratuita per i nuovi abbonati a questo piano. Con 14 giorni di trial, il cliente può usare tutte le funzionalità del piano per 14 giorni senza inserire la carta (dipende dalla configurazione Stripe). Impostare 0 = nessun trial. Il trial viene comunicato a Stripe tramite il parametro trial_period_days nel checkout session.",
      },
      {
        q: "Come funzionano i Moduli nella tab Modules?",
        a: "I moduli sono le macro-funzionalità del CRM disponibili per questo piano. Clicca su un modulo per attivarlo o disattivarlo. CRM è il modulo base e dovrebbe essere sempre incluso. Sales aggiunge pipeline e deal, Marketing aggiunge campagne email, Support aggiunge ticket, Automation aggiunge le regole automatiche, Reporting aggiunge analytics avanzati, Helpdesk aggiunge la gestione ticket avanzata. I moduli si mappano direttamente ai controlli di accesso nel CRM.",
      },
      {
        q: "Cosa sono i Limits nella tab Limits e cosa significa 'Unlimited'?",
        a: "I limiti sono soglie quantitative applicate al runtime del CRM. Max Users è il numero massimo di utenti attivi; API Calls è il numero di chiamate API al mese; Storage è lo spazio disco in GB; Automation Runs è il numero di esecuzioni di regole di automazione al mese; Max Records è il numero massimo di record (contatti + aziende + deal + lead combinati); Workspaces e Integrations sono contatori specifici. Attivare 'Unlimited' su un campo imposta il limite a null nel database: la piattaforma non applicherà nessuna restrizione per quella metrica.",
      },
      {
        q: "Cosa sono 'White Label' e 'Sandbox' nella tab Features?",
        a: "'White Label' permette al tenant di configurare un dominio personalizzato e nascondere il branding Flux. 'Sandbox' abilita un ambiente di test isolato che replica la configurazione production del tenant. Entrambe le funzionalità possono anche essere abilitate come add-on singoli (senza upgrade di piano) dalla sezione billing del tenant.",
      },
      {
        q: "Cos'è il 'Support Tier'?",
        a: "Il Support Tier definisce il livello di assistenza incluso nel piano: Community = solo forum e documentazione; Email = supporto via email in orario lavorativo; Priority = SLA garantita con risposta entro 24 ore; Dedicated = account manager dedicato con SLA personalizzata. Questo valore è attualmente informativo: viene mostrato nella pagina abbonamento del tenant ma non controlla accessi automatici.",
      },
      {
        q: "Come uso il pulsante 'Seed Default Plans'?",
        a: "Il seed inserisce i 4 piani predefiniti (Free, Basic, Professional, Enterprise) con tutti i parametri standard già configurati. È un'operazione sicura: non sovrascrive piani esistenti (salta quelli con lo stesso slug). Utile per inizializzare rapidamente un nuovo ambiente. Dopo il seed, aggiungi manualmente i Stripe ID nella tab Stripe di ogni piano.",
      },
    ],
  },
  {
    id: "stripe",
    icon: Zap,
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    title: "Integrazione Stripe",
    subtitle: "Collegamento pagamenti e webhook",
    href: null,
    description:
      "Stripe gestisce tutti i pagamenti ricorrenti della piattaforma. L'integrazione richiede la configurazione di variabili d'ambiente e il collegamento dei Price ID di Stripe a ogni piano. Una volta configurata, l'intero lifecycle di pagamento (checkout, rinnovi, fallimenti, cancellazioni) è completamente automatico.",
    topics: [
      {
        q: "Quali variabili d'ambiente servono per Stripe?",
        a: "Tre variabili nel file .env: STRIPE_SECRET_KEY (la chiave segreta del tuo account Stripe, inizia con sk_live_ o sk_test_), STRIPE_PUBLISHABLE_KEY (la chiave pubblica, inizia con pk_, usata nel frontend), STRIPE_WEBHOOK_SECRET (il secret per verificare le firme dei webhook, inizia con whsec_). Senza STRIPE_SECRET_KEY le funzionalità di billing generano un errore chiaro senza far crashare il resto della piattaforma.",
      },
      {
        q: "Come collego un piano a Stripe?",
        a: "1. Crea un Prodotto in Stripe Dashboard con il nome del piano. 2. Aggiungi due Price per il prodotto: uno mensile ricorrente e uno annuale ricorrente. 3. Se il piano prevede extra utenti, aggiungi altri due Price (extra utente mensile e annuale). 4. Copia i rispettivi ID (prod_… e price_…) nella tab Stripe del form piano. Finché un piano non ha i Price ID configurati, il pulsante di checkout mostrerà un errore al cliente.",
      },
      {
        q: "Cosa sono i webhook e come li configuro?",
        a: "I webhook sono notifiche che Stripe invia alla tua piattaforma quando avvengono eventi (pagamento riuscito, sottoscrizione cancellata, ecc.). In Stripe Dashboard → Webhooks, aggiungi l'endpoint: https://tuo-dominio.com/api/webhooks/stripe. Seleziona gli eventi: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed. Copia il Webhook Secret generato in STRIPE_WEBHOOK_SECRET.",
      },
      {
        q: "Come funziona il flusso di checkout?",
        a: "1. Il tenant clicca 'Upgrade' nella pagina billing e seleziona un piano. 2. Il server crea una Stripe Checkout Session con il Customer ID e il Price ID del piano. 3. Il cliente viene reindirizzato alla pagina di pagamento Stripe. 4. Dopo il pagamento, Stripe invia il webhook checkout.session.completed che aggiorna la sottoscrizione nel DB. 5. Il webhook customer.subscription.created/updated porta il piano finale. La cache entitlement viene invalidata e il tenant ha accesso immediato.",
      },
      {
        q: "Cosa succede se un webhook fallisce o arriva in ritardo?",
        a: "Il sistema usa un meccanismo di idempotenza: ogni evento Stripe viene salvato nella tabella billing_stripe_events con il suo ID univoco. Se lo stesso evento arriva due volte (retry Stripe), viene elaborato una sola volta. Se un webhook causa un errore di elaborazione, il server risponde con 500 e Stripe riproverà automaticamente fino a 7 giorni. Gli errori vengono salvati nel campo 'error' della stessa tabella per debug.",
      },
      {
        q: "Come testo l'integrazione Stripe in sviluppo?",
        a: "Usa le chiavi test (sk_test_…, pk_test_…) nel .env locale. Per i webhook in locale, usa Stripe CLI: installa stripe-cli, poi esegui 'stripe listen --forward-to localhost:3000/api/webhooks/stripe'. Il CLI stamperà il Webhook Secret locale da usare in STRIPE_WEBHOOK_SECRET. Per simulare eventi usa 'stripe trigger checkout.session.completed' o il Dashboard Stripe in modalità test.",
      },
      {
        q: "Come gestisco il portale di fatturazione self-service?",
        a: "Il pulsante 'Gestisci Abbonamento' nella pagina /dashboard/settings/billing del tenant apre il Stripe Billing Portal: un'interfaccia hosted da Stripe dove il cliente può aggiornare la carta, scaricare le fatture e cambiare piano (se configurato). Il Billing Portal deve essere abilitato e configurato nel tuo account Stripe → Settings → Billing → Customer portal.",
      },
    ],
  },
  {
    id: "entitlement",
    icon: Shield,
    color: "text-rose-500",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    border: "border-rose-200 dark:border-rose-800",
    title: "Entitlement & Accessi",
    subtitle: "Come vengono applicati i limiti del piano",
    href: null,
    description:
      "Il sistema di entitlement calcola in tempo reale cosa può fare ogni tenant in base al suo piano e ai suoi add-on. I controlli vengono applicati a ogni operazione sensibile: creazione record, aggiunta utenti, invocazione API. La cache garantisce performance elevate senza query al DB per ogni richiesta.",
    topics: [
      {
        q: "Come vengono applicati i limiti del piano?",
        a: "Prima di ogni operazione soggetta a limiti (es. aggiungere un utente, creare un record), il server richiama getEntitlements(tenantId) che restituisce un oggetto con tutti i diritti del tenant. Se il limite è superato, viene lanciata un'EntitlementError che blocca l'operazione e mostra un messaggio chiaro all'utente con il piano da acquistare per sbloccarsi.",
      },
      {
        q: "Cos'è la cache delle entitlement e quanto dura?",
        a: "Per evitare query al DB a ogni richiesta, le entitlement sono tenute in memoria (Map in-process) con un TTL di 5 minuti. La cache viene invalidata immediatamente su qualsiasi cambio di piano, sospensione, riattivazione o ricezione di un webhook Stripe. Questo significa che dopo un upgrade il tenant vede le nuove funzionalità entro pochi secondi, non dopo 5 minuti.",
      },
      {
        q: "Cosa succede in caso di piano Free o nessuna sottoscrizione?",
        a: "Se un tenant non ha una sottoscrizione o è in stato 'free', il sistema applica i valori del piano Free hardcoded: 1 utente, 1 workspace, modulo CRM base, 500 record massimi e 1 GB storage. Questo garantisce che anche i tenant senza piano abbiano un'esperienza funzionante (limitata) senza errori.",
      },
      {
        q: "Come funzionano gli add-on rispetto al piano base?",
        a: "Gli add-on si sommano al piano base. Esempio: piano Professional con max 50 utenti + add-on 'Extra Users' con quantità 10 → il tenant può avere fino a 60 utenti. Gli add-on modulo (Helpdesk, Advanced Reporting) aggiungono moduli non presenti nel piano base. White Label e Sandbox come add-on replicano i flag del piano. Il calcolo avviene in tempo reale dentro computeEntitlements() che aggrega piano + tutti gli add-on attivi.",
      },
      {
        q: "Come vedo i log di cambio entitlement?",
        a: "Ogni cambio significativo (cambio piano, sospensione, riattivazione, pagamento fallito, aggiunta/rimozione add-on) viene registrato nella tabella billing_audit_log con: tenant ID, tipo evento, valore precedente, valore nuovo, chi ha fatto il cambiamento (stripe_webhook o admin:userId) e timestamp. Attualmente questa tabella è accessibile solo via Drizzle Studio o query diretta al DB.",
      },
    ],
  },
  {
    id: "addon",
    icon: CreditCard,
    color: "text-cyan-500",
    bg: "bg-cyan-50 dark:bg-cyan-950/30",
    border: "border-cyan-200 dark:border-cyan-800",
    title: "Add-on",
    subtitle: "Estensioni acquistabili dai tenant",
    href: null,
    description:
      "Gli add-on sono funzionalità opzionali che un tenant può acquistare separatamente, senza cambiare piano. Vengono aggiunti come line item alla subscription Stripe esistente e attivati immediatamente dopo il pagamento.",
    topics: [
      {
        q: "Quali add-on sono disponibili?",
        a: "La piattaforma supporta 5 tipi di add-on: Extra Users (postazioni utente aggiuntive), Helpdesk Module (gestione ticket avanzata), Advanced Reporting (report builder e export BI), White Label (dominio personalizzato e branding), Sandbox Environment (ambiente di test isolato). Ogni add-on ha un prezzo mensile e annuale configurabile.",
      },
      {
        q: "Come vengono fatturati gli add-on?",
        a: "Ogni add-on viene aggiunto come nuovo subscription item alla subscription Stripe esistente del tenant. Stripe calcola automaticamente il prorata: se il tenant aggiunge un add-on a metà mese, paga solo per la parte rimanente. Il rinnovo successivo includerà il costo completo dell'add-on.",
      },
      {
        q: "Come configuro i prezzi degli add-on?",
        a: "Attualmente i prezzi degli add-on (ADDON_CONFIGS in plans-config.ts) sono definiti nel codice sorgente. Per l'add-on 'extra_users', i Stripe Price ID vengono letti dal piano corrente del tenant (campi stripeExtraUserMonthlyPriceId e stripeExtraUserAnnualPriceId nel form piano). Per gli altri add-on, i Price ID devono essere aggiunti alla configurazione ADDON_CONFIGS o gestiti via Stripe direttamente.",
      },
      {
        q: "Come rimuovo un add-on da un tenant?",
        a: "Il tenant può rimuovere gli add-on dalla propria pagina /dashboard/settings/billing. L'operazione chiama removeAddon() che: elimina il subscription item da Stripe (con proration), aggiorna lo stato dell'add-on a 'canceled' nel DB e invalida la cache entitlement. La rimozione è immediata.",
      },
    ],
  },
  {
    id: "configurazione-iniziale",
    icon: Settings2,
    color: "text-gray-500",
    bg: "bg-gray-50 dark:bg-gray-950/30",
    border: "border-gray-200 dark:border-gray-700",
    title: "Configurazione iniziale",
    subtitle: "Checklist per mettere in produzione",
    href: null,
    description:
      "Guida passo-passo per configurare correttamente la piattaforma prima del go-live con i primi clienti. Segui questa checklist nell'ordine indicato per evitare problemi di configurazione.",
    topics: [
      {
        q: "1. Variabili d'ambiente obbligatorie",
        a: "Configura nel .env (o nelle variabili Vercel): DATABASE_URL (Neon Postgres), AUTH_SECRET (stringa casuale lunga), AUTH_GOOGLE_ID e AUTH_GOOGLE_SECRET (OAuth Google, opzionale), RESEND_API_KEY (per email transazionali), STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_APP_URL (URL pubblico dell'app, es. https://app.tuodominio.com).",
      },
      {
        q: "2. Inizializzazione del database",
        a: "Esegui 'npx drizzle-kit push' per creare tutte le tabelle nel database. Verifica che non ci siano errori di migrazione. Se aggiorni una versione esistente, usa 'npx drizzle-kit generate' per generare le migrazioni incrementali e poi applicale con 'npx drizzle-kit migrate'.",
      },
      {
        q: "3. Creazione dei piani",
        a: "Vai su Admin → Plans → 'Seed Default Plans' per creare i 4 piani base (Free, Basic, Professional, Enterprise). In alternativa, crea piani personalizzati manualmente. I piani senza Stripe Price ID funzionano ma non possono ricevere pagamenti: i clienti vedranno un errore al checkout.",
      },
      {
        q: "4. Configurazione Stripe",
        a: "In Stripe Dashboard: crea un Prodotto per ogni piano a pagamento, aggiungi i Price ricorrenti mensili e annuali, configura il Webhook endpoint puntando a /api/webhooks/stripe. Copia tutti i Price ID nella tab Stripe di ogni piano nel pannello admin.",
      },
      {
        q: "5. Creazione del primo tenant",
        a: "Vai su Admin → Tenants → crea il primo tenant (es. il tuo tenant demo o il primo cliente). Dopo la creazione, accedi al sottodominio del tenant, registra il primo utente (diventerà automaticamente Owner) e verifica che il CRM sia accessibile e funzionante.",
      },
      {
        q: "6. Test del flusso di pagamento",
        a: "Con le chiavi Stripe test: accedi al tenant di test → Impostazioni → Billing → seleziona un piano a pagamento → completa il checkout con la carta test 4242 4242 4242 4242. Verifica che: il webhook venga ricevuto (controlla i log Stripe), la sottoscrizione nel pannello admin si aggiorni, il tenant abbia accesso ai moduli del piano acquistato.",
      },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminHelpPage() {
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const filtered = sections.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.subtitle.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.topics.some((t) => t.q.toLowerCase().includes(q) || t.a.toLowerCase().includes(q))
    );
  });

  function scrollTo(id: string) {
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  }

  return (
    <div className="flex min-h-full gap-6">
      {/* ── TOC Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="hidden w-56 shrink-0 xl:block">
        <div className="sticky top-4 space-y-3">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cerca…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
          <nav className="space-y-0.5">
            {sections.map((s) => {
              const Icon = s.icon;
              const isVisible = filtered.some((f) => f.id === s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => scrollTo(s.id)}
                  disabled={!isVisible}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    activeId === s.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    !isVisible && "pointer-events-none opacity-30",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", s.color)} />
                  {s.title}
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-6 pb-16">
        {/* Header */}
        <div className="flex items-start gap-4 rounded-xl border bg-gradient-to-br from-primary/5 to-primary/0 p-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <HelpCircle className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Documentazione Amministratore</h1>
            <p className="mt-1 text-muted-foreground">
              Guida completa alla configurazione e gestione della piattaforma: tenant, fatturazione, piani e
              integrazione Stripe.
            </p>
          </div>
        </div>

        {/* Mobile search */}
        <div className="relative xl:hidden">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cerca nella documentazione…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Quick links */}
        {!search && (
          <div>
            <p className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Sezioni principali</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {sections.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => scrollTo(s.id)}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all hover:shadow-sm",
                      s.bg,
                      s.border,
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", s.color)} />
                    <span className="truncate text-sm font-medium">{s.title}</span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sections */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Search className="mb-4 h-10 w-10 text-muted-foreground/30" />
            <p className="font-medium text-muted-foreground">Nessun risultato per &ldquo;{search}&rdquo;</p>
            <p className="mt-1 text-sm text-muted-foreground">Prova con un termine diverso.</p>
          </div>
        ) : (
          filtered.map((section) => {
            const Icon = section.icon;
            return (
              <section
                key={section.id}
                id={section.id}
                ref={(el) => {
                  sectionRefs.current[section.id] = el;
                }}
                className="scroll-mt-6"
              >
                <Card className={cn("overflow-hidden border", section.border)}>
                  <CardHeader className={cn("flex flex-row items-center gap-4 border-b pb-4", section.bg)}>
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                        section.bg,
                        section.border,
                      )}
                    >
                      <Icon className={cn("h-5 w-5", section.color)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-lg">{section.title}</CardTitle>
                        <Badge variant="secondary" className="text-xs font-normal">
                          {section.subtitle}
                        </Badge>
                      </div>
                    </div>
                    {section.href && (
                      <Link
                        href={section.href}
                        className={cn(
                          "flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-background/60",
                          section.border,
                          section.color,
                        )}
                      >
                        Vai alla sezione
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </CardHeader>

                  <CardContent className="p-0">
                    <div className="flex items-start gap-3 border-b bg-muted/20 px-6 py-4">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="text-sm leading-relaxed text-muted-foreground">{section.description}</p>
                    </div>

                    <Accordion type="multiple" className="divide-y">
                      {section.topics.map((topic, i) => (
                        <AccordionItem key={i} value={`${section.id}-${i}`} className="border-0 px-6">
                          <AccordionTrigger className="py-4 text-left text-sm font-medium hover:no-underline">
                            {topic.q}
                          </AccordionTrigger>
                          <AccordionContent className="pb-4 text-sm leading-relaxed text-muted-foreground">
                            {topic.a}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              </section>
            );
          })
        )}

        {/* Footer */}
        <div className="rounded-xl border bg-muted/30 p-6 text-center">
          <p className="text-sm font-medium">Hai bisogno di assistenza tecnica?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Controlla i log applicativi, la console Drizzle Studio e il dashboard Stripe per diagnosticare i problemi
            più comuni.
          </p>
        </div>
      </div>
    </div>
  );
}
