import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { PERMISSION_PAGES, PERMISSION_LEVELS, defaultPermissions } from "@/lib/perm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldCheck } from "@phosphor-icons/react";

/** Granular permissions editor. Opens when `target` is set, closes when null.
 * Calls onSaved() once the PATCH succeeds so the parent can refresh.
 */
export default function PermissionsDialog({ target, onClose, onSaved }) {
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  // Seed draft with target's permissions + defaults on open
  useEffect(() => {
    if (target) {
      setDraft({ ...defaultPermissions(), ...(target.permissions || {}) });
    }
  }, [target]);

  const save = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await api.patch(`/users/${target.id}/permissions`, { permissions: draft });
      toast.success(`Permissions updated for ${target.name}`);
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="permissions-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={20} weight="duotone" className="text-orange-600 dark:text-orange-400" />
            {target?.name} · permissions
            {target?.role === "user" && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 ml-1">user</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {target?.role === "user"
              ? "Pick which pages this user can see in their sidebar and bottom nav. Setting a page to 'No access' hides it from their navigation entirely."
              : "Control what this office-admin can see and edit. Changes take effect on their next sign-in."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[55vh] overflow-y-auto py-2" data-testid="permissions-list">
          {PERMISSION_PAGES.map((p) => (
            <div key={p.key} className="rounded-lg border border-border bg-card p-3 flex flex-col sm:flex-row sm:items-center gap-3" data-testid={`perm-row-${p.key}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{p.label}</p>
                <p className="text-[11px] text-muted-foreground">page key: <code>{p.key}</code></p>
              </div>
              <div className="flex gap-1 shrink-0 bg-muted/40 rounded-lg p-1">
                {PERMISSION_LEVELS.map((lv) => {
                  const active = (draft[p.key] || "edit") === lv.value;
                  return (
                    <button
                      key={lv.value}
                      type="button"
                      onClick={() => setDraft({ ...draft, [p.key]: lv.value })}
                      data-testid={`perm-${p.key}-${lv.value}`}
                      title={lv.hint}
                      className={`px-3 py-1 text-xs rounded-md transition-all ${
                        active
                          ? lv.value === "edit"
                            ? "bg-amber-gradient text-white shadow-sm"
                            : lv.value === "view"
                            ? "bg-sky-500 text-white shadow-sm"
                            : "bg-rose-500 text-white shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {lv.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => setDraft(defaultPermissions())} data-testid="perm-reset" className="sm:mr-auto">
            Reset to default (all edit)
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} data-testid="perm-save" className="btn-amber border-0">
            {saving ? "Saving…" : "Save permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
