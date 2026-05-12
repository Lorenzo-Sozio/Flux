"use client";

import { useEffect } from "react";

import { type Control, Controller, type UseFormSetValue, type UseFormWatch } from "react-hook-form";

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

export function GeoAddressFields({ control, setValue, watch, errors, labels }: GeoAddressFieldsProps) {
  useEffect(() => {}, [setValue, watch]);

  return (
    <>
      {/* Street -- full width */}
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

      {/* Country */}
      <div>
        <Controller
          control={control}
          name="country"
          render={({ field }) => (
            <F label={labels.country} error={errors?.country?.message}>
              <Input {...field} value={field.value ?? ""} placeholder="Italy" />
            </F>
          )}
        />
      </div>

      {/* City */}
      <div>
        <Controller
          control={control}
          name="city"
          render={({ field }) => (
            <F label={labels.city} error={errors?.city?.message}>
              <Input {...field} value={field.value ?? ""} placeholder="Milan" />
            </F>
          )}
        />
      </div>

      {/* State / Province */}
      <div>
        <Controller
          control={control}
          name="state"
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
          name="zipCode"
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
