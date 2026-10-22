import React, { useState } from "react";
import { Copy, ExternalLink, Check } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const base = () => (process.env.REACT_APP_APPLY_BASE_URL || window.location.origin).replace(/\/+$/, "");

// Owner-only editor for a client's public application link (/<slug>/apply).
export function ClientApplyLink({ client, onSaved }) {
  const [slug, setSlug] = useState(client.slug || "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = `${base()}/${client.slug}/apply`;
  const dirty = slug.trim().toLowerCase() !== (client.slug || "");

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/platform/tenants/${client.id}`, { slug });
      setSlug(data.slug);
      onSaved?.(data);
      toast.success("Application link updated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update link");
    } finally { setSaving(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast.error("Copy failed"); }
  };

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-5 space-y-3 text-sm" data-testid="client-apply-link">
      <div>
        <p className="font-display font-semibold text-base">Public application link</p>
        <p className="text-muted-foreground text-xs mt-0.5">Students who apply here land only in this client's workspace. Referral links add <code>?ref=name</code>.</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex flex-1 items-center rounded-md border border-input bg-background overflow-hidden">
          <span className="pl-3 text-muted-foreground whitespace-nowrap text-xs sm:text-sm truncate max-w-[45%]">{base().replace(/^https?:\/\//, "")}/</span>
          <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            className="border-0 shadow-none focus-visible:ring-0 px-1" data-testid="client-slug-input" />
          <span className="pr-3 text-muted-foreground text-xs sm:text-sm">/apply</span>
        </div>
        <Button onClick={save} disabled={!dirty || saving || slug.length < 3} data-testid="client-slug-save">{saving ? "Saving…" : "Save"}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs break-all text-foreground" data-testid="client-apply-url">{url}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="client-apply-copy">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="client-apply-open">
          <ExternalLink size={13} /> Open
        </a>
      </div>
    </div>
  );
}
