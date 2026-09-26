import React, { useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { FirstAid, HourglassMedium, DotsThreeCircle } from "@phosphor-icons/react";

// Today in IST (matches the backend emergency-leave check).
const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const TYPES = [
  { key: "sick", label: "Sick", icon: FirstAid, leave_type: "sick", half_day: false },
  { key: "half_day", label: "Half day", icon: HourglassMedium, leave_type: "casual", half_day: true },
  { key: "other", label: "Other", icon: DotsThreeCircle, leave_type: "casual", half_day: false },
];

export default function EmergencyLeaveDialog({ open, onOpenChange, onSubmitted }) {
  const [type, setType] = useState("sick");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const today = istToday();
  const sel = TYPES.find((t) => t.key === type);
  const needReason = type === "other";

  const submit = async () => {
    if (needReason && !reason.trim()) return toast.error("Please mention the reason");
    setBusy(true);
    try {
      const prefix = type === "other" ? "Emergency (Other): " : type === "half_day" ? "Emergency half day. " : "Emergency (Sick). ";
      await api.post("/leave", {
        leave_type: sel.leave_type,
        from_date: today,
        to_date: today,
        half_day: sel.half_day,
        emergency: true,
        reason: (prefix + reason).trim(),
      });
      toast.success("Emergency leave sent for approval");
      setReason("");
      setType("sick");
      onOpenChange(false);
      onSubmitted?.();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const prettyDate = new Date(today + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="emergency-leave-dialog">
        <DialogHeader><DialogTitle>Emergency leave · today</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground" data-testid="emg-date">
            For <span className="font-medium text-foreground">{prettyDate}</span> only
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {TYPES.map((t) => {
                const Icon = t.icon;
                const activeC = type === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setType(t.key)}
                    data-testid={`emg-type-${t.key}`}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-medium transition-colors ${activeC ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                  >
                    <Icon size={22} weight={activeC ? "fill" : "regular"} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {needReason ? "Mention reason" : "Reason (optional)"}
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={needReason ? "Please describe your emergency…" : "Add a short note for your admin…"}
              data-testid="emg-reason"
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="btn-amber" onClick={submit} disabled={busy} data-testid="emg-submit">Send request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
