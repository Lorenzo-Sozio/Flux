/**
 * ticket-triage.ts — what this ticket looks like, judged against the ones already
 * answered.
 *
 * The audit asks for four things at triage (rilievo S-05): a suggested category
 * and priority, the similar tickets somebody already solved, a reply drafted from
 * the existing macros, and a summary of the thread for whoever takes over.
 *
 * Three of those four are not a question for a language model. They are the same
 * question — *what does this resemble?* — asked of the workspace's own history,
 * and answering it from history is better than answering it from a model: the
 * proposal comes with the evidence attached, so an agent can see **why** it was
 * suggested and disagree with it. Only the fourth, summarising a thread in prose,
 * genuinely needs one.
 *
 * Pure, and scored on words rather than on embeddings, because a support desk's
 * vocabulary is small and repetitive: the same twenty phrases arrive all week.
 */

/** Words too common to say anything about which ticket resembles which. */
const STOP_WORDS = new Set([
  // English
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "up",
  "about",
  "into",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "i",
  "we",
  "you",
  "they",
  "my",
  "our",
  "your",
  "not",
  "no",
  "can",
  "cannot",
  "cant",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "would",
  "could",
  "should",
  "will",
  "when",
  "what",
  "why",
  "how",
  "please",
  "hi",
  "hello",
  "thanks",
  "thank",
  "regards",
  "dear",
  // Italian
  "il",
  "lo",
  "la",
  "i",
  "gli",
  "le",
  "un",
  "uno",
  "una",
  "di",
  "del",
  "della",
  "dei",
  "delle",
  "e",
  "ed",
  "o",
  "che",
  "non",
  "per",
  "con",
  "su",
  "da",
  "in",
  "al",
  "alla",
  "ai",
  "alle",
  "come",
  "quando",
  "perche",
  "perché",
  "se",
  "ma",
  "mi",
  "ci",
  "vi",
  "si",
  "sono",
  "essere",
  "stato",
  "ho",
  "hai",
  "ha",
  "abbiamo",
  "avete",
  "hanno",
  "fare",
  "fatto",
  "grazie",
  "salve",
  "buongiorno",
  "buonasera",
  "cordiali",
  "saluti",
]);

/**
 * The words worth comparing, lowercased and de-duplicated.
 *
 * Accents are folded and anything shorter than three characters is dropped: "ok"
 * and "vs" match everything and mean nothing.
 */
export function keywords(text: string): Set<string> {
  const folded = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  const words = folded.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * How much two texts have in common, from 0 to 1.
 *
 * Jaccard over the words that survive: shared words divided by the words either
 * one uses. It is deliberately symmetric and length-aware — a long ticket that
 * happens to contain three words of a short one is not a match, and a naive
 * "how many of mine appear in yours" would say it was.
 */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface PastTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string | null;
  type: string | null;
  component: string | null;
  priority: string;
  resolvedAt: Date | null;
}

export interface SimilarTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  score: number;
  /** The words that made it a match, so the suggestion carries its evidence. */
  shared: string[];
  priority: string;
  type: string | null;
  component: string | null;
}

/** Below this two tickets share a word or two by accident, not by subject. */
export const SIMILARITY_FLOOR = 0.12;

/**
 * The resolved tickets this one most resembles.
 *
 * Ordered by resemblance, capped, and never including the ticket itself.
 */
export function findSimilar(
  subject: string,
  description: string | null,
  history: PastTicket[],
  options: { limit?: number; excludeId?: string; floor?: number } = {},
): SimilarTicket[] {
  const { limit = 5, excludeId, floor = SIMILARITY_FLOOR } = options;
  const mine = keywords(`${subject} ${description ?? ""}`);
  if (mine.size === 0) return [];

  return history
    .filter((t) => t.id !== excludeId)
    .map((t) => {
      const theirs = keywords(`${t.subject} ${t.description ?? ""}`);
      const score = similarity(mine, theirs);
      const shared = [...mine].filter((w) => theirs.has(w));
      return { ...t, score, shared };
    })
    .filter((t) => t.score >= floor)
    .sort((a, b) => b.score - a.score || a.ticketNumber.localeCompare(b.ticketNumber))
    .slice(0, limit)
    .map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      score: Math.round(t.score * 100) / 100,
      shared: t.shared.slice(0, 6),
      priority: t.priority,
      type: t.type,
      component: t.component,
    }));
}

export interface Suggestion<T> {
  value: T;
  /** How much of the agreement among similar tickets backs it, 0 to 1. */
  confidence: number;
  /** Which tickets voted for it, so the agent can look. */
  from: string[];
}

/**
 * What the similar tickets agree this one is.
 *
 * A plurality vote weighted by resemblance, so a close match counts for more than
 * a distant one. Returns nothing when the neighbours disagree: a suggestion
 * nobody stands behind is worse than none, because it is followed.
 */
function vote<T extends string>(
  neighbours: SimilarTicket[],
  pick: (t: SimilarTicket) => T | null | undefined,
  minimumConfidence: number,
): Suggestion<T> | null {
  const weights = new Map<T, { weight: number; from: string[] }>();
  let total = 0;

  for (const n of neighbours) {
    const value = pick(n);
    if (!value) continue;
    const entry = weights.get(value) ?? { weight: 0, from: [] };
    entry.weight += n.score;
    entry.from.push(n.ticketNumber);
    weights.set(value, entry);
    total += n.score;
  }

  if (total === 0) return null;

  const [best] = [...weights.entries()].sort((a, b) => b[1].weight - a[1].weight);
  if (!best) return null;

  const confidence = best[1].weight / total;
  if (confidence < minimumConfidence) return null;

  return { value: best[0], confidence: Math.round(confidence * 100) / 100, from: best[1].from };
}

/**
 * How much of the weight the winner must carry to count as agreement.
 *
 * Not a bare majority: between two candidates, "more than half" is whichever
 * neighbour happened to resemble this ticket slightly more, which is a coin toss
 * with a number attached. Two thirds means the winner outweighs everything else
 * combined by two to one — which is what a person means by "they agree", and
 * what makes it safe to show the answer as a proposal rather than a guess.
 */
export const MIN_CONFIDENCE = 2 / 3;

export interface Triage {
  similar: SimilarTicket[];
  type: Suggestion<string> | null;
  component: Suggestion<string> | null;
  priority: Suggestion<string> | null;
}

/**
 * The whole proposal for one ticket.
 *
 * Every part of it is a suggestion with its evidence attached and nothing is
 * applied: the audit's rule for this section is "always proposed, always
 * editable, never sent on its own", and a triage that quietly set the priority
 * would be exactly the opposite.
 */
export function triage(
  subject: string,
  description: string | null,
  history: PastTicket[],
  options: { excludeId?: string; limit?: number } = {},
): Triage {
  const similar = findSimilar(subject, description, history, options);
  return {
    similar,
    type: vote(similar, (t) => t.type, MIN_CONFIDENCE),
    component: vote(similar, (t) => t.component, MIN_CONFIDENCE),
    priority: vote(similar, (t) => t.priority, MIN_CONFIDENCE),
  };
}

export interface MacroCandidate {
  id: string;
  name: string;
  description: string | null;
  body: string;
}

export interface SuggestedMacro {
  id: string;
  name: string;
  score: number;
  shared: string[];
}

/**
 * Which saved replies fit what was asked.
 *
 * Matched on the macro's name and description rather than on its body: the body
 * is the answer and shares little vocabulary with the question, while the name is
 * what somebody wrote down to describe when to use it.
 */
export function suggestMacros(
  subject: string,
  description: string | null,
  macros: MacroCandidate[],
  options: { limit?: number; floor?: number } = {},
): SuggestedMacro[] {
  const { limit = 3, floor = SIMILARITY_FLOOR } = options;
  const mine = keywords(`${subject} ${description ?? ""}`);
  if (mine.size === 0) return [];

  return macros
    .map((m) => {
      const theirs = keywords(`${m.name} ${m.description ?? ""}`);
      const score = similarity(mine, theirs);
      return { id: m.id, name: m.name, score, shared: [...mine].filter((w) => theirs.has(w)) };
    })
    .filter((m) => m.score >= floor)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((m) => ({ ...m, score: Math.round(m.score * 100) / 100, shared: m.shared.slice(0, 6) }));
}
