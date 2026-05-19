import { ShieldCheck, Users } from "lucide-react";

import { listPlatformUsers } from "@/actions/platform-users";
import { getAdminSession } from "@/lib/admin-session";

import { PlatformUsersClient } from "./_components/platform-users-client";

export const metadata = { title: "Admin — Utenti piattaforma" };

export default async function PlatformUsersPage() {
  const adminSession = await getAdminSession();
  const users = await listPlatformUsers();

  const adminCount = users.filter((u) => u.role === "admin" || u.role === "owner").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-500" />
            <h2 className="font-semibold text-gray-900 text-lg">Utenti piattaforma</h2>
          </div>
          <p className="text-gray-500 text-sm">
            Gestisci i ruoli degli utenti sulla piattaforma principale. Solo <strong>owner</strong> e{" "}
            <strong>admin</strong> possono accedere al pannello di amministrazione. Gli utenti con ruolo{" "}
            <strong>utente</strong> accedono solo al CRM dei propri tenant.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-4 w-4" />
            {adminCount} con accesso admin
          </span>
          <span>{users.length} totali</span>
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800 text-sm">
        <strong>Nota:</strong> Gli utenti con metodo auth solo Google non hanno una password e devono usare il codice
        OTP via email per accedere al pannello admin. Solo gli <strong>owner</strong> possono promuovere altri utenti a
        owner o modificare il ruolo di un owner esistente.
      </div>

      <PlatformUsersClient
        users={users}
        currentUserId={adminSession?.userId ?? ""}
        currentUserRole={adminSession?.role ?? "admin"}
      />
    </div>
  );
}
