"use client";

import { useMemo, useState } from "react";

import { MapPin, Pencil, Plus, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { createTerritory, deleteTerritory, type Territory, updateTerritory } from "@/actions/territories";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { countryCode, countryOptions, readStateEntry, territoryOf } from "@/lib/territory";

interface Form {
  name: string;
  description: string;
  countries: string[];
  states: string;
  postalPrefixes: string;
}

const EMPTY: Form = { name: "", description: "", countries: [], states: "", postalPrefixes: "" };

const lines = (text: string) =>
  text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function TerritoriesClient({ initial }: { initial: Territory[] }) {
  const t = useTranslations("settings.territories");
  const locale = useLocale();
  const [items, setItems] = useState<Territory[]>(initial);
  const [editing, setEditing] = useState<Territory | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [probe, setProbe] = useState({ country: "", state: "", zipCode: "" });

  const countries = useMemo(() => countryOptions(locale), [locale]);
  const countryName = useMemo(() => new Map(countries.map((c) => [c.code, c.name])), [countries]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (territory: Territory) => {
    setEditing(territory);
    setForm({
      name: territory.name,
      description: territory.description ?? "",
      countries: territory.countries,
      states: territory.states.join("\n"),
      postalPrefixes: territory.postalPrefixes.join("\n"),
    });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const input = {
        name: form.name,
        description: form.description,
        countries: form.countries,
        states: lines(form.states),
        postalPrefixes: lines(form.postalPrefixes),
      };
      const result = editing ? await updateTerritory(editing.id, input) : await createTerritory(input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setItems((prev) =>
        [...prev.filter((p) => p.id !== result.territory.id), result.territory].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      toast.success(t("saved"));
      setOpen(false);
    } catch {
      toast.error(t("failed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await deleteTerritory(deleteId);
      setItems((prev) => prev.filter((p) => p.id !== deleteId));
      toast.success(t("deleted"));
    } catch {
      toast.error(t("failed"));
    } finally {
      setDeleteId(null);
    }
  };

  // Read the way the matcher will read them, so a typo shows before it is saved.
  const italian = form.countries.length === 0 || form.countries.includes("IT");
  const stateReadings = lines(form.states).map((entry) => ({ entry, reading: readStateEntry(entry, italian) }));

  const probeTerritory = territoryOf(probe, items);
  const probeCountryUnknown = probe.country.trim() !== "" && countryCode(probe.country) === null;
  const probeTouched = Boolean(probe.country || probe.state || probe.zipCode);

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("newTerritory")}
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground text-sm">{t("empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((territory) => (
            <Card key={territory.id}>
              <CardContent className="flex items-start gap-4 p-4">
                <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="font-semibold text-sm">{territory.name}</p>
                  {territory.description && <p className="text-muted-foreground text-xs">{territory.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {territory.countries.length === 0 ? (
                      <Badge variant="outline" className="text-[11px]">
                        {t("anyCountry")}
                      </Badge>
                    ) : (
                      territory.countries.map((c) => (
                        <Badge key={c} variant="secondary" className="text-[11px]">
                          {countryName.get(c) ?? c}
                        </Badge>
                      ))
                    )}
                    {territory.states.map((s) => (
                      <Badge key={`s-${s}`} variant="outline" className="text-[11px]">
                        {s}
                      </Badge>
                    ))}
                    {territory.postalPrefixes.map((p) => (
                      <Badge key={`p-${p}`} variant="outline" className="font-mono text-[11px]">
                        {p}…
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(territory)}
                    aria-label={t("editTerritory")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleteId(territory.id)}
                    aria-label={t("delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div>
              <p className="font-semibold text-sm">{t("tryTitle")}</p>
              <p className="text-muted-foreground text-xs">{t("tryHint")}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="probe-country">{t("tryCountry")}</Label>
                <Input
                  id="probe-country"
                  className="mt-1.5"
                  placeholder="Italia"
                  value={probe.country}
                  onChange={(e) => setProbe((p) => ({ ...p, country: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="probe-state">{t("tryState")}</Label>
                <Input
                  id="probe-state"
                  className="mt-1.5"
                  placeholder="MI"
                  value={probe.state}
                  onChange={(e) => setProbe((p) => ({ ...p, state: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="probe-zip">{t("tryZip")}</Label>
                <Input
                  id="probe-zip"
                  className="mt-1.5"
                  placeholder="20121"
                  value={probe.zipCode}
                  onChange={(e) => setProbe((p) => ({ ...p, zipCode: e.target.value }))}
                />
              </div>
            </div>
            {probeTouched && (
              <div className="space-y-1 text-sm">
                {probeCountryUnknown && (
                  <p className="text-amber-600 text-xs dark:text-amber-400">
                    {t("tryUnknownCountry", { country: probe.country })}
                  </p>
                )}
                <p className={probeTerritory ? "font-medium" : "text-muted-foreground"}>
                  {probeTerritory ? t("tryResult", { name: probeTerritory.name }) : t("tryNone")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("editTerritory") : t("newTerritory")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="territory-name">{t("nameLabel")}</Label>
              <Input
                id="territory-name"
                className="mt-1.5"
                value={form.name}
                placeholder={t("namePlaceholder")}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="territory-description">{t("descriptionLabel")}</Label>
              <Input
                id="territory-description"
                className="mt-1.5"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("countriesLabel")}</Label>
              <SearchableSelect
                options={countries
                  .filter((c) => !form.countries.includes(c.code))
                  .map((c) => ({ value: c.code, label: c.name, sublabel: c.code }))}
                value=""
                onChange={(code) =>
                  code && setForm((f) => ({ ...f, countries: [...f.countries.filter((c) => c !== code), code] }))
                }
                placeholder={t("addCountry")}
                searchPlaceholder={t("searchCountry")}
                emptyText={t("noCountry")}
              />
              {form.countries.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {form.countries.map((code) => (
                    <Badge key={code} variant="secondary" className="gap-1 pr-1">
                      {countryName.get(code) ?? code}
                      <button
                        type="button"
                        className="rounded-sm p-0.5 hover:bg-background/60"
                        aria-label={`${t("delete")} ${countryName.get(code) ?? code}`}
                        onClick={() => setForm((f) => ({ ...f, countries: f.countries.filter((c) => c !== code) }))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">{t("countriesHint")}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="territory-states">{t("statesLabel")}</Label>
              <Textarea
                id="territory-states"
                rows={4}
                value={form.states}
                placeholder={"Lombardia\nTO"}
                onChange={(e) => setForm((f) => ({ ...f, states: e.target.value }))}
              />
              <p className="text-muted-foreground text-xs">{t("statesHint")}</p>
              {stateReadings.length > 0 && (
                <ul className="space-y-0.5 text-xs">
                  {stateReadings.map(({ entry, reading }) => (
                    <li key={entry} className="flex min-w-0 gap-2">
                      <span className="font-medium">{entry}</span>
                      <span
                        className={
                          reading.kind === "text" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                        }
                      >
                        {reading.kind === "province"
                          ? t("readProvince", { name: reading.name, region: reading.region })
                          : reading.kind === "region"
                            ? t("readRegion")
                            : t("readText")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="territory-postal">{t("postalLabel")}</Label>
              <Textarea
                id="territory-postal"
                rows={2}
                value={form.postalPrefixes}
                placeholder="201, 202"
                onChange={(e) => setForm((f) => ({ ...f, postalPrefixes: e.target.value }))}
              />
              <p className="text-muted-foreground text-xs">{t("postalHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
