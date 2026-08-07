import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Plus, Buildings, MagnifyingGlass, UploadSimple, Warning,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { COLLEGE_PLACES, placeForSelect } from "@/lib/places";

import CollegeCard from "@/components/colleges/CollegeCard";
import CollegeFormDialog from "@/components/colleges/CollegeFormDialog";
import BulkUploadDialog from "@/components/colleges/BulkUploadDialog";

export default function Colleges() {
  const { user } = useAuth();
  const isSuper = user?.role === "super_admin";
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [placeFilter, setPlaceFilter] = useState(""); // "" = all
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/colleges");
      setList(r.data || []);
    } catch (err) {
      console.error("[colleges] list failed:", err);
      toast.error("Could not load colleges");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Deep-link: ?add=1 (from the mobile bottom-nav "+" Quick Add menu) auto-opens
  // the Add college dialog.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setEditing(null);
      setOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("add");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openCreate = () => { setEditing(null); setOpen(true); };
  const openEdit = (c) => { setEditing(c); setOpen(true); };

  const remove = async (c) => {
    if (!window.confirm(`Delete "${c.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/colleges/${c.id}`);
      toast.success("Deleted");
      load();
    } catch (err) {
      console.error("[colleges] delete failed:", err);
      toast.error("Delete failed");
    }
  };

  const filtered = useMemo(() => {
    let pool = list;
    if (placeFilter) {
      if (placeFilter === "_other") {
        pool = pool.filter((c) => placeForSelect(c.place || "") === "Other");
      } else {
        pool = pool.filter((c) =>
          (c.place || "").trim().toLowerCase() === placeFilter.toLowerCase()
        );
      }
    }
    if (!q) return pool;
    const term = q.toLowerCase();
    return pool.filter((c) =>
      (c.name || "").toLowerCase().includes(term)
      || (c.place || "").toLowerCase().includes(term)
      || (c.deal_with || "").toLowerCase().includes(term)
      || (c.courses || []).some((co) => co.toLowerCase().includes(term))
    );
  }, [list, q, placeFilter]);

  // Per-place counts for the filter chips (rendered next to each city label).
  const placeCounts = useMemo(() => {
    const counts = { _all: list.length, _other: 0 };
    for (const c of list) {
      const bucket = placeForSelect(c.place || "");
      if (bucket && bucket !== "Other" && COLLEGE_PLACES.includes(bucket)) {
        counts[bucket] = (counts[bucket] || 0) + 1;
      } else if (bucket === "Other") {
        counts._other += 1;
      }
    }
    return counts;
  }, [list]);

  // Office admins read-only — they shouldn't even land here, but defense in depth.
  if (!isSuper) {
    return (
      <div className="space-y-6 animate-fade-in" data-testid="colleges-no-access">
        <Card className="p-12 text-center text-sm text-muted-foreground border border-border bg-card shadow-none">
          <Warning size={32} className="mx-auto text-muted-foreground/50 mb-3" />
          Only super admins can manage the Colleges catalogue.
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in" data-testid="colleges-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">Network</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Colleges</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your partner colleges. The catalogue powers the dropdown on the student admission form.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setBulkOpen(true)}
            className="h-10"
            data-testid="bulk-upload-btn"
          >
            <UploadSimple size={16} className="mr-1.5" /> Bulk upload
          </Button>
          <Button
            type="button"
            onClick={openCreate}
            className="h-10 btn-amber border-0"
            data-testid="add-college-btn"
          >
            <Plus size={16} className="mr-1.5" /> Add college
          </Button>
        </div>
      </header>

      {/* Place filter chips */}
      <div className="flex flex-wrap gap-2" data-testid="place-filter-chips">
        <button
          type="button"
          onClick={() => setPlaceFilter("")}
          data-testid="place-chip-all"
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
            placeFilter === ""
              ? "bg-amber-gradient text-white border-transparent"
              : "bg-card border-border text-muted-foreground hover:border-orange-500/40 hover:text-foreground"
          }`}
        >
          All <span className="opacity-70 ml-1">{placeCounts._all || 0}</span>
        </button>
        {COLLEGE_PLACES.map((city) => (
          <button
            key={city}
            type="button"
            onClick={() => setPlaceFilter(city)}
            data-testid={`place-chip-${city.toLowerCase()}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              placeFilter === city
                ? "bg-amber-gradient text-white border-transparent"
                : "bg-card border-border text-muted-foreground hover:border-orange-500/40 hover:text-foreground"
            }`}
          >
            {city} <span className="opacity-70 ml-1">{placeCounts[city] || 0}</span>
          </button>
        ))}
        {placeCounts._other > 0 && (
          <button
            type="button"
            onClick={() => setPlaceFilter("_other")}
            data-testid="place-chip-other"
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              placeFilter === "_other"
                ? "bg-amber-gradient text-white border-transparent"
                : "bg-card border-border text-muted-foreground hover:border-orange-500/40 hover:text-foreground"
            }`}
          >
            Other <span className="opacity-70 ml-1">{placeCounts._other}</span>
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, place, course, or deal-with"
          className="pl-9 bg-card"
          data-testid="college-search"
        />
      </div>

      {loading ? (
        <Card className="p-12 text-center text-sm text-muted-foreground border border-border bg-card shadow-none">
          Loading…
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground border border-border bg-card shadow-none" data-testid="empty-colleges">
          <Buildings size={32} className="mx-auto text-muted-foreground/50 mb-3" />
          {list.length === 0
            ? "No colleges yet. Add your first or upload a CSV."
            : "No colleges match this search."}
        </Card>
      ) : (
        <>
          <p className="label-eyebrow" data-testid="colleges-count-eyebrow">
            {filtered.length} {filtered.length === 1 ? "college" : "colleges"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start" data-testid="colleges-grid">
            {filtered.map((c) => (
              <CollegeCard key={c.id} c={c} onEdit={openEdit} onDelete={remove} />
            ))}
          </div>
        </>
      )}

      <CollegeFormDialog
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}
        editing={editing}
        onSaved={load}
      />

      <BulkUploadDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onUploaded={load}
      />
    </div>
  );
}
