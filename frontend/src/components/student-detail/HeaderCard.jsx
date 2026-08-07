import React from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PencilSimple, Trash, Plus, FilePdf, FileText, ClipboardText, GraduationCap, Lock } from "@phosphor-icons/react";
import { formatDate } from "@/lib/format";
import FeesPlanFields, { emptyFeesPlan } from "@/components/FeesPlanFields";
import CollegeSelect from "@/components/CollegeSelect";
import { STATUS_OPTIONS } from "./constants";

const STATUS_STYLES = {
  enrolled: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400",
  completed: "bg-sky-100/60 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

export default function HeaderCard({
  s,
  editing,
  setEditing,
  header,
  setHeader,
  clients,
  currency,
  isSuperAdmin,
  onSave,
  onDelete,
  onAddEntry,
  onExportPdf,
  onExportApplicationPdf,
  onEditApplication,
  onConvertToEnrolled,
}) {
  return (
    <Card className="p-6 border border-border bg-card rounded-lg shadow-none">
      {editing ? (
        <div className="space-y-4" data-testid="header-edit">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={header.name} onChange={(e) => setHeader({ ...header, name: e.target.value })} /></div>
            <div><Label>Course</Label><Input value={header.course} onChange={(e) => setHeader({ ...header, course: e.target.value })} /></div>
            <div>
              <Label>College</Label>
              <CollegeSelect
                value={header.college}
                onChange={(name) => setHeader({ ...header, college: name })}
                testid="hdr-college"
                placeholder="Pick a college"
              />
            </div>
            <div>
              <Label>Reference</Label>
              <Select
                value={header.reference || "_none"}
                onValueChange={(v) => setHeader({ ...header, reference: v === "_none" ? "" : v })}
              >
                <SelectTrigger data-testid="hdr-reference"><SelectValue placeholder="Select referring client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                  {header.reference && !clients.some((c) => c.name === header.reference) && (
                    <SelectItem value={header.reference}>{header.reference} (legacy)</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div><Label>SC Earned</Label><Input type="number" step="0.01" value={header.sc_out_fixed} onChange={(e) => setHeader({ ...header, sc_out_fixed: e.target.value })} /></div>
            <div>
              <Label>Status</Label>
              <Select value={header.status} onValueChange={(v) => setHeader({ ...header, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Enrollment Date</Label><Input type="date" value={header.enrollment_date} onChange={(e) => setHeader({ ...header, enrollment_date: e.target.value })} /></div>
          </div>
          {isSuperAdmin && (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-1.5"
              data-testid="hdr-sc-college-row"
            >
              <Label className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 text-xs">
                <Lock size={11} weight="fill" />
                SC received from college (override) · <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-amber-500/20">Super admin only</span>
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={header.sc_from_college_override ?? ""}
                onChange={(e) => setHeader({ ...header, sc_from_college_override: e.target.value })}
                placeholder="Leave blank to use college default rate"
                data-testid="hdr-sc-college-override"
              />
              <p className="text-[11px] text-muted-foreground">
                Overrides the college-level SC rate on the Admission Revenue dashboard for this single admission.
              </p>
            </div>
          )}
          {isSuperAdmin && (
            <div data-testid="hdr-home-office-row">
              <Label>Visible to office <span className="text-xs text-muted-foreground font-normal">(blank = private to me)</span></Label>
              <Select
                value={header.home_office || "_none"}
                onValueChange={(v) => setHeader({ ...header, home_office: v === "_none" ? "" : v })}
              >
                <SelectTrigger data-testid="hdr-home-office"><SelectValue placeholder="Private to me (default)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Private to me (default)</SelectItem>
                  <SelectItem value="KM_BLR">KM BLR</SelectItem>
                  <SelectItem value="KM_TCR">KM TCR</SelectItem>
                  <SelectItem value="KM_KMLY">KM KMLY</SelectItem>
                  <SelectItem value="ALL">Shared (all offices)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <FeesPlanFields
            fp={header.fees_plan || emptyFeesPlan()}
            onChange={(next) => setHeader({ ...header, fees_plan: next })}
            currency={currency}
          />
          <div><Label>Notes</Label><Textarea rows={2} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={onSave} className="btn-amber border-0" data-testid="header-save">Save</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex-1">
            <p className="label-eyebrow">Student</p>
            <h1 className="font-display text-3xl tracking-tight mt-1.5">{s.name}</h1>
            <div className="mt-2 text-sm text-muted-foreground space-x-2">
              {s.course && <span>{s.course}</span>}
              {s.college && <span>· {s.college}</span>}
              {s.reference && <span>· Referred by {s.reference}</span>}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs flex-wrap">
              <span className={`uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_STYLES[s.status] || "bg-muted text-foreground"}`}>{s.status}</span>
              {s.enrollment_date && <span className="text-muted-foreground">Enrolled {formatDate(s.enrollment_date)}</span>}
              {s.application_source === "public_form" && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100/70 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 uppercase tracking-wider" data-testid="badge-public-application">
                  <FileText size={11} weight="duotone" /> From online application
                </span>
              )}
              {s.application_source === "admin_paste" && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-100/70 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300 uppercase tracking-wider" data-testid="badge-pasted-application">
                  <ClipboardText size={11} weight="duotone" /> Pasted application
                </span>
              )}
            </div>
            {s.notes && <p className="mt-3 text-sm text-muted-foreground">{s.notes}</p>}
          </div>
          <div className="flex gap-2 flex-wrap">
            {s.status === "inquiry" && (
              <Button
                onClick={onConvertToEnrolled}
                className="bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                data-testid="convert-enrolled-btn"
              >
                <GraduationCap size={14} className="mr-1.5" /> Convert to enrolled
              </Button>
            )}
            <Button onClick={onAddEntry} className="btn-amber border-0" data-testid="add-payment-btn">
              <Plus size={14} className="mr-1.5" /> Add Payment
            </Button>
            <Button variant="outline" onClick={onExportPdf} data-testid="export-student-pdf">
              <FilePdf size={14} className="mr-1.5" /> PDF
            </Button>
            {(s.application_source === "public_form" || s.application_source === "admin_paste") && s.application && (
              <Button variant="outline" onClick={onExportApplicationPdf} data-testid="export-application-pdf">
                <ClipboardText size={14} className="mr-1.5" /> Application PDF
              </Button>
            )}
            {(s.application_source === "public_form" || s.application_source === "admin_paste") && s.application && onEditApplication && (
              <Button variant="outline" onClick={onEditApplication} data-testid="edit-application-btn">
                <PencilSimple size={14} className="mr-1.5" /> Edit application
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(true)} data-testid="edit-header"><PencilSimple size={14} className="mr-1.5" /> Edit</Button>
            <Button variant="outline" className="text-rose-700 dark:text-rose-400 hover:text-rose-800" onClick={onDelete} data-testid="delete-student"><Trash size={14} className="mr-1.5" /> Delete</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
