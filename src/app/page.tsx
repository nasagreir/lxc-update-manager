import { redirect } from "next/navigation";
import { AppShell } from "@/components/dashboard/app-shell";
import { isPasswordConfigured } from "@/lib/auth/password";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isPasswordConfigured())) {
    redirect("/login");
  }
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return <AppShell />;
}
