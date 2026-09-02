/**
 * La busta di un evento, e le regole del ritentativo. **Senza dipendenze.**
 *
 * ⚠️ Stanno qui e non in `actions/webhooks` per una ragione di strati: quel modulo è un
 * server action e si trascina dietro l'autenticazione, quindi una libreria che ne importi
 * una costante importa anche next-auth. Un test lo ha mostrato — non partiva — ma il difetto
 * non era del test: una libreria che dipende da un'azione ha le frecce al contrario.
 */

/** Chi ha causato il cambiamento che ha prodotto l'evento. */
export interface Origin {
  /** `api` = una macchina ha scritto dall'API; `user` = qualcuno nell'interfaccia. */
  via: "api" | "user" | "system";
  /** L'identificativo dell'utente, quando c'è. Le macchine non ne hanno uno. */
  actor?: string | null;
}

/**
 * ⚠️ **`id` esiste perché chi riceve possa distinguere un ritentativo da un secondo
 * evento.** Senza, un'integrazione che riceve due volte la stessa consegna — cosa che
 * qualunque trasporto affidabile prima o poi fa — non ha modo di saperlo, e agisce due
 * volte. Si genera una volta per evento e resta lo stesso a ogni tentativo.
 *
 * ⚠️ **`origin` esiste perché nessuno insegua la propria coda.** Un'integrazione scrive un
 * lead dall'API, questo CRM emette `lead.created`, e l'integrazione lo riceve: se non
 * distingue che il cambiamento è suo, reagisce a sé stessa e non smette.
 */
export interface BustaEvento {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
  origin: Origin;
}

/**
 * Il prefisso con cui si riconosce un tentativo **mai partito** perché il webhook non ha un
 * segreto.
 *
 * ⚠️ Serve a distinguerlo da una consegna fallita: quella si ritenta, questa no — ritentare
 * non aggiunge un segreto, e ripeterebbe per giorni una riga che chiede una configurazione.
 * È scritto qui e letto in due posti: due grafie diverse sarebbero un ritentativo infinito.
 */
export const NON_FIRMABILE = "not delivered: this webhook has no secret";

/** Quanti tentativi prima di smettere: senza un limite, un indirizzo che non esiste più
 * verrebbe chiamato per sempre. */
export const TENTATIVI_MASSIMI = 5;

/** Quanto si aspetta fra un tentativo e l'altro. L'ultima attesa si ripete: un fornitore
 * che è giù da ore non va martellato, ma nemmeno abbandonato prima del tempo. */
export const ATTESE_MS = [60_000, 5 * 60_000, 30 * 60_000, 3 * 60 * 60_000];
