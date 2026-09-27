"use client";

import { useTranslations } from "next-intl";
import {
  type Control,
  Controller,
  type FieldValues,
  type Path,
  type UseFormSetValue,
  type UseFormWatch,
} from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// -- Field wrapper (mirrors the F() helper in each modal) ---------------------

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

// -- Types ---------------------------------------------------------------------

export interface GeoAddressLabels {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

/** The address fields a form must have for this component to draw them. */
type AddressField = "street" | "city" | "state" | "zipCode" | "country";

/**
 * Generic over the form it is placed in, rather than typed `Control<any>`.
 * react-hook-form 7.88 stopped accepting a specific form's `Control` where
 * `Control<any>` is declared, and the generic keeps each modal's own field types.
 */
export interface GeoAddressFieldsProps<T extends FieldValues> {
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  watch: UseFormWatch<T>;
  errors?: {
    street?: { message?: string };
    city?: { message?: string };
    state?: { message?: string };
    zipCode?: { message?: string };
    country?: { message?: string };
  };
  labels: GeoAddressLabels;
}

export function GeoAddressFields<T extends FieldValues>({ control, errors, labels }: GeoAddressFieldsProps<T>) {
  // Each modal declares these five fields; the names are checked there, by the schema.
  const name = (field: AddressField) => field as Path<T>;
  const t = useTranslations("geoAddress");

  return (
    <>
      {/* Street -- full width. ⚠️ `sm:` like the grid it sits in: every caller's
          grid is one column below sm, and a span of two there makes the browser
          invent a second column and squeeze the rest of the fields into it. */}
      <div className="sm:col-span-2">
        <Controller
          control={control}
          name={name("street")}
          render={({ field }) => (
            <F label={labels.street} error={errors?.street?.message}>
              <Input {...field} value={field.value ?? ""} placeholder={t("streetPlaceholder")} />
            </F>
          )}
        />
      </div>

      {/* Country */}
      <div>
        <Controller
          control={control}
          name={name("country")}
          render={({ field }) => (
            <F label={labels.country} error={errors?.country?.message}>
              <Input {...field} value={field.value ?? ""} placeholder={t("countryPlaceholder")} />
            </F>
          )}
        />
      </div>

      {/* City */}
      <div>
        <Controller
          control={control}
          name={name("city")}
          render={({ field }) => (
            <F label={labels.city} error={errors?.city?.message}>
              <Input {...field} value={field.value ?? ""} placeholder={t("cityPlaceholder")} />
            </F>
          )}
        />
      </div>

      {/* State / Province */}
      <div>
        <Controller
          control={control}
          name={name("state")}
          render={({ field }) => (
            <F label={labels.state} error={errors?.state?.message}>
              <Input {...field} value={field.value ?? ""} placeholder="MI" />
            </F>
          )}
        />
      </div>

      {/* ZIP code */}
      <div>
        <Controller
          control={control}
          name={name("zipCode")}
          render={({ field }) => (
            <F label={labels.zipCode} error={errors?.zipCode?.message}>
              <Input {...field} value={field.value ?? ""} placeholder="20100" />
            </F>
          )}
        />
      </div>
    </>
  );
}
