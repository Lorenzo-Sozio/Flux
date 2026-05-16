import type { Metadata } from "next";

import { AdminLoginForm } from "./_components/admin-login-form";

export const metadata: Metadata = { title: "Flux CRM — Pannello Admin" };

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 p-4 dark:from-zinc-950 dark:to-zinc-900">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
            <svg
              aria-hidden="true"
              className="h-8 w-8 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12c0-2.2 1.8-4 4-4s4 1.8 4 4" />
              <path d="M16 12c0 2.2-1.8 4-4 4s-4-1.8-4-4" />
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <path d="M4 12c2.2 0 4 1.8 4 4s-1.8 4-4 4-4-1.8-4-4" />
              <path d="M20 12c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4" />
            </svg>
          </div>

          <h1 className="bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text font-bold text-3xl text-transparent dark:from-blue-400 dark:to-blue-500">
            Flux CRM
          </h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Verifica la tua identità per accedere al pannello admin
          </p>
        </div>

        <AdminLoginForm />
      </div>
    </div>
  );
}
