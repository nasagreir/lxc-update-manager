"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/format";

type SafeKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<SafeKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Grok bot");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/keys");
    const data = await res.json();
    if (res.ok) setKeys(data.keys);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createKey() {
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "API key" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create key");
      setSecret(data.secret);
      setName("Grok bot");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    await load();
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 justify-center text-muted-foreground">
        <Loader2 className="animate-spin" />
        Loading API keys…
      </div>
    );
  }

  return (
    <div className="animate-fade-up mx-auto max-w-2xl space-y-6">
      <section className="space-y-3 rounded-lg border border-border/80 bg-card/80 p-5 shadow-sm">
        <div>
          <h3 className="font-semibold">API keys for bots</h3>
          <p className="text-sm text-muted-foreground">
            Create a key for Grok (or any client) to call{" "}
            <code className="font-mono text-xs">/api/v1/*</code> with{" "}
            <code className="font-mono text-xs">Authorization: Bearer lxcu_…</code>
            . The secret is shown only once.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="key-name">Key name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grok bot"
            />
          </div>
          <Button disabled={busy} onClick={() => void createKey()}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            Create key
          </Button>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {secret && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/15 p-3">
            <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
              Copy this key now — it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-card/80 px-2 py-1 font-mono text-xs">
                {secret}
              </code>
              <Button size="sm" variant="secondary" onClick={() => void copySecret()}>
                <Copy />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        {keys.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
            No API keys yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex flex-col gap-2 rounded-lg border bg-card/80 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <KeyRound className="size-4 text-muted-foreground" />
                    <span className="font-medium">{k.name}</span>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {k.prefix}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Created {formatRelative(k.createdAt)}
                    {" · "}
                    Last used {formatRelative(k.lastUsedAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void revoke(k.id)}
                >
                  <Trash2 />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border/80 bg-card/80 p-5 text-sm text-muted-foreground shadow-sm">
        <p className="font-medium text-foreground">Example (Grok / curl)</p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-emerald-100/90">
{`curl -s http://HOST:3847/api/v1/status \\
  -H "Authorization: Bearer lxcu_…"

curl -s -X POST http://HOST:3847/api/v1/containers/check \\
  -H "Authorization: Bearer lxcu_…"

curl -s -X POST http://HOST:3847/api/v1/updates \\
  -H "Authorization: Bearer lxcu_…" \\
  -H "Content-Type: application/json" \\
  -d '{"allAvailable":true}'`}
        </pre>
      </section>
    </div>
  );
}
