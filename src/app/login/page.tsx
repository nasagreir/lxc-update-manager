import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/auth/login-screen";
import { getUsername, isPasswordConfigured } from "@/lib/auth/password";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const setupRequired = !(await isPasswordConfigured());
  const session = setupRequired ? null : await getSession();
  if (session) {
    redirect("/");
  }
  const username = await getUsername();
  return (
    <LoginScreen
      setupRequired={setupRequired}
      defaultUsername={username}
    />
  );
}
