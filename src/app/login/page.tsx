import { LoginForm } from "./login-form"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Flux CRM</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2">Accedi al tuo account per continuare</p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
