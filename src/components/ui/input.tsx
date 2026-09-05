import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, inputMode, step, ...props }: React.ComponentProps<"input">) {
  // A number field on a phone opens whichever keyboard the browser guesses at,
  // and on iOS that guess has no decimal point on several locales — so a price
  // cannot be typed. `inputMode` is what actually chooses the keypad. Integer
  // fields (no step, or a whole-number step) get the digits-only pad; anything
  // that can carry cents gets the one with a separator on it.
  const numericMode =
    type === "number" ? (step === undefined || Number(step) % 1 === 0 ? "numeric" : "decimal") : undefined;

  return (
    <input
      type={type}
      step={step}
      inputMode={inputMode ?? numericMode}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
