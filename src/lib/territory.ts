/**
 * Which territory a record belongs to, from the address typed on it.
 *
 * ⚠️⚠️ The address fields are free text. The same customer arrives as "Italy",
 * "Italia", "IT" or "italia "; the same province as "MI", "Milano" or "Milan"; and
 * a territory defined as "Lombardia" has to take all of them. Matching the raw
 * strings would put most records in no territory at all, and a report that says
 * "no territory: 70%" reads as a sales problem rather than a spelling one.
 *
 * ⚠️ The territory is **computed, never stored on the record.** Storing it would
 * mean recomputing it at every place that writes an address — the lead modal, the
 * import API, conversion, merging, tickets from email — and the first place that
 * forgot would leave records in a territory they have moved out of. Computed, a
 * change to a territory's definition also applies to every record at once,
 * including the ones written before it existed.
 *
 * Territories drive assignment and reports. They do not restrict who can see a
 * record.
 */

import { type Refusal, refuse } from "@/lib/i18n-message";

export interface TerritoryRule {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 codes. Empty: any country. */
  countries: string[];
  /** Provinces, regions or states, as typed. Empty: anywhere in the countries. */
  states: string[];
  /** Postal code prefixes. Empty: any postal code. */
  postalPrefixes: string[];
}

export interface Located {
  country?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

/** Upper case, accents and punctuation removed, spaces collapsed: "Forlì-Cesena" → "FORLI CESENA". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// ─── Countries ────────────────────────────────────────────────────────────────

// Codes Intl names that are not countries.
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]);

// Names people type that neither the English nor the Italian display name covers.
const EXTRA_COUNTRY_NAMES: Record<string, string[]> = {
  GB: ["UK", "GBR", "GREAT BRITAIN", "GRAN BRETAGNA", "ENGLAND", "INGHILTERRA", "SCOTLAND", "SCOZIA", "WALES"],
  US: ["USA", "UNITED STATES OF AMERICA", "STATI UNITI D AMERICA", "AMERICA"],
  IT: ["ITA", "REPUBBLICA ITALIANA"],
  DE: ["DEU", "DEUTSCHLAND"],
  FR: ["FRA"],
  ES: ["ESP", "ESPANA"],
  CH: ["CHE", "SCHWEIZ", "SUISSE", "SVIZZERA"],
  AT: ["AUT", "OSTERREICH"],
  NL: ["NLD", "HOLLAND", "OLANDA"],
  SM: ["REPUBBLICA DI SAN MARINO"],
  VA: ["CITTA DEL VATICANO", "VATICANO", "VATICAN"],
};

let countryIndex: Map<string, string> | null = null;
let countryCodes: Set<string> | null = null;

function buildCountryIndex() {
  const index = new Map<string, string>();
  const codes = new Set<string>();
  for (const code of Object.keys(EXTRA_COUNTRY_NAMES)) {
    codes.add(code);
    index.set(code, code);
  }
  // ⚠️ Every runtime this ships to has full ICU today. If one did not, the names
  // would degrade to the codes and the common names above, rather than every page
  // that reads a territory throwing.
  if (typeof Intl.DisplayNames !== "function") {
    countryIndex = index;
    countryCodes = codes;
    for (const [code, names] of Object.entries(EXTRA_COUNTRY_NAMES)) {
      for (const name of names) index.set(fold(name), code);
    }
    return;
  }
  const en = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });
  const it = new Intl.DisplayNames(["it"], { type: "region", fallback: "code" });
  const A = "A".charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      if (NOT_COUNTRIES.has(code)) continue;
      const nameEn = en.of(code);
      if (!nameEn || nameEn === code) continue;
      codes.add(code);
      index.set(code, code);
      index.set(fold(nameEn), code);
      const nameIt = it.of(code);
      if (nameIt && nameIt !== code) index.set(fold(nameIt), code);
    }
  }
  for (const [code, names] of Object.entries(EXTRA_COUNTRY_NAMES)) {
    for (const name of names) index.set(fold(name), code);
  }
  countryIndex = index;
  countryCodes = codes;
}

/** The ISO code of a typed country, or null when it is not recognisable as one. */
export function countryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!countryIndex) buildCountryIndex();
  return countryIndex?.get(fold(raw)) ?? null;
}

export function isCountryCode(code: string): boolean {
  if (!countryCodes) buildCountryIndex();
  return countryCodes?.has(code) ?? false;
}

// ─── Italian provinces and regions ────────────────────────────────────────────

/**
 * Sigla, name and region of every Italian province, plus the other names people
 * type for it.
 *
 * ⚠️ The four Sardinian sigle CI, VS, OG and OT were abolished and have been
 * reorganised more than once since. Addresses still carry them, and all of them
 * are in Sardegna whatever the current arrangement, so they stay.
 */
const PROVINCES: [code: string, name: string, region: string, aliases?: string[]][] = [
  ["CH", "Chieti", "Abruzzo"],
  ["AQ", "L'Aquila", "Abruzzo", ["Aquila"]],
  ["PE", "Pescara", "Abruzzo"],
  ["TE", "Teramo", "Abruzzo"],
  ["MT", "Matera", "Basilicata"],
  ["PZ", "Potenza", "Basilicata"],
  ["CZ", "Catanzaro", "Calabria"],
  ["CS", "Cosenza", "Calabria"],
  ["KR", "Crotone", "Calabria"],
  ["RC", "Reggio Calabria", "Calabria", ["Reggio di Calabria"]],
  ["VV", "Vibo Valentia", "Calabria"],
  ["AV", "Avellino", "Campania"],
  ["BN", "Benevento", "Campania"],
  ["CE", "Caserta", "Campania"],
  ["NA", "Napoli", "Campania", ["Naples"]],
  ["SA", "Salerno", "Campania"],
  ["BO", "Bologna", "Emilia-Romagna"],
  ["FE", "Ferrara", "Emilia-Romagna"],
  ["FC", "Forlì-Cesena", "Emilia-Romagna", ["Forli"]],
  ["MO", "Modena", "Emilia-Romagna"],
  ["PR", "Parma", "Emilia-Romagna"],
  ["PC", "Piacenza", "Emilia-Romagna"],
  ["RA", "Ravenna", "Emilia-Romagna"],
  ["RE", "Reggio Emilia", "Emilia-Romagna", ["Reggio nell'Emilia"]],
  ["RN", "Rimini", "Emilia-Romagna"],
  ["GO", "Gorizia", "Friuli-Venezia Giulia"],
  ["PN", "Pordenone", "Friuli-Venezia Giulia"],
  ["TS", "Trieste", "Friuli-Venezia Giulia"],
  ["UD", "Udine", "Friuli-Venezia Giulia"],
  ["FR", "Frosinone", "Lazio"],
  ["LT", "Latina", "Lazio"],
  ["RI", "Rieti", "Lazio"],
  ["RM", "Roma", "Lazio", ["Rome"]],
  ["VT", "Viterbo", "Lazio"],
  ["GE", "Genova", "Liguria", ["Genoa"]],
  ["IM", "Imperia", "Liguria"],
  ["SP", "La Spezia", "Liguria", ["Spezia"]],
  ["SV", "Savona", "Liguria"],
  ["BG", "Bergamo", "Lombardia"],
  ["BS", "Brescia", "Lombardia"],
  ["CO", "Como", "Lombardia"],
  ["CR", "Cremona", "Lombardia"],
  ["LC", "Lecco", "Lombardia"],
  ["LO", "Lodi", "Lombardia"],
  ["MN", "Mantova", "Lombardia", ["Mantua"]],
  ["MI", "Milano", "Lombardia", ["Milan"]],
  ["MB", "Monza e Brianza", "Lombardia", ["Monza", "Monza e della Brianza", "Monza Brianza"]],
  ["PV", "Pavia", "Lombardia"],
  ["SO", "Sondrio", "Lombardia"],
  ["VA", "Varese", "Lombardia"],
  ["AN", "Ancona", "Marche"],
  ["AP", "Ascoli Piceno", "Marche"],
  ["FM", "Fermo", "Marche"],
  ["MC", "Macerata", "Marche"],
  ["PU", "Pesaro e Urbino", "Marche", ["Pesaro Urbino", "Pesaro"]],
  ["CB", "Campobasso", "Molise"],
  ["IS", "Isernia", "Molise"],
  ["AL", "Alessandria", "Piemonte"],
  ["AT", "Asti", "Piemonte"],
  ["BI", "Biella", "Piemonte"],
  ["CN", "Cuneo", "Piemonte"],
  ["NO", "Novara", "Piemonte"],
  ["TO", "Torino", "Piemonte", ["Turin"]],
  ["VB", "Verbano-Cusio-Ossola", "Piemonte", ["Verbania"]],
  ["VC", "Vercelli", "Piemonte"],
  ["BA", "Bari", "Puglia"],
  ["BT", "Barletta-Andria-Trani", "Puglia", ["BAT"]],
  ["BR", "Brindisi", "Puglia"],
  ["FG", "Foggia", "Puglia"],
  ["LE", "Lecce", "Puglia"],
  ["TA", "Taranto", "Puglia"],
  ["CA", "Cagliari", "Sardegna"],
  ["NU", "Nuoro", "Sardegna"],
  ["OR", "Oristano", "Sardegna"],
  ["SS", "Sassari", "Sardegna"],
  ["SU", "Sud Sardegna", "Sardegna"],
  ["CI", "Carbonia-Iglesias", "Sardegna"],
  ["VS", "Medio Campidano", "Sardegna"],
  ["OG", "Ogliastra", "Sardegna"],
  ["OT", "Olbia-Tempio", "Sardegna", ["Gallura"]],
  ["AG", "Agrigento", "Sicilia"],
  ["CL", "Caltanissetta", "Sicilia"],
  ["CT", "Catania", "Sicilia"],
  ["EN", "Enna", "Sicilia"],
  ["ME", "Messina", "Sicilia"],
  ["PA", "Palermo", "Sicilia"],
  ["RG", "Ragusa", "Sicilia"],
  ["SR", "Siracusa", "Sicilia", ["Syracuse"]],
  ["TP", "Trapani", "Sicilia"],
  ["AR", "Arezzo", "Toscana"],
  ["FI", "Firenze", "Toscana", ["Florence"]],
  ["GR", "Grosseto", "Toscana"],
  ["LI", "Livorno", "Toscana"],
  ["LU", "Lucca", "Toscana"],
  ["MS", "Massa-Carrara", "Toscana", ["Massa", "Massa e Carrara"]],
  ["PI", "Pisa", "Toscana"],
  ["PT", "Pistoia", "Toscana"],
  ["PO", "Prato", "Toscana"],
  ["SI", "Siena", "Toscana"],
  ["BZ", "Bolzano", "Trentino-Alto Adige", ["Bozen", "Alto Adige", "Sudtirol"]],
  ["TN", "Trento", "Trentino-Alto Adige"],
  ["PG", "Perugia", "Umbria"],
  ["TR", "Terni", "Umbria"],
  ["AO", "Aosta", "Valle d'Aosta"],
  ["BL", "Belluno", "Veneto"],
  ["PD", "Padova", "Veneto", ["Padua"]],
  ["RO", "Rovigo", "Veneto"],
  ["TV", "Treviso", "Veneto"],
  ["VE", "Venezia", "Veneto", ["Venice"]],
  ["VR", "Verona", "Veneto"],
  ["VI", "Vicenza", "Veneto"],
];

const REGION_ALIASES: Record<string, string[]> = {
  Lombardia: ["Lombardy"],
  Piemonte: ["Piedmont"],
  Toscana: ["Tuscany"],
  Puglia: ["Apulia"],
  Sicilia: ["Sicily"],
  Sardegna: ["Sardinia"],
  "Trentino-Alto Adige": ["Trentino Sudtirol", "Trentino"],
  "Valle d'Aosta": ["Vallee d'Aoste", "Aosta Valley"],
  "Friuli-Venezia Giulia": ["Friuli"],
};

const provinceByKey = new Map<string, { code: string; region: string; name: string; regionName: string }>();
const regionByKey = new Map<string, string>();
const regionNames = new Map<string, string>();
for (const [code, name, region, aliases = []] of PROVINCES) {
  const entry = { code, region: fold(region), name, regionName: region };
  for (const key of [code, name, ...aliases]) provinceByKey.set(fold(key), entry);
  regionByKey.set(fold(region), fold(region));
  regionNames.set(fold(region), region);
}
for (const [region, aliases] of Object.entries(REGION_ALIASES)) {
  for (const alias of aliases) regionByKey.set(fold(alias), fold(region));
}

/** Number of Italian provinces known, for the test that holds the table complete. */
export const ITALIAN_PROVINCE_COUNT = PROVINCES.length;

/** Whether a two-letter code is an Italian province sigla, as an invoice address requires. */
export function isItalianProvinceCode(code: string): boolean {
  return PROVINCES.some(([sigla]) => sigla === code.trim().toUpperCase());
}

/**
 * Every key a typed state stands for.
 *
 * `T:` is the text itself, `P:` an Italian province, `R:` an Italian region. A
 * province also stands for its region, so a territory defined as "Lombardia" takes
 * a record typed "MI" — never the other way round, because a region is wider.
 *
 * Italian names are resolved only when the country is Italy or unknown: "CA" is
 * Cagliari on an Italian address and California on an American one.
 */
function recordStateKeys(raw: string, italian: boolean): string[] {
  const folded = fold(raw);
  if (!folded) return [];
  const keys = [`T:${folded}`];
  if (!italian) return keys;
  const province = provinceByKey.get(folded);
  if (province) keys.push(`P:${province.code}`, `R:${province.region}`);
  const region = regionByKey.get(folded);
  if (region) keys.push(`R:${region}`);
  return keys;
}

/**
 * The keys one entry of a territory's list stands for — at its own level only.
 *
 * ⚠️ Not widened to the region like a record's state is: a territory listing "MI"
 * would otherwise take every record typed "Lombardia", Brescia and Bergamo included.
 */
function ruleStateKeys(raw: string, italian: boolean): string[] {
  const folded = fold(raw);
  if (!folded) return [];
  const keys = [`T:${folded}`];
  if (!italian) return keys;
  const province = provinceByKey.get(folded);
  if (province) keys.push(`P:${province.code}`);
  const region = regionByKey.get(folded);
  if (region) keys.push(`R:${region}`);
  return keys;
}

export type StateReading =
  | { kind: "province"; code: string; name: string; region: string }
  | { kind: "region"; name: string }
  | { kind: "text" };

/**
 * How one entry of a territory's list will be read, for the settings screen.
 *
 * ⚠️ Shown next to every entry because a typo is otherwise invisible: "Lombadia" is
 * saved without complaint and matches only records carrying the same typo.
 */
export function readStateEntry(raw: string, italian: boolean): StateReading {
  const folded = fold(raw);
  if (italian) {
    const province = provinceByKey.get(folded);
    if (province) return { kind: "province", code: province.code, name: province.name, region: province.regionName };
    const region = regionByKey.get(folded);
    if (region) return { kind: "region", name: regionNames.get(region) ?? raw };
  }
  return { kind: "text" };
}

/** Every country, named in `locale`, sorted by that name. */
export function countryOptions(locale: string): { code: string; name: string }[] {
  if (!countryCodes) buildCountryIndex();
  const codes = [...(countryCodes ?? [])];
  const names =
    typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([locale], { type: "region", fallback: "code" })
      : null;
  return codes
    .map((code) => ({ code, name: names?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

// ─── Matching ─────────────────────────────────────────────────────────────────

function foldPostal(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** How narrow a territory is. A postal prefix outranks a province, which outranks a country. */
export function specificity(rule: Pick<TerritoryRule, "countries" | "states" | "postalPrefixes">): number {
  return (rule.countries.length ? 1 : 0) + (rule.states.length ? 2 : 0) + (rule.postalPrefixes.length ? 4 : 0);
}

/** Whether a territory with this definition takes a record at this address. */
export function covers(rule: TerritoryRule, place: Located): boolean {
  if (specificity(rule) === 0) return false;
  const country = countryCode(place.country);

  if (rule.countries.length && (!country || !rule.countries.includes(country))) return false;

  if (rule.states.length) {
    if (!place.state) return false;
    const recordKeys = new Set(recordStateKeys(place.state, country === null || country === "IT"));
    const ruleItalian = rule.countries.length === 0 || rule.countries.includes("IT");
    const hit = rule.states.some((s) => ruleStateKeys(s, ruleItalian).some((k) => recordKeys.has(k)));
    if (!hit) return false;
  }

  if (rule.postalPrefixes.length) {
    const zip = place.zipCode ? foldPostal(place.zipCode) : "";
    if (!zip) return false;
    if (!rule.postalPrefixes.some((p) => foldPostal(p) && zip.startsWith(foldPostal(p)))) return false;
  }
  return true;
}

/**
 * The territory a record belongs to: the narrowest one that covers its address.
 *
 * ⚠️ Overlaps are expected — "Nord Italia" and "Milano" both cover a Milan address —
 * and the narrower one wins. Two territories equally narrow resolve by name, so the
 * answer never depends on the order the database happened to return them in.
 */
export function territoryOf<T extends TerritoryRule>(place: Located, rules: readonly T[]): T | null {
  let best: T | null = null;
  for (const rule of rules) {
    if (!covers(rule, place)) continue;
    if (
      !best ||
      specificity(rule) > specificity(best) ||
      (specificity(rule) === specificity(best) &&
        (rule.name.localeCompare(best.name) < 0 || (rule.name === best.name && rule.id < best.id)))
    ) {
      best = rule;
    }
  }
  return best;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface TerritoryInput {
  name: string;
  description?: string | null;
  countries: string[];
  states: string[];
  postalPrefixes: string[];
}

function cleanList(values: readonly string[], limit: number, each: (v: string) => string): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const v = each(raw);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, limit);
}

/**
 * A territory definition as it will be stored, or the reason it cannot be.
 *
 * ⚠️ A territory with no criteria is refused rather than stored: it would cover
 * nothing, and it would sit in the list looking like it covers everything.
 */
export function cleanTerritory(input: TerritoryInput): { ok: true; value: TerritoryInput } | Refusal {
  const name = input.name.trim().slice(0, 80);
  if (!name) return refuse("validation.territories.nameRequired");

  const countries = cleanList(input.countries, 250, (c) => c.trim().toUpperCase());
  const unknown = countries.filter((c) => !isCountryCode(c));
  if (unknown.length) return refuse("validation.territories.countryUnknown", { codes: unknown.join(", ") });

  const states = cleanList(input.states, 200, (s) => s.trim().slice(0, 80));
  const postalPrefixes = cleanList(input.postalPrefixes, 500, (p) => foldPostal(p).slice(0, 12));

  if (specificity({ countries, states, postalPrefixes }) === 0) {
    return refuse("validation.territories.criteriaRequired");
  }
  const description = input.description?.trim().slice(0, 500) || null;
  return { ok: true, value: { name, description, countries, states, postalPrefixes } };
}
