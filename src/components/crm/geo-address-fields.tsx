"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CheckIcon, ChevronsUpDownIcon, Loader2Icon, MapPinIcon, PlusIcon } from "lucide-react";
import { type Control, Controller, type UseFormSetValue, type UseFormWatch } from "react-hook-form";

import type { GeoCity, GeoCountry } from "@/actions/geo";
import { createCity, findCityBySlug, getCityById } from "@/actions/geo";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ── Field wrapper (mirrors the F() helper in each modal) ─────────────────────

function F({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label>{label}</Label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GeoAddressLabels {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface GeoAddressFieldsProps {
  // react-hook-form bindings (generic <any> form)
  control: Control<any>;
  setValue: UseFormSetValue<any>;
  watch: UseFormWatch<any>;
  errors?: {
    street?: { message?: string };
    city?: { message?: string };
    state?: { message?: string };
    zipCode?: { message?: string };
    country?: { message?: string };
  };
  labels: GeoAddressLabels;
}

// ── Confirm-add-city dialog ───────────────────────────────────────────────────

interface ConfirmAddCityProps {
  cityName: string;
  countryName: string;
  existingCity: GeoCity | null;
  onConfirm: () => Promise<void>;
  onUseExisting: (city: GeoCity) => void;
  onCancel: () => void;
}

function ConfirmAddCityDialog({
  cityName,
  countryName,
  existingCity,
  onConfirm,
  onUseExisting,
  onCancel,
}: ConfirmAddCityProps) {
  const [saving, setSaving] = useState(false);

  if (existingCity) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>City already exists</DialogTitle>
          <DialogDescription>
            <strong>{existingCity.name}</strong> is already registered for {countryName}. Use the existing entry to
            avoid duplicates.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onUseExisting(existingCity);
            }}
          >
            Use &ldquo;{existingCity.name}&rdquo;
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Add new city</DialogTitle>
        <DialogDescription>
          Add <strong>{cityName}</strong> to {countryName}? This city will be shared across all records and visible in
          autocomplete for all users.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={async () => {
            setSaving(true);
            try {
              await onConfirm();
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
        >
          {saving && <Loader2Icon className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Add city
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GeoAddressFields({ control, setValue, watch, errors, labels }: GeoAddressFieldsProps) {
  // ── Form field watchers ───────────────────────────────────────────────────
  const countryId = watch("countryId") as string | null | undefined;
  const cityId = watch("cityId") as string | null | undefined;
  const cityText = watch("city") as string | undefined;

  // ── Countries ─────────────────────────────────────────────────────────────
  const [countries, setCountries] = useState<GeoCountry[]>([]);
  const [countriesLoaded, setCountriesLoaded] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");

  useEffect(() => {
    fetch("/api/geo/countries")
      .then((r) => r.json())
      .then((data: GeoCountry[]) => {
        setCountries(data);
        setCountriesLoaded(true);
      })
      .catch(() => setCountriesLoaded(true));
  }, []);

  const selectedCountry = countries.find((c) => c.id === countryId) ?? null;

  const filteredCountries = countrySearch
    ? countries.filter(
        (c) =>
          c.nameEn.toLowerCase().includes(countrySearch.toLowerCase()) ||
          (c.nameIt ?? "").toLowerCase().includes(countrySearch.toLowerCase()) ||
          c.iso2.toLowerCase().includes(countrySearch.toLowerCase()),
      )
    : countries;

  // ── Cities ────────────────────────────────────────────────────────────────
  const [cities, setCities] = useState<GeoCity[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const cityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedCity = cities.find((c) => c.id === cityId) ?? null;

  const fetchCities = useCallback(
    (q: string) => {
      if (!countryId) return;
      setCityLoading(true);
      fetch(`/api/geo/cities?q=${encodeURIComponent(q)}&country_id=${encodeURIComponent(countryId)}`)
        .then((r) => r.json())
        .then((data: GeoCity[]) => {
          setCities(data);
          setCityLoading(false);
        })
        .catch(() => setCityLoading(false));
    },
    [countryId],
  );

  // On mount: if a cityId is already set (editing existing record), pre-load the city
  // so the button label is correct before the country-triggered list fetch completes
  const initialCityIdRef = useRef(watch("cityId") as string | null | undefined);
  useEffect(() => {
    const id = initialCityIdRef.current;
    if (!id) return;
    getCityById(id).then((city) => {
      if (city) setCities((prev) => (prev.some((c) => c.id === city.id) ? prev : [city, ...prev]));
    });
  }, []);

  // Reset cities when country changes
  useEffect(() => {
    setCities([]);
    setCityQuery("");
    if (countryId) fetchCities("");
  }, [countryId, fetchCities]);

  // Debounced search
  useEffect(() => {
    if (!cityOpen) return;
    if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
    cityDebounceRef.current = setTimeout(() => fetchCities(cityQuery), 250);
    return () => {
      if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
    };
  }, [cityQuery, cityOpen, fetchCities]);

  // ── ZIP code hints from selected city ────────────────────────────────────
  const zipHints = selectedCity?.postalCodes ?? [];

  // ── Add-city dialog ───────────────────────────────────────────────────────
  const [addCityDialogOpen, setAddCityDialogOpen] = useState(false);
  const [pendingCityName, setPendingCityName] = useState("");
  const [existingDuplicate, setExistingDuplicate] = useState<GeoCity | null>(null);

  const handleAddCityClick = async (name: string) => {
    if (!countryId) return;
    setPendingCityName(name);
    // Check for slug collision before showing dialog
    const dupe = await findCityBySlug(countryId, name);
    setExistingDuplicate(dupe);
    setAddCityDialogOpen(true);
  };

  const selectCity = useCallback(
    (city: GeoCity) => {
      setValue("cityId", city.id, { shouldDirty: true });
      setValue("city", city.name, { shouldDirty: true });
      if (city.region) setValue("state", city.region, { shouldDirty: true });
      setCityQuery("");
      setCityOpen(false);
    },
    [setValue],
  );

  const handleConfirmAdd = async () => {
    if (!countryId) return;
    const region = (watch("state") as string) || undefined;
    let newCity: GeoCity;
    try {
      newCity = await createCity(countryId, pendingCityName, region);
    } catch {
      // Race: another user inserted the same city concurrently — fall back to their record
      const existing = await findCityBySlug(countryId, pendingCityName);
      if (existing) {
        handleUseExisting(existing);
        return;
      }
      throw new Error(`Failed to add city "${pendingCityName}". Please try again.`);
    }
    setCities((prev) => {
      const already = prev.find((c) => c.id === newCity.id);
      return already ? prev : [newCity, ...prev];
    });
    selectCity(newCity);
    setAddCityDialogOpen(false);
    setPendingCityName("");
    setExistingDuplicate(null);
  };

  const handleUseExisting = (city: GeoCity) => {
    setCities((prev) => {
      const already = prev.find((c) => c.id === city.id);
      return already ? prev : [city, ...prev];
    });
    selectCity(city);
    setAddCityDialogOpen(false);
    setPendingCityName("");
    setExistingDuplicate(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  // Determine if city query has no match to offer "add" option
  const trimmedQuery = cityQuery.trim();
  const hasExactMatch = cities.some((c) => c.name.toLowerCase() === trimmedQuery.toLowerCase());
  const showAddOption = !!countryId && trimmedQuery.length >= 2 && !hasExactMatch;

  return (
    <>
      {/* Street ── full width */}
      <div className="col-span-2">
        <Controller
          control={control}
          name="street"
          render={({ field }) => (
            <F label={labels.street} error={errors?.street?.message}>
              <Input {...field} value={field.value ?? ""} placeholder="Via Roma 1" />
            </F>
          )}
        />
      </div>

      {/* Country ── combobox */}
      <F label={labels.country} error={errors?.country?.message}>
        <Popover open={countryOpen} onOpenChange={setCountryOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={countryOpen}
              className="w-full justify-between font-normal"
            >
              <span className="truncate">
                {selectedCountry ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{selectedCountry.iso2}</span>
                    {selectedCountry.nameEn}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Select country…</span>
                )}
              </span>
              <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search country…" value={countrySearch} onValueChange={setCountrySearch} />
              <CommandList>
                {!countriesLoaded && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2Icon className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {countriesLoaded && filteredCountries.length === 0 && <CommandEmpty>No country found.</CommandEmpty>}
                {countriesLoaded && filteredCountries.length > 0 && (
                  <CommandGroup>
                    {/* Clear selection */}
                    {countryId && (
                      <CommandItem
                        value=""
                        onSelect={() => {
                          setValue("countryId", null, { shouldDirty: true });
                          setValue("country", "", { shouldDirty: true });
                          setValue("cityId", null, { shouldDirty: true });
                          setValue("city", "", { shouldDirty: true });
                          setCountryOpen(false);
                          setCountrySearch("");
                        }}
                        className="text-muted-foreground italic text-xs"
                      >
                        — Clear selection
                      </CommandItem>
                    )}
                    {filteredCountries.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.nameEn}
                        onSelect={() => {
                          const isNew = c.id !== countryId;
                          setValue("countryId", c.id, { shouldDirty: true });
                          setValue("country", c.nameEn, { shouldDirty: true });
                          if (isNew) {
                            setValue("cityId", null, { shouldDirty: true });
                            setValue("city", "", { shouldDirty: true });
                          }
                          setCountryOpen(false);
                          setCountrySearch("");
                        }}
                      >
                        <span className="w-8 text-xs text-muted-foreground">{c.iso2}</span>
                        {c.nameEn}
                        <CheckIcon
                          className={cn("ml-auto h-4 w-4", countryId === c.id ? "opacity-100" : "opacity-0")}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {/* Hidden inputs keep the text values in sync for form serialization */}
        <Controller
          control={control}
          name="country"
          render={({ field }) => <input type="hidden" {...field} value={field.value ?? ""} />}
        />
        <Controller
          control={control}
          name="countryId"
          render={({ field }) => <input type="hidden" {...field} value={field.value ?? ""} />}
        />
      </F>

      {/* City ── async combobox */}
      <F label={labels.city} error={errors?.city?.message}>
        <Popover open={cityOpen} onOpenChange={setCityOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={cityOpen}
              disabled={!countryId}
              className="w-full justify-between font-normal"
            >
              <span className="truncate">
                {cityId && (selectedCity?.name || cityText) ? (
                  <span className="flex items-center gap-1.5">
                    <MapPinIcon className="w-3 h-3 text-muted-foreground" />
                    {selectedCity?.name || cityText}
                  </span>
                ) : cityText && !cityId ? (
                  <span className="text-muted-foreground italic text-sm">{cityText} (not linked)</span>
                ) : (
                  <span className="text-muted-foreground">{countryId ? "Search city…" : "Select country first"}</span>
                )}
              </span>
              <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Search city…" value={cityQuery} onValueChange={setCityQuery} />
              <CommandList>
                {cityLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2Icon className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!cityLoading && cities.length === 0 && !showAddOption && (
                  <CommandEmpty>
                    {cityQuery.length >= 2 ? "No cities found. Type to add a new one." : "Type to search cities."}
                  </CommandEmpty>
                )}
                {!cityLoading && (cities.length > 0 || showAddOption) && (
                  <CommandGroup>
                    {/* Clear selection */}
                    {cityId && (
                      <CommandItem
                        value=""
                        onSelect={() => {
                          setValue("cityId", null, { shouldDirty: true });
                          setValue("city", "", { shouldDirty: true });
                          setCityOpen(false);
                          setCityQuery("");
                        }}
                        className="text-muted-foreground italic text-xs"
                      >
                        — Clear selection
                      </CommandItem>
                    )}
                    {cities.map((c) => (
                      <CommandItem key={c.id} value={c.name} onSelect={() => selectCity(c)}>
                        {c.name}
                        {c.region && <span className="ml-1.5 text-xs text-muted-foreground">{c.region}</span>}
                        <CheckIcon className={cn("ml-auto h-4 w-4", cityId === c.id ? "opacity-100" : "opacity-0")} />
                      </CommandItem>
                    ))}
                    {showAddOption && (
                      <CommandItem
                        value={`__add__${trimmedQuery}`}
                        onSelect={() => {
                          setCityOpen(false);
                          handleAddCityClick(trimmedQuery);
                        }}
                        className="text-primary font-medium"
                      >
                        <PlusIcon className="w-3.5 h-3.5 mr-1.5" />
                        Add &ldquo;{trimmedQuery}&rdquo;
                      </CommandItem>
                    )}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Controller
          control={control}
          name="city"
          render={({ field }) => <input type="hidden" {...field} value={field.value ?? ""} />}
        />
        <Controller
          control={control}
          name="cityId"
          render={({ field }) => <input type="hidden" {...field} value={field.value ?? ""} />}
        />
      </F>

      {/* State / Province */}
      <Controller
        control={control}
        name="state"
        render={({ field }) => (
          <F label={labels.state} error={errors?.state?.message}>
            <Input {...field} value={field.value ?? ""} placeholder="MI" />
          </F>
        )}
      />

      {/* ZIP code with hints */}
      <Controller
        control={control}
        name="zipCode"
        render={({ field }) => (
          <F label={labels.zipCode} error={errors?.zipCode?.message}>
            <Input {...field} value={field.value ?? ""} placeholder={zipHints[0] ?? "20100"} list="zip-hints" />
            {zipHints.length > 0 && (
              <datalist id="zip-hints">
                {zipHints.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            )}
          </F>
        )}
      />

      {/* Confirm-add-city dialog */}
      <Dialog open={addCityDialogOpen} onOpenChange={setAddCityDialogOpen}>
        <ConfirmAddCityDialog
          cityName={pendingCityName}
          countryName={selectedCountry?.nameEn ?? ""}
          existingCity={existingDuplicate}
          onConfirm={handleConfirmAdd}
          onUseExisting={handleUseExisting}
          onCancel={() => {
            setAddCityDialogOpen(false);
            setPendingCityName("");
            setExistingDuplicate(null);
          }}
        />
      </Dialog>
    </>
  );
}
