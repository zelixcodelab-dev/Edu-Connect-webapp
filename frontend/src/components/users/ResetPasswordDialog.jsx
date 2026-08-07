import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Key, Eye, EyeSlash } from "@phosphor-icons/react";

/** Reset-password dialog (super_admin only).
 * Opens when `target` user is set, closes via `onClose`.
 */
export default function ResetPasswordDialog({ target, onClose }) {
  const [form, setForm] = useState({ new_password: "", confirm: "" });
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset form whenever target changes
  useEffect(() => {
    if (target) {
      setForm({ new_password: "", confirm: "" });
      setShow(false);
    }
  }, [target]);

  const submit = async () => {
    if (!target) return;
    const pwd = form.new_password;
    if (!pwd || pwd.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (pwd !== form.confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/users/${target.id}/reset-password`, { new_password: pwd });
      toast.success(`Password reset for ${target.name}`);
      onClose();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="reset-pwd-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key size={20} weight="duotone" className="text-amber-500" />
            Reset password for {target?.name}
          </DialogTitle>
          <DialogDescription>
            Set a new password directly. The user can sign in with the new password
            immediately. They will not receive any email.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 inline-block">New password</label>
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={form.new_password}
                onChange={(e) => setForm({ ...form, new_password: e.target.value })}
                placeholder="Min 8 characters"
                data-testid="reset-pwd-new"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                data-testid="reset-pwd-toggle"
              >
                {show ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 inline-block">Confirm new password</label>
            <Input
              type={show ? "text" : "password"}
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              placeholder="Type the same password again"
              data-testid="reset-pwd-confirm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Make a note of this password and share it with{" "}
            <strong>{target?.name}</strong> securely.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={saving}
            className="btn-amber border-0"
            data-testid="reset-pwd-save"
          >
            {saving ? "Saving…" : "Reset password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
