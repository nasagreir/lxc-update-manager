"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppSettings } from "@/lib/types";

type SettingsForm = AppSettings & { hasApiTokenSecret?: boolean };

const empty: SettingsForm = {
  mockMode: true,
  proxmoxHost: "",
  proxmoxPort: 8006,
  proxmoxVerifyTls: false,
  apiTokenId: "",
  apiTokenSecret: "",
  defaultNode: "",
  includeNodes: "",
  execMode: "ssh",
  sshHost: "",
  sshPort: 22,
  sshUser: "root",
  sshPrivateKeyPath: "/root/.ssh/id_ed25519",
  nodeSshHosts: "",
  updateTimeoutSeconds: 1800,
  communityScriptAnswers: "y\ny\ny\ny\ny\ny\ny\ny\n",
};

export function SettingsPanel({ onSaved }: { onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<SettingsForm>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        setForm({ ...empty, ...data.settings });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function set<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setForm({ ...empty, ...data.settings });
      setMessage("Settings saved.");
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 justify-center text-muted-foreground">
        <Loader2 className="animate-spin" />
        Loading settings…
      </div>
    );
  }

  return (
    <div className="animate-fade-up mx-auto max-w-2xl space-y-8">
      <section className="space-y-4 rounded-lg border border-border/80 bg-card/80 p-5 shadow-sm">
        <div>
          <h3 className="font-semibold">Mode</h3>
          <p className="text-sm text-muted-foreground">
            Mock mode uses sample containers and simulated updates so you can
            try the UI without Proxmox. Turn it off when this LXC can reach your
            node.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={form.mockMode}
            onCheckedChange={(v) => set("mockMode", v)}
            id="mock"
          />
          <Label htmlFor="mock">Mock mode</Label>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/80 bg-card/80 p-5 shadow-sm">
        <div>
          <h3 className="font-semibold">Proxmox API</h3>
          <p className="text-sm text-muted-foreground">
            Used to list LXC containers. Create an API token in Datacenter →
            Permissions → API Tokens.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="host">Host</Label>
            <Input
              id="host"
              value={form.proxmoxHost}
              onChange={(e) => set("proxmoxHost", e.target.value)}
              placeholder="192.168.1.10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="port">Port</Label>
            <Input
              id="port"
              type="number"
              value={form.proxmoxPort}
              onChange={(e) => set("proxmoxPort", Number(e.target.value))}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="include-nodes">Nodes to include</Label>
            <Input
              id="include-nodes"
              value={form.includeNodes}
              onChange={(e) => set("includeNodes", e.target.value)}
              placeholder="Leave empty for all nodes, or: pve1, pve2"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Multi-node clusters: leave blank to scan every node, or list node
              names separated by commas.
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="token-id">API token ID</Label>
            <Input
              id="token-id"
              value={form.apiTokenId}
              onChange={(e) => set("apiTokenId", e.target.value)}
              placeholder="root@pam!lxc-updater"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="token-secret">API token secret</Label>
            <Input
              id="token-secret"
              type="password"
              value={form.apiTokenSecret}
              onChange={(e) => set("apiTokenSecret", e.target.value)}
              placeholder={
                form.hasApiTokenSecret
                  ? "Leave masked value to keep existing secret"
                  : "Paste token secret"
              }
              className="font-mono text-sm"
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              checked={form.proxmoxVerifyTls}
              onCheckedChange={(v) => set("proxmoxVerifyTls", v)}
              id="tls"
            />
            <Label htmlFor="tls">Verify TLS certificate</Label>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/80 bg-card/80 p-5 shadow-sm">
        <div>
          <h3 className="font-semibold">Command execution</h3>
          <p className="text-sm text-muted-foreground">
            Updates run via <code className="font-mono text-xs">pct exec</code>{" "}
            on the CT&apos;s Proxmox node. For multi-node clusters, map each node
            to an SSH address below — <code className="font-mono text-xs">pct</code>{" "}
            only works on the node that owns the container.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Exec mode</Label>
          <Select
            value={form.execMode}
            onValueChange={(v) => set("execMode", v as "ssh" | "local")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ssh">SSH to each CT&apos;s node → pct exec</SelectItem>
              <SelectItem value="local">Local pct (same-node CTs only)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.execMode === "ssh" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ssh-host">Fallback SSH host</Label>
              <Input
                id="ssh-host"
                value={form.sshHost}
                onChange={(e) => set("sshHost", e.target.value)}
                placeholder="Used when a node has no mapping"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ssh-port">SSH port</Label>
              <Input
                id="ssh-port"
                type="number"
                value={form.sshPort}
                onChange={(e) => set("sshPort", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ssh-user">SSH user</Label>
              <Input
                id="ssh-user"
                value={form.sshUser}
                onChange={(e) => set("sshUser", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ssh-key">Private key path</Label>
              <Input
                id="ssh-key"
                value={form.sshPrivateKeyPath}
                onChange={(e) => set("sshPrivateKeyPath", e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="node-ssh">Per-node SSH hosts</Label>
              <Textarea
                id="node-ssh"
                value={form.nodeSshHosts}
                onChange={(e) => set("nodeSshHosts", e.target.value)}
                rows={4}
                className="font-mono text-sm"
                placeholder={"pve1=192.168.1.10\npve2=192.168.1.11\npve3=192.168.1.12"}
              />
              <p className="text-xs text-muted-foreground">
                One <code className="font-mono">nodename=host</code> per line.
                Required when containers live on more than one node.
              </p>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="timeout">Update timeout (seconds)</Label>
          <Input
            id="timeout"
            type="number"
            value={form.updateTimeoutSeconds}
            onChange={(e) =>
              set("updateTimeoutSeconds", Number(e.target.value))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="answers">
            Community script prompt answers
          </Label>
          <Textarea
            id="answers"
            value={form.communityScriptAnswers}
            onChange={(e) => set("communityScriptAnswers", e.target.value)}
            rows={4}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Helper-script <code className="font-mono">update</code> is
            interactive. These newline-separated answers (usually{" "}
            <code className="font-mono">y</code>) are piped on stdin so
            automations can run unattended.
          </p>
        </div>
      </section>

      {message && (
        <p className="text-sm text-emerald-800 dark:text-emerald-400">{message}</p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}

      <Button onClick={() => void save()} disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : <Save />}
        Save settings
      </Button>
    </div>
  );
}
