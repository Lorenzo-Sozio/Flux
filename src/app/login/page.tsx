import { redirect } from "next/navigation";

export default function LoginPage() {
  redirect("/auth/v1/login");
}
