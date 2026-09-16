"use client";

import { useCallback } from "react";

import { useTranslations } from "next-intl";

import { type MessageSource, type MessageTranslator, messageText } from "@/lib/i18n-message";

/**
 * Translates a validation message on its way to the screen.
 *
 *   const say = useMessageText();
 *   toast.error(say(result));            // { error, params } from an action
 *   <p>{say(errors.name?.message)}</p>   // a key written by a Zod schema
 *
 * A string that is not a `validation.*` key is returned unchanged.
 */
export function useMessageText() {
  const t = useTranslations() as unknown as MessageTranslator;
  return useCallback((source: MessageSource, fallback?: string) => messageText(t, source, fallback), [t]);
}
