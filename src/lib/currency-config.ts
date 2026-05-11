// Maps next-intl locale codes to default display currencies.
// Users can override this manually via the CurrencySwitcher.
export const LOCALE_TO_CURRENCY: Record<string, string> = {
  en: "USD",
  it: "EUR",
  de: "EUR",
  fr: "EUR",
  es: "EUR",
  pt: "EUR",
  ja: "JPY",
  zh: "CNY",
  ko: "KRW",
  ru: "RUB",
  ar: "AED",
};

// Best locale for formatting each currency (controls decimal separator, grouping, etc.)
export const CURRENCY_LOCALE: Record<string, string> = {
  EUR: "it-IT",
  USD: "en-US",
  GBP: "en-GB",
  JPY: "ja-JP",
  CHF: "de-CH",
  CAD: "en-CA",
  AUD: "en-AU",
  CNY: "zh-CN",
  KRW: "ko-KR",
  RUB: "ru-RU",
  BRL: "pt-BR",
  MXN: "es-MX",
  INR: "en-IN",
  SEK: "sv-SE",
  NOK: "nb-NO",
  DKK: "da-DK",
  PLN: "pl-PL",
  CZK: "cs-CZ",
  HUF: "hu-HU",
  RON: "ro-RO",
  AED: "ar-AE",
  SGD: "en-SG",
  HKD: "zh-HK",
  NZD: "en-NZ",
  ZAR: "en-ZA",
};

export interface CurrencyMeta {
  code: string;
  symbol: string;
  name: string;
  nameIt: string;
}

export const SUPPORTED_CURRENCIES: CurrencyMeta[] = [
  { code: "EUR", symbol: "€", name: "Euro", nameIt: "Euro" },
  { code: "USD", symbol: "$", name: "US Dollar", nameIt: "Dollaro USA" },
  { code: "GBP", symbol: "£", name: "British Pound", nameIt: "Sterlina" },
  { code: "CHF", symbol: "Fr", name: "Swiss Franc", nameIt: "Franco svizzero" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen", nameIt: "Yen giapponese" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar", nameIt: "Dollaro canadese" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar", nameIt: "Dollaro australiano" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan", nameIt: "Yuan cinese" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona", nameIt: "Corona svedese" },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone", nameIt: "Corona norvegese" },
  { code: "DKK", symbol: "kr", name: "Danish Krone", nameIt: "Corona danese" },
  { code: "PLN", symbol: "zł", name: "Polish Zloty", nameIt: "Zloty polacco" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real", nameIt: "Real brasiliano" },
  { code: "INR", symbol: "₹", name: "Indian Rupee", nameIt: "Rupia indiana" },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham", nameIt: "Dirham degli EAU" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", nameIt: "Dollaro di Singapore" },
];

export const BASE_CURRENCY = "EUR";
export const RATES_CACHE_DURATION_HOURS = 6;
export const CURRENCY_PREFERENCE_KEY = "flux_currency";
export const CURRENCY_MANUAL_OVERRIDE_KEY = "flux_currency_manual";
