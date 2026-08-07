import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, ClockClockwise, Buildings, Trash, MagnifyingGlass,
  Lock, UserPlus, Key,
} from "@phosphor-icons/react";

import CreateUserDialog from "@/components/users/CreateUserDialog";
import PermissionsDialog from "@/components/users/PermissionsDialog";
import ResetPasswordDialog from "@/components/users/ResetPasswordDialog";

const OFFICE_LABEL = { KM_BLR: "KM BLR", KM_TCR: "KM TCR", KM_KMLY: "KM KMLY" };

const STATUS_STYLE = {
  pending: "bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

const TABS = [
  { value: "pending", label: "Pending", icon: ClockClockwise },
  { value: "approved", label: "Approved", icon: CheckCircle },
  { value: "rejected", label: "Rejected", icon: XCircle },
  { value: "all", label: "All" },
];

export default function Users() {
  const { user: currentUser } = useAuth();
  const isSuper = currentUser?.role === "super_admin";
  const [tab, setTab] = useState("pending");
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState("");
  const [permTarget, setPermTarget] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);

  const load = async (status) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/users${status === "all" ? "" : `?status=${status}`}`);
      setUsers(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(tab); }, [tab]);

  const approve = async (u) => {
    try {
      await api.patch(`/users/${u.id}/approval`, { status: "approved" });
      toast.success(`${u.name} approved`);
      load(tab);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Approve failed");
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    try {
      await api.patch(`/users/${rejecting.id}/approval`, { status: "rejected", note });
      toast.success(`${rejecting.name} rejected`);
      setRejecting(null);
      setNote("");
      load(tab);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Reject failed");
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete user ${u.name} permanently?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("User deleted");
      load(tab);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Delete failed");
    }
  };

  const filtered = users.filter((u) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return u.name?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s);
  });

  return (
    <div className="space-y-6" data-testid="users-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
        <div>
          <p className="label-eyebrow">Access control</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Team & approvals</h1>
          <p className="text-sm text-muted-foreground mt-1">Approve new office-admin signups, create users directly, and manage access.</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              data-testid="users-search"
            />
          </div>
          {isSuper && (
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="h-10 btn-amber border-0 shrink-0"
              data-testid="create-user-btn"
            >
              <UserPlus size={16} className="mr-1.5" /> Create user
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2" data-testid="users-tabs">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            data-testid={`users-tab-${t.value}`}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              tab === t.value
                ? "bg-amber-gradient text-white shadow-md shadow-orange-500/25"
                : "bg-card border border-border text-foreground hover:bg-muted/40"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-sm text-muted-foreground" data-testid="users-loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center" data-testid="users-empty">
          <p className="text-sm text-muted-foreground">No users to show.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="users-list">
          {filtered.map((u) => (
            <Card key={u.id} className="p-5 flex items-start gap-4" data-testid={`user-card-${u.id}`}>
              <div className="w-11 h-11 rounded-full bg-amber-gradient text-white font-display font-semibold flex items-center justify-center shrink-0">
                {(u.name || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-foreground truncate">{u.name}</p>
                  <Badge className={`${STATUS_STYLE[u.approval_status] || ""} border-0`}>{u.approval_status}</Badge>
                  {u.role === "super_admin" && <Badge variant="outline">super admin</Badge>}
                  {u.role === "user" && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">user</Badge>}
                </div>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {u.office && (
                    <span className="inline-flex items-center gap-1">
                      <Buildings size={12} /> {OFFICE_LABEL[u.office] || u.office}
                    </span>
                  )}
                  <span>· joined {new Date(u.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              {u.role !== "super_admin" && (
                <div className="flex flex-col gap-2 shrink-0">
                  {u.approval_status !== "approved" && (
                    <Button size="sm" onClick={() => approve(u)} data-testid={`approve-${u.id}`} className="btn-amber border-0 h-8">
                      <CheckCircle size={14} className="mr-1" /> Approve
                    </Button>
                  )}
                  {u.approval_status !== "rejected" && (
                    <Button size="sm" variant="outline" onClick={() => setRejecting(u)} data-testid={`reject-${u.id}`} className="h-8 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400">
                      <XCircle size={14} className="mr-1" /> Reject
                    </Button>
                  )}
                  {u.approval_status === "approved" && (
                    <Button size="sm" variant="outline" onClick={() => setPermTarget(u)} data-testid={`permissions-${u.id}`} className="h-8">
                      <Lock size={14} className="mr-1" /> Permissions
                    </Button>
                  )}
                  {u.id !== currentUser?.id && (
                    <Button size="sm" variant="outline" onClick={() => setResetTarget(u)} data-testid={`reset-pwd-${u.id}`} className="h-8">
                      <Key size={14} className="mr-1" /> Reset password
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => remove(u)} data-testid={`delete-${u.id}`} className="h-8 text-muted-foreground hover:text-rose-600">
                    <Trash size={14} />
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Reject dialog (small, kept inline) */}
      <Dialog open={!!rejecting} onOpenChange={(o) => { if (!o) { setRejecting(null); setNote(""); } }}>
        <DialogContent data-testid="reject-dialog">
          <DialogHeader>
            <DialogTitle>Reject {rejecting?.name}?</DialogTitle>
            <DialogDescription>They won't be able to sign in. You can add a note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">Note (optional)</Label>
            <Input id="reject-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason…" data-testid="reject-note" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button onClick={reject} data-testid="reject-confirm" className="bg-rose-600 hover:bg-rose-700 text-white">Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PermissionsDialog
        target={permTarget}
        onClose={() => setPermTarget(null)}
        onSaved={() => load(tab)}
      />

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => { setTab("approved"); load("approved"); }}
      />

      <ResetPasswordDialog
        target={resetTarget}
        onClose={() => setResetTarget(null)}
      />
    </div>
  );
}
