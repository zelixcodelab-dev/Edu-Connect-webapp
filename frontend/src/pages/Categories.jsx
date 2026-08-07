import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

const empty = { name: "", type: "expense", color: "#78716c" };
const COLORS = ["#059669","#10b981","#0ea5e9","#8b5cf6","#f59e0b","#ef4444","#be123c","#a16207","#525252","#78716c"];

export default function Categories() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);

  const load = async () => setList((await api.get("/categories")).data);
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, type: c.type, color: c.color || "#78716c" }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) await api.patch(`/categories/${editing.id}`, form);
      else await api.post("/categories", form);
      toast.success(editing ? "Category updated" : "Category added");
      setOpen(false); load();
    } catch { toast.error("Failed"); }
  };

  const remove = async (id) => {
    if (!confirm("Delete category?")) return;
    await api.delete(`/categories/${id}`);
    toast.success("Deleted"); load();
  };

  const income = list.filter(c => c.type === "income");
  const expense = list.filter(c => c.type === "expense");

  const renderGroup = (title, items) => (
    <Card className="border border-border bg-card rounded-lg shadow-none">
      <div className="px-6 py-4 border-b border-border">
        <p className="label-eyebrow">{title}</p>
      </div>
      {items.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No categories.</div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map(c => (
            <li key={c.id} className="px-6 py-3 flex items-center justify-between hover:bg-muted/40" data-testid={`cat-row-${c.id}`}>
              <span className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-sm" style={{ background: c.color }} />
                <span className="text-sm">{c.name}</span>
              </span>
              <span className="flex gap-1">
                <button onClick={() => openEdit(c)} data-testid={`edit-cat-${c.id}`} className="text-muted-foreground hover:text-foreground p-1.5"><PencilSimple size={16} /></button>
                <button onClick={() => remove(c.id)} data-testid={`delete-cat-${c.id}`} className="text-muted-foreground hover:text-rose-700 dark:text-rose-400 p-1.5"><Trash size={16} /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return (
    <div className="space-y-6 animate-fade-in" data-testid="categories-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">Buckets</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Categories</h1>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="add-category-btn" className="h-10 btn-amber border-0">
              <Plus size={16} className="mr-1.5" /> Add category
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card">
            <DialogHeader><DialogTitle className="font-display">{editing ? "Edit" : "Add"} category</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="cat-name" /></div>
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="cat-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                      className={`w-7 h-7 rounded-md border-2 ${form.color === c ? 'border-foreground' : 'border-transparent'}`}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="btn-amber border-0" data-testid="cat-save">{editing ? "Save" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderGroup("Income", income)}
        {renderGroup("Expense", expense)}
      </div>
    </div>
  );
}
