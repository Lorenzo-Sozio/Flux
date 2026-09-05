"use client";

import { useRef, useState } from "react";

import Link from "next/link";

import {
  ArrowRight,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  CheckSquare,
  ChevronRight,
  Clock,
  Contact,
  FileText,
  GanttChartSquare,
  GitMerge,
  HelpCircle,
  Info,
  Kanban,
  Mail,
  MessageCircle,
  MessageSquare,
  Package,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  Star,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  Webhook,
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
    id: "primi-passi",
    icon: Star,
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    title: "Primi passi",
    subtitle: "Benvenuto in Flux CRM",
    href: null,
    description:
      "Flux CRM è la tua piattaforma centralizzata per gestire l'intero ciclo commerciale: dai primi contatti con i potenziali clienti, fino alla chiusura delle vendite e all'assistenza post-vendita.",
    topics: [
      {
        q: "Come iniziare dopo il primo accesso?",
        a: "Dopo il login arrivi alla Dashboard CRM, la tua schermata principale. Qui trovi un riepilogo in tempo reale di lead attivi, deal aperte, task in scadenza e ticket assegnati. Ti consigliamo di iniziare creando i tuoi primi Lead, poi costruire la Pipeline con le opportunità commerciali.",
      },
      {
        q: "Qual è il flusso commerciale tipico?",
        a: "Il percorso standard è: Lead → Contatto + Azienda → Deal (Pipeline) → Preventivo → Ordine. Un lead che mostra interesse viene convertito in un contatto qualificato, si apre una deal nella pipeline, si invia un preventivo e una volta accettato si genera l'ordine.",
      },
      {
        q: "Come funziona la navigazione?",
        a: "La barra laterale raggruppa tutto in sette sezioni: Lavoro (dashboard, calendario, task, chat), Clienti (contatti, aziende, lead), Vendite (pipeline con obiettivi, funnel, win/loss, previsioni e report, poi preventivi, ordini, prodotti e finance), Assistenza (panoramica, ticket, SLA, macro), Marketing e automazioni, Analisi, e Amministrazione (utenti, ruoli, impostazioni). Alcune voci compaiono solo se il piano include il modulo corrispondente. Su telefono la barra lascia il posto a una barra di schede in basso con le sezioni più usate.",
      },
      {
        q: "Posso installare Flux sul telefono?",
        a: "Sì. Aprendo Flux dal browser del telefono puoi aggiungerlo alla schermata iniziale: da lì si apre a schermo intero, con la sua icona e senza la barra del browser. Su Android il browser propone da solo 'Installa'; su iPhone si usa Condividi → Aggiungi a Home. Senza rete compare una schermata che lo dice, invece di una pagina di errore del browser.",
      },
      {
        q: "Posso personalizzare la vista?",
        a: "Sì. Dall'header in alto a destra puoi cambiare il tema (chiaro/scuro), la lingua (italiano/inglese) e la valuta di visualizzazione. Puoi anche modificare il layout della sidebar e abilitare la navbar fissa tramite i controlli di layout.",
      },
    ],
  },
  {
    id: "leads",
    icon: Users,
    color: "text-green-500",
    bg: "bg-green-50 dark:bg-green-950/30",
    border: "border-green-200 dark:border-green-800",
    title: "Lead",
    subtitle: "Gestione potenziali clienti",
    href: "/dashboard/leads",
    description:
      "I Lead sono i potenziali clienti che hanno mostrato interesse ma non sono ancora stati qualificati. Ogni lead ha un punteggio automatico (Lead Score) e può essere convertito in contatto, azienda e opportunità di vendita.",
    topics: [
      {
        q: "Come creo un nuovo lead?",
        a: "Vai su Lead → clicca il pulsante 'Nuovo Lead' in alto a destra. Compila nome, cognome, email, azienda di provenienza e fonte di acquisizione (referral, organic, evento…). I campi aggiuntivi personalizzati (se configurati dall'admin) appaiono nella stessa form.",
      },
      {
        q: "Cosa significa il badge Cold / Warm / Hot / Very Hot?",
        a: "È il Lead Score calcolato automaticamente dal sistema in base a completezza del profilo, stato di avanzamento, interazioni registrate e dati demografici. Cold (0-25) = interesse basso; Warm (26-50) = da coltivare; Hot (51-75) = priorità alta; Very Hot (76-100) = da contattare immediatamente.",
      },
      {
        q: "Come converto un lead in contatto?",
        a: "Apri il profilo del lead → clicca 'Converti Lead'. Il sistema crea automaticamente: un Contatto con tutti i dati del lead, una nuova Azienda (se non esiste già), e una Deal nella pipeline. Il lead originale viene marcato come convertito e mantiene i riferimenti agli oggetti creati.",
      },
      {
        q: "Posso importare lead da un file Excel o CSV?",
        a: "Sì. Nella lista Lead trovi il pulsante 'Importa CSV'. Prepara il file con le colonne richieste (nome, cognome, email, ecc.), caricalo e il sistema importerà i record saltando automaticamente i duplicati (stessa email = aggiornamento del record esistente).",
      },
      {
        q: "Come uso i filtri e i filtri salvati?",
        a: "In cima alla lista Lead trovi il pannello filtri: puoi filtrare per stato, fonte, punteggio, responsabile, tag e data creazione. Una volta impostati, clicca 'Salva filtro' per riutilizzarlo in futuro. I filtri possono essere privati o condivisi con il team. Quelli 'pinnati' appaiono sempre in cima alla lista.",
      },
      {
        q: "Cos'è la Bulk Action?",
        a: "Seleziona più lead con le checkbox a sinistra, poi usa la barra delle azioni collettive che appare in basso: puoi eliminare in massa, cambiare stato a tutti i selezionati, o riassegnare il responsabile con un'unica operazione.",
      },
    ],
  },
  {
    id: "contatti",
    icon: Contact,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    title: "Contatti",
    subtitle: "Persone fisiche qualificate",
    href: "/dashboard/contacts",
    description:
      "I Contatti sono persone con cui hai già stabilito o stai stabilendo una relazione commerciale. A differenza dei lead, sono entità qualificate, spesso collegate a un'azienda e a deal attive.",
    topics: [
      {
        q: "Cosa posso registrare nel profilo di un contatto?",
        a: "Anagrafica completa (nome, cognome, ruolo, dipartimento), tutti i recapiti (email, telefono, mobile, LinkedIn), indirizzo con selezione geografica strutturata, note libere e tag personalizzati. Puoi anche indicare il consenso marketing (GDPR) con la relativa data.",
      },
      {
        q: "Come collego un contatto a un'azienda?",
        a: "Nel form del contatto, usa il campo 'Azienda': cerca tra le aziende esistenti o creane una nuova al volo. Una volta collegato, il contatto appare anche nel profilo dell'azienda, nella sezione 'Contatti associati'.",
      },
      {
        q: "Cosa trovo nella pagina di dettaglio di un contatto?",
        a: "Il profilo completo del contatto, le deal attive collegate, la timeline delle attività (note, chiamate, meeting, email registrate), i task associati e i campi personalizzati. Puoi aggiungere nuove attività o task direttamente da questa pagina senza uscire dal profilo.",
      },
      {
        q: "Come esporto la lista contatti?",
        a: "Contatti → 'Esporta CSV', in un file che Excel e Google Sheets aprono direttamente. ⚠️ L'esportazione NON tiene conto del filtro a schermo: scarica tutti i contatti che ti è permesso vedere. Con rango di amministratore o proprietario sono tutti quelli del workspace; con gli altri ruoli solo quelli di cui sei titolare.",
      },
      {
        q: "Come unisco due contatti duplicati?",
        a: "Dalla lista, seleziona il duplicato e usa 'Unisci': scegli quale scheda tiene il campo quando i due non concordano, e tutto ciò che era attaccato al doppione — attività, task, trattative, ticket — passa alla scheda che resta, invece di sparire con lui. Vale anche per aziende e lead.",
      },
    ],
  },
  {
    id: "aziende",
    icon: Building2,
    color: "text-indigo-500",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    border: "border-indigo-200 dark:border-indigo-800",
    title: "Aziende",
    subtitle: "Organizzazioni clienti e prospect",
    href: "/dashboard/companies",
    description:
      "Le Aziende rappresentano le organizzazioni con cui lavori. Fungono da nodo aggregatore che collega contatti, deal, attività e ticket dello stesso cliente aziendale.",
    topics: [
      {
        q: "Quali tipologie di azienda esistono?",
        a: "Prospect (potenziale cliente, non ancora attivo), Customer (cliente attivo), Partner (partner commerciale), Vendor (fornitore). La tipologia è visibile come badge nel profilo e nella lista, e ti aiuta a filtrare rapidamente la tua base aziendale.",
      },
      {
        q: "Dove inserisco Partita IVA e Codice SDI?",
        a: "Nel form dell'azienda trovi i campi specifici per i dati fiscali italiani: Partita IVA e Codice SDI (o Codice Destinatario per la fatturazione elettronica). Questi dati sono disponibili anche nella generazione dei preventivi.",
      },
      {
        q: "Cosa vedo nella pagina di dettaglio dell'azienda?",
        a: "Tutti i dati aziendali, i contatti collegati, le deal aperte e chiuse, le attività registrate, i ticket di supporto aperti e le note. Ogni sezione ha un link diretto per aggiungere nuovi elementi senza uscire dalla pagina.",
      },
    ],
  },
  {
    id: "pipeline",
    icon: Kanban,
    color: "text-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950/30",
    border: "border-violet-200 dark:border-violet-800",
    title: "Pipeline Vendite",
    subtitle: "Opportunità commerciali e deal",
    href: "/dashboard/pipeline",
    description:
      "La Pipeline è il cuore del processo commerciale. Visualizza tutte le deal aperte organizzate per fase di avanzamento in una vista kanban. Trascina le card per spostare una deal tra gli stage.",
    topics: [
      {
        q: "Come creo una nuova deal?",
        a: "Dalla Pipeline Board clicca '+ Nuova Deal' (in cima a qualsiasi colonna) oppure dal menu laterale. Inserisci nome, importo, probabilità di chiusura, data prevista, azienda e contatto di riferimento. La deal parte automaticamente nel primo stage configurato.",
      },
      {
        q: "Come sposto una deal tra gli stage?",
        a: "Trascina e rilascia la card della deal nella colonna dello stage desiderato. L'operazione è immediata e il sistema registra automaticamente il cambio di stage nella timeline della deal.",
      },
      {
        q: "Cosa significa il Health Score?",
        a: "Il Health Score (da 0 a 100) indica la 'salute' della deal: un punteggio basso segnala che la deal è stagnante, mancano attività recenti o la data di chiusura è passata. Aiuta a identificare le opportunità che richiedono attenzione.",
      },
      {
        q: "Cos'è il valore ponderato della pipeline?",
        a: "Il valore ponderato è il fatturato atteso calcolato come: importo deal × probabilità di chiusura. Ad esempio, una deal da €10.000 con 70% di probabilità contribuisce €7.000 al forecast. La Finance Dashboard mostra il totale ponderato come indicatore previsionale.",
      },
      {
        q: "Come uso i commenti su una deal?",
        a: "Apri il dettaglio della deal → vai alla sezione 'Commenti'. Puoi lasciare messaggi per il team, menzionare colleghi e rispondere ai commenti esistenti. È uno spazio collaborativo interno sulla singola opportunità, separato dalla timeline delle attività.",
      },
      {
        q: "Posso tirare fuori un verbale della riunione?",
        a: "Sì, dal pulsante 'Verbale' sopra la cronologia della trattativa, se su quella trattativa è stata registrata almeno una riunione o una chiamata. Il verbale raccoglie quello che è stato scritto: data e durata di ogni incontro, chi c'era, le note così come le hai scritte, e come cose concordate i task nati in quella finestra. Non inventa niente — questo prodotto non registra cosa viene detto, quindi ogni frase del verbale l'ha scritta una persona. Se non è stato creato nessun task lo dice, invece di far sembrare che la riunione non abbia deciso niente. C'è un pulsante per copiarlo.",
      },
      {
        q: "Posso configurare i miei stage personalizzati?",
        a: "Sì, ma solo gli admin. Vai su Impostazioni → Pipeline Stage: puoi aggiungere, rinominare, riordinare e colorare gli stage. Puoi anche impostare una probabilità di chiusura di default per ogni stage (es. 'Proposta inviata' = 60%).",
      },
    ],
  },
  {
    id: "finance",
    icon: Banknote,
    color: "text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200 dark:border-emerald-800",
    title: "Finance",
    subtitle: "Dashboard finanziaria e ricavi",
    href: "/dashboard/sales/finance",
    description:
      "La Finance Dashboard aggrega i dati economici reali dell'organizzazione: ricavi da deal vinte, ordini completati e preventivi accettati, con trend mensile a 12 mesi e forecast ponderato della pipeline.",
    topics: [
      {
        q: "Cosa sono i 'ricavi reali' in Finance?",
        a: "I ricavi reali sono calcolati sommando: i valori delle deal marcate come 'Vinte', gli importi degli ordini in stato 'Completato' e i preventivi in stato 'Accettato'. Non include deal ancora aperte o preventivi in attesa.",
      },
      {
        q: "Come leggere il grafico trend a 12 mesi?",
        a: "Il grafico mostra mese per mese i ricavi realizzati negli ultimi 12 mesi. Puoi confrontare l'andamento stagionale, identificare i mesi migliori e quelli in calo, e usare questi dati per pianificare le attività future.",
      },
      {
        q: "La piattaforma supporta più valute?",
        a: "Sì. Le deal e i preventivi possono essere in valute diverse (EUR, USD, GBP, ecc.). Dall'header della dashboard puoi scegliere la valuta di visualizzazione: i tassi di cambio vengono aggiornati automaticamente dal sistema.",
      },
    ],
  },
  {
    id: "prodotti",
    icon: Package,
    color: "text-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950/30",
    border: "border-orange-200 dark:border-orange-800",
    title: "Prodotti",
    subtitle: "Catalogo beni e servizi",
    href: "/dashboard/sales/products",
    description:
      "Il Catalogo Prodotti è il registro centralizzato di tutti i beni e servizi che la tua organizzazione vende. I prodotti vengono riutilizzati nei preventivi e negli ordini, garantendo coerenza di prezzo e descrizione.",
    topics: [
      {
        q: "Come aggiungo un prodotto al catalogo?",
        a: "Vai su Prodotti → 'Nuovo Prodotto'. Inserisci nome, SKU (codice prodotto), prezzo unitario, percentuale IVA, unità di misura e categoria. Il prodotto sarà subito disponibile per essere selezionato nei preventivi e negli ordini.",
      },
      {
        q: "Cosa succede se modifico il prezzo di un prodotto già usato in un preventivo?",
        a: "Nulla cambia nei preventivi esistenti. Il prezzo viene copiato nel preventivo al momento della creazione della riga ('prezzo storico'), quindi i documenti già inviati rimangono invariati. Solo i nuovi preventivi useranno il prezzo aggiornato.",
      },
      {
        q: "Come disattivo un prodotto che non vendo più?",
        a: "Invece di eliminarlo (il che romperebbe i riferimenti nei documenti storici), usa il toggle 'Attivo/Inattivo'. I prodotti inattivi non appaiono nella selezione durante la creazione di nuovi preventivi, ma rimangono visibili nei documenti storici.",
      },
    ],
  },
  {
    id: "preventivi",
    icon: FileText,
    color: "text-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950/30",
    border: "border-violet-200 dark:border-violet-800",
    title: "Preventivi",
    subtitle: "Offerte commerciali e approvazioni",
    href: "/dashboard/sales/quotes",
    description:
      "Il modulo Preventivi gestisce l'intero processo di offerta commerciale: dalla redazione interna con workflow di approvazione, all'invio via email al cliente con link di visualizzazione, fino all'accettazione o al declino.",
    topics: [
      {
        q: "Come creo un nuovo preventivo?",
        a: "Vai su Preventivi → 'Nuovo Preventivo'. Seleziona l'azienda, il contatto di riferimento e la deal collegata. Aggiungi le righe di prodotto/servizio dal catalogo (o inserendo dati liberi), imposta eventuali sconti, l'IVA e la data di scadenza. Il sistema calcola automaticamente subtotale, sconti, IVA e totale finale.",
      },
      {
        q: "Cos'è il workflow di approvazione?",
        a: "È un passaggio facoltativo, non un blocco. Da una bozza puoi cliccare 'Richiedi Approvazione' e il preventivo passa in 'In approvazione': lo vede chi ha il ruolo di amministratore o proprietario del workspace, che può approvarlo o rifiutarlo con una nota. Una volta approvato compare il pulsante di invio. Chi ha il permesso di scrivere preventivi può però inviare direttamente dalla bozza senza passare di qui: l'approvazione serve a chi vuole una revisione interna, non impedisce l'invio a chi non la usa.",
      },
      {
        q: "Come invio il preventivo al cliente?",
        a: "Il pulsante di invio compare su una bozza e su un preventivo approvato. Il sistema prepara un'email con un link univoco al preventivo: il cliente lo apre senza fare login e vede il documento formattato. Oggetto e testo sono modificabili prima di partire, e niente parte finché non lo mandi tu.",
      },
      {
        q: "Come vede il preventivo il cliente?",
        a: "Il cliente riceve un'email con un link personalizzato. Cliccandolo, accede a una pagina pubblica con tutti i dettagli del preventivo: voci, prezzi, sconti, totali e note. Dalla stessa pagina può accettare o rifiutare il preventivo (con la possibilità di lasciare un motivo in caso di rifiuto).",
      },
      {
        q: "Come so se il cliente ha aperto il preventivo?",
        a: "Non appena il cliente apre il link, lo stato del preventivo cambia automaticamente da 'Inviato' a 'Visualizzato' e viene registrato l'orario esatto di apertura. Vedrai questa informazione nella timeline del preventivo e nel dettaglio.",
      },
      {
        q: "Come sollecito un preventivo senza risposta?",
        a: "Sul dettaglio del preventivo compare da solo un riquadro quando c'è motivo di sollecitare, e dice quale: mai aperto, aperto ma senza risposta, in scadenza, oppure già scaduto. Sono quattro situazioni diverse e propongono quattro messaggi diversi — a chi non ha aperto si chiede se la mail è arrivata, non una decisione. Il riquadro non compare su un preventivo già accettato o rifiutato, né su uno spedito ieri. Il testo è una bozza: modificala come vuoi, e parte solo quando premi tu.",
      },
      {
        q: "Posso esportare il preventivo in PDF?",
        a: "Sì. Dal dettaglio del preventivo trovi il pulsante 'Esporta PDF' per scaricare il documento formattato, pronto per l'invio tramite altri canali o per l'archiviazione.",
      },
    ],
  },
  {
    id: "ordini",
    icon: ShoppingCart,
    color: "text-pink-500",
    bg: "bg-pink-50 dark:bg-pink-950/30",
    border: "border-pink-200 dark:border-pink-800",
    title: "Ordini",
    subtitle: "Vendite confermate",
    href: "/dashboard/sales/orders",
    description:
      "Gli Ordini rappresentano le transazioni commerciali confermate. Tipicamente vengono generati dalla conversione di un preventivo accettato, ma possono anche essere creati manualmente.",
    topics: [
      {
        q: "Quali stati ha un ordine?",
        a: "Bozza (ordine appena creato, non ancora in lavorazione), In lavorazione (in corso di evasione), Completato (consegnato e concluso), Annullato (revocato). Solo gli ordini 'Completati' contribuiscono ai ricavi reali nella Finance Dashboard.",
      },
      {
        q: "Come vedo le righe di un ordine?",
        a: "Apri il dettaglio dell'ordine: trovi tutti i prodotti con quantità, prezzo unitario e totale per riga, e il totale in fondo. Le date di creazione e dell'ordine riportano anche l'orario esatto, non solo il giorno.",
      },
      {
        q: "Come faccio avanzare un ordine?",
        a: "Accanto al menu dello stato ci sono due pulsanti distinti, con un'icona ciascuno: uno porta l'ordine al passo successivo del flusso (bozza → in lavorazione → completato), l'altro lo segna concluso in un colpo solo. Sono separati apposta, perché sono due intenzioni diverse e confonderle costa: un ordine chiuso per sbaglio va riaperto a mano. Su un ordine completato o annullato non compare nessuno dei due, perché da lì non si avanza.",
      },
      {
        q: "Dove registro pagamenti e consegna?",
        a: "Nel dettaglio dell'ordine trovi il riquadro dei pagamenti: i versamenti sono elencati uno per uno con data e importo, non sommati in un unico numero, così si vede un acconto seguito da un saldo. Accanto puoi registrare la data di consegna effettiva.",
      },
    ],
  },
  {
    id: "targets-funnel",
    icon: TrendingUp,
    color: "text-cyan-500",
    bg: "bg-cyan-50 dark:bg-cyan-950/30",
    border: "border-cyan-200 dark:border-cyan-800",
    title: "Sales Targets e Funnel",
    subtitle: "Obiettivi e analisi del processo commerciale",
    href: "/dashboard/pipeline/targets",
    description:
      "Strumenti di pianificazione e analisi: i Sales Target ti permettono di fissare obiettivi di vendita per ogni commerciale e monitorare il raggiungimento in tempo reale. Il Funnel analizza l'efficacia del processo di conversione.",
    topics: [
      {
        q: "Come imposto un obiettivo di vendita?",
        a: "Vai su Sales Targets → 'Nuovo Target'. Seleziona il commerciale, il periodo (mensile, trimestrale o annuale) e l'importo obiettivo. Puoi anche impostare un numero minimo di deal da chiudere. L'admin vede i target di tutti i commerciali; ogni utente vede il proprio.",
      },
      {
        q: "Come monitoro il raggiungimento del target?",
        a: "La scheda Target nella CRM Dashboard mostra in tempo reale la barra di progresso con la percentuale raggiunta rispetto all'obiettivo del mese corrente. Il valore consuntivo è calcolato sommando le deal vinte nel periodo dal commerciale.",
      },
      {
        q: "Cosa mostra il Sales Funnel?",
        a: "Il grafico funnel mostra quanti lead/deal passano da un'fase all'altra del processo: prospecting → qualifica → proposta → negoziazione → chiusura. I tassi di conversione tra stage ti indicano dove il processo commerciale perde più opportunità.",
      },
    ],
  },
  {
    id: "marketing",
    icon: Mail,
    color: "text-rose-500",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    border: "border-rose-200 dark:border-rose-800",
    title: "Marketing",
    subtitle: "Template email e campagne",
    href: "/dashboard/marketing/campaigns",
    description:
      "Il modulo Marketing gestisce le comunicazioni di massa verso lead e contatti. Crea template riutilizzabili con variabili di personalizzazione, poi lanciaci campagne email con tracking di aperture e click.",
    topics: [
      {
        q: "Come creo un template email?",
        a: "Marketing → Template → 'Nuovo Template'. Dai un nome, scrivi oggetto e corpo in HTML, e usa i segnaposto per personalizzare ogni copia: nome, cognome, nome completo, azienda, email, telefono e ruolo, ciascuno fra doppie graffe. Gli stessi funzionano anche in inglese (first_name, last_name, company…) e con qualche sinonimo — societa vale come azienda — perché un segnaposto scritto quasi giusto non deve partire com'è verso il cliente. Gli spazi dentro le graffe sono tollerati. C'è anche il segnaposto del collegamento per disiscriversi, che va messo in ogni campagna.",
      },
      {
        q: "Come creo e invio una campagna?",
        a: "Vai su Marketing → Campagne → 'Nuova Campagna'. Scegli il template, seleziona i destinatari (contatti con consenso marketing attivo o lead), poi clicca 'Invia Ora' oppure schedula l'invio per una data/ora futura. Il sistema gestirà l'invio in coda, con retry automatico in caso di errori temporanei.",
      },
      {
        q: "Come funziona il tracking delle email?",
        a: "Il sistema rileva automaticamente quando un destinatario apre l'email (tramite pixel di tracking) e quando clicca su un link. Nel report della campagna trovi: numero email inviate, aperte, cliccate, rimbalzate e disiscrizioni, con le percentuali (open rate, click-through rate).",
      },
      {
        q: "Cosa succede se un contatto si disiscrizza?",
        a: "L'indirizzo finisce nella lista soppressioni ed è escluso da ogni invio successivo, anche se qualcuno lo rimette a mano fra i destinatari. ⚠️ La lista lavora sull'INDIRIZZO, non sulla scheda: rimettere la spunta del consenso marketing sul contatto non lo riporta fra i destinatari, perché sono due cose diverse — il consenso dice cosa vorreste fare, la soppressione dice cosa la persona ha chiesto. Anche i rimbalzi permanenti e le segnalazioni di spam finiscono lì, dallo stesso percorso.",
      },
    ],
  },
  {
    id: "task",
    icon: CheckSquare,
    color: "text-teal-500",
    bg: "bg-teal-50 dark:bg-teal-950/30",
    border: "border-teal-200 dark:border-teal-800",
    title: "Task e Progetti",
    subtitle: "Gestione attività, Gantt e workload",
    href: "/dashboard/tasks",
    description:
      "Il modulo Task è un sistema di project management integrato nel CRM. I task possono essere indipendenti o collegati a lead, contatti, aziende, deal o ticket. Supporta gerarchie di sottotask, assegnatari multipli e dipendenze.",
    topics: [
      {
        q: "Come creo un task?",
        a: "Vai su Task → 'Nuovo Task'. Inserisci titolo, descrizione, data di scadenza, priorità (bassa, normale, alta, critica, bloccante) e assegna il task a un collega. Puoi collegarlo a una entità CRM (lead, azienda, deal) per trovarlo facilmente anche dal profilo di quella entità.",
      },
      {
        q: "Cosa sono i subtask?",
        a: "Un task può contenere sottotask (fino a 3 livelli di profondità). Questo permette di scomporre attività complesse in passi più piccoli. La percentuale di avanzamento del task padre viene calcolata automaticamente in base al completamento dei figli.",
      },
      {
        q: "Posso assegnare un task a più persone?",
        a: "Sì. Ogni task supporta assegnatari multipli con ruoli distinti: Responsabile (esegue il lavoro), Supervisore (tiene la responsabilità), Consultato (fornisce input), Informato (viene aggiornato sull'avanzamento). Puoi aggiungere tutti i membri necessari.",
      },
      {
        q: "Come funziona il Gantt?",
        a: "La vista Gantt (Task → Gantt) mostra i task su una linea temporale orizzontale. Ogni barra rappresenta la durata di un task. Puoi trascinare le barre per modificare le date, vedere la struttura gerarchica (task → subtask) e configurare dipendenze tra task (es. 'il task B inizia solo dopo il completamento del task A').",
      },
      {
        q: "Cos'è la vista Workload?",
        a: "La vista Workload (Task → Workload) mostra per ogni membro del team quante ore di lavoro sono pianificate settimana per settimana. Le celle in rosso segnalano un sovraccarico; quelle grigie indicano un sottoutilizzo. Utile per bilanciare il carico tra le persone.",
      },
      {
        q: "Come registro il tempo lavorato su un task?",
        a: "Nel dettaglio del task trovi la sezione 'Time Tracking'. Avvia il timer quando inizi a lavorare e fermalo quando finisci, oppure inserisci manualmente le ore. Il sistema confronta le ore stimate con quelle effettive, dandoti una visione del rispetto dei tempi pianificati.",
      },
    ],
  },
  {
    id: "calendario",
    icon: Calendar,
    color: "text-sky-500",
    bg: "bg-sky-50 dark:bg-sky-950/30",
    border: "border-sky-200 dark:border-sky-800",
    title: "Calendario e Appuntamenti",
    subtitle: "Gestione meeting e disponibilità",
    href: "/dashboard/calendar",
    description:
      "Il Calendario centralizza tutti gli appuntamenti del team. Supporta meeting fisici e virtuali (Zoom, Teams, Jitsi), inviti con conferma RSVP e collegamento diretto alle entità CRM.",
    topics: [
      {
        q: "Come creo un appuntamento?",
        a: "Dal Calendario clicca su un orario libero o sul pulsante 'Nuovo Appuntamento'. Inserisci titolo, data/ora di inizio e fine, fuso orario, luogo fisico o link alla riunione virtuale (Zoom, Teams, Jitsi o altro). Puoi collegare l'appuntamento a un contatto, azienda, lead o deal.",
      },
      {
        q: "Come invito partecipanti?",
        a: "Nella form dell'appuntamento trovi la sezione 'Partecipanti'. Aggiungi colleghi interni o contatti esterni con il loro ruolo (Obbligatorio, Opzionale). Ogni partecipante riceverà una notifica e potrà rispondere Accetto / Rifiuto / Forse direttamente dall'email di invito, senza dover fare login.",
      },
      {
        q: "Posso vedere questi appuntamenti nel mio calendario personale?",
        a: "Sì, con il pulsante 'Iscriviti' in alto nella pagina Calendario. Ti dà un indirizzo da incollare in Google Calendar, Outlook o Calendario di Apple: da quel momento gli appuntamenti fissati qui compaiono nel tuo calendario e restano aggiornati da soli, senza doverli reinserire. Due avvertenze, entrambe scritte nella finestra: quell'indirizzo vale come una password, perché un programma di calendario non sa fare login e chiunque lo riceva può leggere i tuoi appuntamenti; e funziona in una direzione sola, quindi un appuntamento creato su Google non compare qui.",
      },
      {
        q: "La Dashboard mostra anche gli appuntamenti di oggi?",
        a: "Sì. Il widget Agenda nella CRM Dashboard mostra in tempo reale tutti i tuoi impegni di oggi: task in scadenza, attività pianificate (chiamate, meeting) e appuntamenti. Gli eventi sono ordinati cronologicamente.",
      },
    ],
  },
  {
    id: "chat",
    icon: MessageCircle,
    color: "text-purple-500",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200 dark:border-purple-800",
    title: "Chat Interno",
    subtitle: "Messaggistica tra colleghi",
    href: "/dashboard/chat",
    description:
      "Il modulo Chat consente la comunicazione diretta tra i membri del team senza uscire dalla piattaforma. Supporta messaggi diretti 1:1 e conversazioni di gruppo.",
    topics: [
      {
        q: "Come avvio una chat con un collega?",
        a: "Vai su Chat → 'Nuova Conversazione' → cerca il nome del collega. Puoi avviare una chat privata 1:1 o creare un gruppo (chat multi-utente con nome). Le conversazioni rimangono accessibili anche dopo la sessione.",
      },
      {
        q: "Posso silenziare una conversazione?",
        a: "Sì. Da qualsiasi conversazione, usa l'opzione 'Silenzia' e scegli per quanto tempo: la conversazione continuerà a ricevere messaggi, ma non ti invierà notifiche fino alla scadenza del silenzio.",
      },
    ],
  },
  {
    id: "ticket",
    icon: MessageSquare,
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    title: "Support Ticket",
    subtitle: "Gestione assistenza clienti",
    href: "/dashboard/support/tickets",
    description:
      "Il modulo Ticket gestisce le richieste di assistenza dei clienti in un sistema omnicanale. I ticket raccolgono comunicazioni da email, chat, telefono e social, con SLA configurabili e audit log completo.",
    topics: [
      {
        q: "Come creo un nuovo ticket?",
        a: "Vai su Ticket → 'Nuovo Ticket'. Inserisci soggetto, descrizione, canale di provenienza (email, chat, telefono, social), priorità e tipologia (supporto, bug, reclamo, richiesta info, task interno). Collega il ticket a un contatto, azienda o lead esistente.",
      },
      {
        q: "Quali stati ha un ticket?",
        a: "Nuovo (appena aperto), Aperto (preso in carico), In lavorazione (agente sta lavorando), In attesa (aspetta risposta cliente), In pausa, Risolto (soluzione fornita, in attesa di conferma), Chiuso (definitivamente concluso). Spostare un ticket in 'In attesa' sospende il timer SLA.",
      },
      {
        q: "Cosa sono le SLA?",
        a: "Le SLA definiscono i tempi massimi di prima risposta e di risoluzione per ogni priorità. Ad esempio: ticket urgente → prima risposta entro 1 ora, risoluzione entro 4 ore. Non aspettano la violazione per dirtelo: avvisano al 50% e all'80% del tempo rimasto, misurati sulla finestra del singolo ticket, così una politica da quattro ore e una da due giorni avvisano allo stesso punto nei propri termini. Alla violazione, se la politica nomina un gruppo, l'avviso va a tutte le persone di quel gruppo oltre che a chi ha il ticket in carico.",
      },
      {
        q: "Le SLA contano anche di notte e nel fine settimana?",
        a: "Dipende dalla singola politica. Di base contano sull'orologio da parete: una promessa di quattro ore su un ticket arrivato venerdì alle 17:00 scade alle 21:00 di venerdì, quando non c'è nessuno. Attivando 'Orari lavorativi' su quella politica il conteggio si ferma fuori orario, nei giorni di chiusura e nelle festività, e riprende all'apertura. L'impostazione è per politica e parte spenta: cambiare di nascosto il significato di una promessa già presa sarebbe una sorpresa, non una correzione. La settimana lavorativa, il fuso orario e i giorni di chiusura si impostano nella pagina SLA.",
      },
      {
        q: "Il ticket mi dice a che punto sta e a cosa somiglia?",
        a: "Sì, e sono due riquadri diversi in cima alla colonna di destra. Il primo dice di chi è la mossa — se aspetta noi o il cliente — e da quanto lo è, misurato dall'ultimo messaggio e non dall'apertura, poi cita la domanda iniziale con le parole del cliente e l'ultima nota interna, cioè cosa è già stato provato. Se nessuno ha ancora risposto lo dice apertamente: una nota interna non conta come risposta. Il secondo mostra a cosa somiglia il ticket fra quelli che questo workspace ha già risolto, con categoria e priorità proposte e i ticket da cui vengono, cliccabili: così puoi vedere perché ed essere in disaccordo. Niente di tutto questo viene applicato da solo, e quando i ticket simili non vanno d'accordo il riquadro preferisce non proporre niente.",
      },
      {
        q: "Cosa sono le Macro?",
        a: "Le Macro sono risposte predefinite per le domande più frequenti: invece di riscrivere la stessa cosa, ne scegli una e il testo entra nel riquadro di risposta, già pronto da modificare. I segnaposto come il numero del ticket, il nome del cliente e il tuo vengono sostituiti al momento dell'inserimento. Puoi sceglierle dal menu 'Macro' sopra il riquadro di risposta, oppure premere direttamente quelle che il riquadro dei suggerimenti propone per questo ticket.",
      },
      {
        q: "Come funziona il Kanban dei ticket?",
        a: "La vista Kanban mostra i ticket organizzati per stato in colonne affiancate. Puoi trascinare un ticket da una colonna all'altra per cambiarne lo stato. Ogni card mostra: numero ticket, priorità, assegnatario e tempo aggiornamento.",
      },
      {
        q: "Posso lasciare note interne su un ticket?",
        a: "Sì. Nel thread del ticket puoi scegliere se il messaggio è 'Pubblico' (visibile al cliente) o 'Interno' (visibile solo al team). Le note interne appaiono con uno sfondo diverso per distinguerle facilmente dalle risposte al cliente.",
      },
    ],
  },
  {
    id: "automazione",
    icon: Zap,
    color: "text-yellow-500",
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    border: "border-yellow-200 dark:border-yellow-800",
    title: "Automazione",
    subtitle: "Regole if-then automatiche",
    href: "/dashboard/automation",
    description:
      "L'Automation Engine ti permette di creare regole automatiche che si attivano al verificarsi di eventi nel sistema. Elimina le attività manuali ripetitive configurando azioni automatiche condizionali.",
    topics: [
      {
        q: "Come creo una regola di automazione?",
        a: "Vai su Automazione → 'Nuova Regola'. Scegli: l'entità target (deal, lead, contatto, azienda), il trigger (alla creazione o alla modifica), le condizioni (es. 'importo deal > 5000'), e le azioni da eseguire. Clicca 'Salva e Attiva' per metterla in produzione.",
      },
      {
        q: "Quali azioni può eseguire una regola?",
        a: "Sei: inviare un'email, creare un task collegato al record, aggiornare un campo del record (per esempio lo stato), inviare una notifica interna a un collega, chiamare un webhook, ed emettere un evento verso un'integrazione collegata. L'evento parte marcato come originato da una persona, non da una macchina, perché la regola scatta per qualcosa che qualcuno ha fatto: un'integrazione che ignora le proprie scritture lo vedrebbe altrimenti passare per suo e non reagirebbe.",
      },
      {
        q: "Devo scrivere ogni regola da zero?",
        a: "No. Nella pagina Automazione c'è una libreria di regole già pronte per le situazioni più comuni — un lead da richiamare, una trattativa importante appena arrivata, un ticket urgente, un ringraziamento al cliente. Ne scegli una, la adatti e la attivi: è più veloce che partire da un foglio bianco, e mostra come sono fatte.",
      },
      {
        q: "Quali condizioni posso mettere?",
        a: "Oltre a uguale e diverso: maggiore, minore, maggiore o uguale, minore o uguale, contiene, non contiene, è vuoto, non è vuoto. E tre che guardano il cambiamento invece del valore — è cambiato, è diventato, era — che servono per reagire a un passaggio di stato invece che allo stato in sé.",
      },
      {
        q: "Esempio pratico di automazione?",
        a: "Esempio: 'Quando una deal viene creata con importo maggiore di €10.000, crea automaticamente un task per il responsabile vendite con titolo Revisione deal high-value e scadenza tra 2 giorni'. Oppure: 'Quando un lead viene qualificato, invia una email di benvenuto al contatto e notifica l'agente assegnato'.",
      },
      {
        q: "Come verifico che le regole funzionino?",
        a: "Nella pagina Automazione trovi la sezione 'Log di esecuzione': per ogni attivazione vedi l'entità coinvolta, il risultato (successo o errore), le azioni eseguite e l'eventuale messaggio di errore. Se una regola non si attiva come previsto, controlla i log per capire il motivo.",
      },
    ],
  },
  {
    id: "report",
    icon: BarChart3,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    title: "Report e Analytics",
    subtitle: "Analisi performance e report personalizzati",
    href: "/dashboard/reports",
    description:
      "Il modulo Report fornisce analisi delle performance operative: KPI globali, attività per utente, task completati e campagne inviate. Il Report Builder permette di creare report personalizzati senza scrivere codice.",
    topics: [
      {
        q: "Cosa mostrano i report standard?",
        a: "I report standard includono: totale azioni registrate nel periodo (per utente o per tutto il team), task completati, deal create e chiuse, ticket aperti e risolti, campagne email inviate. Tutti i dati sono filtrabili per data e per singolo utente.",
      },
      {
        q: "Come uso il Report Builder?",
        a: "Vai su Report → Report Builder. Seleziona l'entità da analizzare (deal, contatti, lead, ticket, ecc.), scegli le metriche da visualizzare, applica i filtri e scegli il tipo di grafico (barre, linea, torta o tabella). Puoi salvare il report per consultarlo in futuro o condividerlo con il team.",
      },
      {
        q: "Posso esportare il registro delle attività?",
        a: "Sì, in CSV, filtrabile per intervallo di date e per singola persona. Serve il rango di amministratore dello spazio di lavoro: è il registro di chi ha fatto cosa, quindi non è una lettura come le altre.",
      },
      {
        q: "Dove trovo le analisi avanzate della pipeline?",
        a: "In Analytics → Pipeline trovi analisi approfondite: distribuzione deal per stage, azioni di gestione in coda, rischi identificati e confronto forecast vs. target. Questa sezione è pensata per i responsabili commerciali.",
      },
    ],
  },
  {
    id: "impostazioni",
    icon: Settings,
    color: "text-gray-500",
    bg: "bg-gray-50 dark:bg-gray-950/30",
    border: "border-gray-200 dark:border-gray-700",
    title: "Impostazioni",
    subtitle: "Configurazione del sistema (solo admin)",
    href: "/dashboard/settings",
    description:
      "La sezione Impostazioni raggruppa tutte le configurazioni globali della piattaforma. L'accesso è riservato ad admin e owner.",
    topics: [
      {
        q: "Come aggiungo campi personalizzati?",
        a: "Impostazioni → Campi Personalizzati. Seleziona l'entità (contatto, lead, azienda, deal), scegli il tipo di campo (testo, numero, data, selezione, multi-selezione, si/no, URL), assegna un nome e salva. Il campo apparirà immediatamente nella form di tutti i record di quell'entità.",
      },
      {
        q: "Come configuro il mittente delle email?",
        a: "Impostazioni → Email. Scegli il provider: Resend (basta la tua API key) o SMTP (host, porta, credenziali e TLS). Poi imposta nome mittente e indirizzo da cui parte tutto: campagne, inviti, notifiche. ⚠️ Quell'indirizzo non serve solo a spedire: è anche quello a cui i clienti rispondono, e da cui il sistema riconosce che una mail in arrivo appartiene a questo workspace. Se resta vuoto, le email in entrata non diventano ticket.",
      },
      {
        q: "Come collego un programma esterno a Flux?",
        a: "Impostazioni → Chiavi API, dove generi una chiave del workspace. Si passa come intestazione `Authorization: Bearer <chiave>` e vale solo per questo workspace: quale sia lo dice la chiave stessa, quindi chi integra non deve indicarlo da nessun'altra parte, e non può sbagliare workspace per errore. La chiave si vede una volta sola al momento della creazione: se la perdi ne generi un'altra e la vecchia smette di funzionare. Le rotte disponibili, con corpi e risposte, sono nella documentazione API del pannello di amministrazione.",
      },
      {
        q: "Come gestisco le risposte rapide per i ticket?",
        a: "Impostazioni → Macro. Crea nuove macro con titolo e testo pre-compilato. Le macro pubbliche sono visibili a tutto il team nel modulo ticket; quelle private sono visibili solo a te. Sono disponibili direttamente nella casella di risposta del ticket.",
      },
    ],
  },
  {
    id: "notifiche",
    icon: Bell,
    color: "text-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950/30",
    border: "border-orange-200 dark:border-orange-800",
    title: "Notifiche",
    subtitle: "Avvisi e aggiornamenti in tempo reale",
    href: null,
    description:
      "Il sistema di notifiche in-app ti tiene aggiornato sugli eventi rilevanti senza lasciare la piattaforma. L'icona campanella nell'header mostra il conteggio degli avvisi non letti.",
    topics: [
      {
        q: "Quali eventi generano una notifica?",
        a: "Quando un task assegnato a te sta per scadere o è scaduto, quando una tua trattativa viene chiusa come vinta, quando ti viene assegnato un lead, quando parte una campagna che hai avviato. Sui ticket: quando una promessa SLA ha consumato metà del tempo e poi l'80%, così puoi ancora farci qualcosa, e alla violazione — che avvisa anche le persone del gruppo indicato nella politica, ciascuna una volta sola. Le automazioni possono aggiungerne altre.",
      },
      {
        q: "Come segno le notifiche come lette?",
        a: "Clicca sull'icona campanella → si apre il pannello con le notifiche recenti. Clicca su una notifica per navigare alla pagina corrispondente (la notifica viene marcata come letta). Oppure usa 'Segna tutte come lette' per azzerarle tutte in un colpo.",
      },
    ],
  },
  {
    id: "utenti-ruoli",
    icon: Shield,
    color: "text-red-500",
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800",
    title: "Utenti e Ruoli",
    subtitle: "Gestione accessi e permessi (solo admin)",
    href: "/dashboard/users",
    description:
      "Il sistema di gestione accessi controlla chi può fare cosa nella piattaforma. Quattro livelli di ruolo gerarchici garantiscono che ogni utente veda e modifichi solo quello che gli compete.",
    topics: [
      {
        q: "Quali sono i ruoli disponibili?",
        a: "Owner: accesso totale, inclusa l'amministrazione dello spazio di lavoro. Admin: utenti, ruoli e impostazioni. Editor: crea e modifica i record CRM. Viewer: sola lettura. Sono gerarchici — ogni ruolo include i permessi di quello sotto — e valgono DENTRO questo spazio di lavoro: sono cosa diversa dal ruolo del personale di Flux, che opera sul pannello di amministrazione e non c'entra con quello che vedi qui. ⚠️ Sola lettura vuol dire ovunque, comprese le API: una chiamata fatta con la sessione di un viewer viene rifiutata come lo sarebbe un pulsante.",
      },
      {
        q: "Come invito un nuovo utente?",
        a: "Utenti → 'Invita Utente'. Inserisci l'email del nuovo membro e seleziona il ruolo da assegnargli. Il sistema invia automaticamente un'email con un link di accettazione dell'invito. Il link è valido per un tempo limitato e permette all'invitato di impostare la propria password.",
      },
      {
        q: "Come cambio il ruolo a un utente?",
        a: "Utenti → trova la persona nella lista → apri il menu del ruolo e scegline uno nuovo. ⚠️ Non ha effetto all'istante: il ruolo viene riletto al massimo ogni cinque minuti, quindi fino ad allora la sessione già aperta continua a vedere i permessi di prima. Vale anche per una rimozione dal workspace. Se devi togliere l'accesso subito, rimuovi la persona e falla disconnettere.",
      },
      {
        q: "Cosa sono i Gruppi Utente?",
        a: "I Gruppi permettono di organizzare gli utenti in team (es. 'Team Commerciale Nord', 'Supporto L2'). Puoi assegnare lead, contatti, aziende e deal a un gruppo invece che a un singolo utente. Utile per gestire la visibilità e la suddivisione del lavoro tra team.",
      },
    ],
  },
];

// ─── Component ─────────────────────────────────────────────────────────────────

export default function HelpPage() {
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
      <aside className="hidden w-64 shrink-0 xl:block">
        <div className="sticky top-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cerca nell'aiuto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
          {/* Nav */}
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
                    !isVisible && "opacity-30 pointer-events-none",
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
            <h1 className="font-bold text-2xl tracking-tight">Centro Assistenza</h1>
            <p className="mt-1 text-muted-foreground">
              Scopri come usare ogni funzionalità di Flux CRM. Usa la ricerca o naviga per sezione.
            </p>
          </div>
        </div>

        {/* Mobile search */}
        <div className="relative xl:hidden">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cerca nell'aiuto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Quick links */}
        {!search && (
          <div>
            <p className="mb-3 font-medium text-sm text-muted-foreground uppercase tracking-wide">Sezioni principali</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {sections.slice(0, 8).map((s) => {
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
                    <span className="truncate font-medium text-sm">{s.title}</span>
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
            <p className="mt-1 text-muted-foreground text-sm">Prova con un termine diverso.</p>
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
                  {/* Section header */}
                  <CardHeader className={cn("flex flex-row items-center gap-4 border-b pb-4", section.bg)}>
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                        section.bg,
                        "border",
                        section.border,
                      )}
                    >
                      <Icon className={cn("h-5 w-5", section.color)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-lg">{section.title}</CardTitle>
                        <Badge variant="secondary" className="font-normal text-xs">
                          {section.subtitle}
                        </Badge>
                      </div>
                    </div>
                    {section.href && (
                      <Link
                        href={section.href}
                        className={cn(
                          "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                          "border",
                          section.border,
                          "hover:bg-background/60",
                          section.color,
                        )}
                      >
                        Vai alla sezione
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </CardHeader>

                  <CardContent className="p-0">
                    {/* Description */}
                    <div className="flex items-start gap-3 border-b bg-muted/20 px-6 py-4">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="text-muted-foreground text-sm leading-relaxed">{section.description}</p>
                    </div>

                    {/* FAQ */}
                    <Accordion type="multiple" className="divide-y">
                      {section.topics.map((topic, i) => (
                        <AccordionItem key={i} value={`${section.id}-${i}`} className="border-0 px-6">
                          <AccordionTrigger className="py-4 text-left text-sm font-medium hover:no-underline">
                            {topic.q}
                          </AccordionTrigger>
                          <AccordionContent className="pb-4 text-muted-foreground text-sm leading-relaxed">
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
          <p className="font-medium text-sm">Non hai trovato quello che cercavi?</p>
          <p className="mt-1 text-muted-foreground text-sm">
            Contatta il tuo amministratore di sistema per assistenza personalizzata.
          </p>
        </div>
      </div>
    </div>
  );
}
