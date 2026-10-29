"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants";

export function LoginScreen({ setupRequired }: { setupRequired: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (setupRequired) {
        if (password.length < MIN_PASSWORD_LENGTH) {
          throw new Error(
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
          );
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match");
        }
        const res = await fetch("/api/auth/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, confirmPassword }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not set password");
      } else {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Login failed");
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_oklch(0.72_0.06_210_/_0.35),_transparent_55%),linear-gradient(180deg,_var(--background),_oklch(0.96_0.02_210))] dark:bg-[radial-gradient(ellipse_at_top,_oklch(0.35_0.05_210_/_0.45),_transparent_55%),linear-gradient(180deg,_var(--background),_oklch(0.16_0.02_240))]"
      />
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-8 text-center">
            <p className="font-mono text-xs tracking-[0.2em] text-primary/80 uppercase">
              Proxmox · LXC
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              LXC Updater
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {setupRequired
                ? "Create an admin password to protect the web UI."
                : "Sign in to manage container and host updates."}
            </p>
          </div>

          <form
            onSubmit={onSubmit}
            className="rounded-xl border border-border/70 bg-card/85 p-6 shadow-sm backdrop-blur-sm"
          >
            <div className="mb-5 flex items-center gap-2 text-sm font-medium text-foreground">
              <LockKeyhole className="size-4 text-primary" />
              {setupRequired ? "Set password" : "Sign in"}
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">
                  {setupRequired ? "New password" : "Password"}
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={
                    setupRequired ? "new-password" : "current-password"
                  }
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={setupRequired ? MIN_PASSWORD_LENGTH : 1}
                />
              </div>

              {setupRequired && (
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                  />
                </div>
              )}

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {setupRequired ? "Saving…" : "Signing in…"}
                  </>
                ) : setupRequired ? (
                  "Create password"
                ) : (
                  "Sign in"
                )}
              </Button>
            </div>

            <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
              Forgot the password? On the LXC console run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
                lxc-updater-passwd --reset
              </code>
              .
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
