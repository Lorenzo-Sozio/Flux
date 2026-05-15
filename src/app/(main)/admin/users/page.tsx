import { auth } from "@/auth";
import { listPlatformUsers } from "@/actions/platform-users";
import { PlatformUsersClient } from "./_components/platform-users-client";
import { Users } from "lucide-react";

export const metadata = { title: "Admin — Utenti piattaforma" };

export default async function PlatformUsersPage() {
  const session = await auth();
  const users = await listPlatformUsers();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Utenti piattaforma</h2>
          </div>
          <p className="text-sm text-gray-500">
            Gestisci i ruoli degli utenti sulla piattaforma principale.
            Solo <strong>owner</strong> e <strong>admin</strong> possono accedere al pannello di amministrazione.
          </p>
        </div>
        <div className="text-sm text-gray-400">{users.length} utenti totali</div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <strong>Nota:</strong> Gli utenti con metodo auth solo Google non hanno una password e devono
        usare il codice OTP via email per accedere al pannello admin. Per assegnare il metodo
        password, l'utente deve impostarne una dal proprio profilo.
      </div>

      <PlatformUsersClient
        users={users}
        currentUserId={session!.user.id as string}
      />
    </div>
  );
}
