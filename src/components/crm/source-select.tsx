"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "next-intl";

import { getRecordSources } from "@/actions/record-sources";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type RecordSource, sourceChoices, sourceLabel } from "@/lib/record-sources";

/**
 * The workspace's sources, read once per page load and shared by every form on it.
 *
 * ⚠️ Kept for the life of the page, not of one form: the lead list mounts a form per row
 * pressed, and each would have asked again. Settings drops it after a change
 * (`forgetRecordSources`), so the next form opened reads the new list.
 */
let loaded: Promise<RecordSource[]> | null = null;

export function forgetRecordSources() {
  loaded = null;
}

export function useRecordSources(): RecordSource[] {
  const [sources, setSources] = useState<RecordSource[]>([]);
  useEffect(() => {
    let live = true;
    loaded ??= getRecordSources().catch(() => {
      loaded = null;
      return [];
    });
    loaded.then((s) => {
      if (live) setSources(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return sources;
}

/** The label of a stored value, in the reader's language unless the workspace renamed it. */
export function useSourceLabel(): (value: string | null | undefined) => string | null {
  const sources = useRecordSources();
  const t = useTranslations("common.sources");
  return (value) => sourceLabel(value, sources, (key) => t(key));
}

/**
 * Where a customer came from, picked from the workspace's list (Settings → Lists).
 * A retired source, or a value nobody listed, is still shown when the record carries it.
 */
export function SourceSelect({
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const t = useTranslations("common.sources");
  const sources = useRecordSources();
  const label = (key: string) => sourceLabel(key, sources, (k) => t(k)) ?? key;
  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {sourceChoices(sources, value).map((s) => (
          <SelectItem key={s.key} value={s.key}>
            {label(s.key)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
