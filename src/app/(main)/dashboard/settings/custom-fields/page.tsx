import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getCustomFieldDefinitions } from "@/actions/custom-fields";
import { CustomFieldsClient } from "./_components/custom-fields-client";

export default async function CustomFieldsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (!["admin", "owner"].includes(role)) redirect("/dashboard/crm");

  const fields = await getCustomFieldDefinitions();

  return <CustomFieldsClient fields={fields} currentUserId={session.user.id!} />;
}
