import { LoginForm } from "./login-form"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          {/* Flux Logo */}
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg">
            <svg
              className="w-8 h-8 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* Flux symbol - dynamic flowing lines */}
              <path d="M4 12c0-2.2 1.8-4 4-4s4 1.8 4 4" />
              <path d="M16 12c0 2.2-1.8 4-4 4s-4-1.8-4-4" />
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <path d="M4 12c2.2 0 4 1.8 4 4s-1.8 4-4 4-4-1.8-4-4" />
              <path d="M20 12c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-400 dark:to-blue-500 bg-clip-text text-transparent">
            Flux CRM
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-3 text-sm">
            Accedi al tuo account per continuare
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
