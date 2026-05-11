"use client";

import { useEffect } from "react";

export default function TenantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[TenantError]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 py-24">
      <div className="mx-auto max-w-2xl rounded-3xl border border-rose-200 bg-white p-10 text-center shadow-lg">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-rose-500">
          Error
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-900">
          Something went wrong
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          {error.message || "An unexpected error occurred loading the tenant page."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-slate-400">
            Digest: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-8 inline-flex rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
