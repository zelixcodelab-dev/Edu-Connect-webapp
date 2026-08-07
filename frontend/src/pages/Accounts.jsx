import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canEdit } from "@/lib/perm";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, PencilSimple, Trash, Bank, Wallet, CreditCard } from "@phosphor-icons/react";
import { toast } from "sonner";

const TYPES = [
  { value: "bank", label: "Bank", icon: Bank },
  { value: "cash", label: "Cash", icon: Wallet },
  { value: "credit_card", label: "Credit card", icon: CreditCard },
];

const empty = { name: "", type: "bank", opening_balance: 0, color: "#10b981" };
const COLORS = ["#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#78716c"];

export default function Accounts() {
  const { user } = useAuth();
  const allowEdit = canEdit(user, "accounts");
  const currency = user?.currency || "USD";
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const { data } = await api.get("/accounts");
    setList(data);
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (a) => { setEditing(a); setForm({ name: a.name, type: a.type, opening_balance: a.opening_balance, color: a.color || "#10b981" }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    const payload = { ...form, opening_balance: parseFloat(form.opening_balance) || 0 };
    try {
      if (editing) await api.patch(`/accounts/${editing.id}`, payload);
      else await api.post("/accounts", payload);
      toast.success(editing ? "Account updated" : "Account added");
      setOpen(false); load();
    } catch { toast.error("Failed"); }
  };

  const remove = async (id) => {
    if (!confirm("Delete this account?")) return;
    await api.delete(`/accounts/${id}`);
    toast.success("Deleted"); load();
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="accounts-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">Money sources</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Accounts</h1>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          {allowEdit && (
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="add-account-btn" className="h-10 btn-amber border-0">
              <Plus size={16} className="mr-1.5" /> Add account
            </Button>
          </DialogTrigger>
          )}
          <DialogContent className="bg-card">
            <DialogHeader><DialogTitle className="font-display">{editing ? "Edit" : "Add"} account</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chase Business" data-testid="acc-name" />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="acc-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Opening balance</Label>
                <Input type="number" step="0.01" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} data-testid="acc-balance" />
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex gap-2 mt-1">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                      className={`w-7 h-7 rounded-md border-2 ${form.color === c ? 'border-foreground' : 'border-transparent'}`}
                      style={{ background: c }} data-testid={`acc-color-${c}`} />
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="btn-amber border-0" data-testid="acc-save">{editing ? "Save" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {list.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground border border-border shadow-none">No accounts yet.</Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((a) => {
            const TypeIcon = TYPES.find(t => t.value === a.type)?.icon || Bank;
            return (
              <Card key={a.id} className="p-6 border border-border bg-card rounded-lg shadow-none lift" data-testid={`account-card-${a.id}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ background: `${a.color}1a`, color: a.color }}>
                      <TypeIcon size={20} weight="regular" />
                    </div>
                    <div>
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{a.type.replace("_", " ")}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {allowEdit && <button onClick={() => openEdit(a)} data-testid={`edit-acc-${a.id}`} className="text-muted-foreground hover:text-foreground p-1.5"><PencilSimple size={16} /></button>}
                    {allowEdit && <button onClick={() => remove(a.id)} data-testid={`delete-acc-${a.id}`} className="text-muted-foreground hover:text-rose-700 dark:text-rose-400 p-1.5"><Trash size={16} /></button>}
                  </div>
                </div>
                <div className="mt-5">
                  <p className="label-eyebrow">Balance</p>
                  <p className="font-display text-3xl mt-1 tabular-nums">{formatMoney(a.current_balance ?? a.opening_balance, currency)}</p>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
