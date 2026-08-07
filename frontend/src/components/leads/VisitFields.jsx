import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TRAVEL_MODES } from "./constants";

// Shared campus-visit schedule sub-form (Interested + Convert dialogs).
export default function VisitFields({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="visit-fields">
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">Institution / campus being visited</Label>
        <Input value={value.institution || ""} onChange={(e) => set("institution", e.target.value)} placeholder="e.g. Sri Siddartha Medical College" data-testid="visit-institution-input" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Departure date &amp; time *</Label>
        <Input type="datetime-local" value={value.departure_at} onChange={(e) => set("departure_at", e.target.value)} data-testid="visit-departure-input" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Arrival date &amp; time *</Label>
        <Input type="datetime-local" value={value.arrival_at} onChange={(e) => set("arrival_at", e.target.value)} data-testid="visit-arrival-input" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Mode of travel</Label>
        <Select value={value.travel_mode || ""} onValueChange={(v) => set("travel_mode", v)}>
          <SelectTrigger data-testid="visit-travel-select" className="bg-card"><SelectValue placeholder="Select mode" /></SelectTrigger>
          <SelectContent>
            {TRAVEL_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Who comes along</Label>
        <Input value={value.who_comes} onChange={(e) => set("who_comes", e.target.value)} placeholder="e.g. Student + Father" data-testid="visit-who-input" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">Drop point / Pick-up location</Label>
        <Input value={value.drop_point} onChange={(e) => set("drop_point", e.target.value)} placeholder="e.g. Majestic Bus Stand, Bengaluru" data-testid="visit-drop-input" />
      </div>
    </div>
  );
}
