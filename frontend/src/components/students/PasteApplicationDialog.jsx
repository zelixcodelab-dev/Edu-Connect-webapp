import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardText, MagicWand } from "@phosphor-icons/react";
import { toast } from "sonner";
import { parseStudentText, buildApplicationPayload } from "@/lib/parseStudentText";

import PasteReviewStep from "@/components/students/PasteReviewStep";

const SAMPLE = `Name of the student : Anupama V V
Student contact no : 9656592598
Course : Bse Nursing
College : Little flower
10th/12th register Number : 25213163
Sex (Male/Female) : Female
Student Email id : anuzzz393@gmail.com
Father Name: Jayan
Father Mobile number : 9497373478
Mother Name : Shiji
Mother Mobile Number : 9645705972
Address : variyath valappil
Date of birth : 25/08/2008
Aadhaar Number : 528422556658
Nationality : India
Religion : Hindu
Name of the caste : Thiyya
Hostel or Bus : Hostel
10th school name and place : SNDP school udayanperoor (tripunithura)
10th Mark : 80%
+2 Register Number : 25213163
+2 School name : GMRHSS THRITHALA
+2 Mark : 78%`;

export default function PasteApplicationDialog({ open, onOpenChange, onCreated }) {
  const nav = useNavigate();
  const [step, setStep] = useState("paste"); // 'paste' | 'review'
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [unmatched, setUnmatched] = useState([]);
  const [saving, setSaving] = useState(false);
  const [pastePlace, setPastePlace] = useState("");

  const reset = () => { setStep("paste"); setRawText(""); setParsed(null); setUnmatched([]); };
  const close = () => { reset(); onOpenChange?.(false); };

  const doParse = () => {
    const text = rawText.trim();
    if (!text) { toast.error("Paste the student details first"); return; }
    const out = parseStudentText(text);
    if (!out.basic_info.student_full_name) {
      toast.error("Could not detect a student name — please check the format");
      return;
    }
    setUnmatched(out._meta?.unmatched || []);
    setParsed(out);
    setStep("review");
  };

  const setBI = (k, v) => setParsed((p) => ({ ...p, basic_info: { ...p.basic_info, [k]: v } }));
  const setCO = (k, v) => setParsed((p) => ({ ...p, course: { ...p.course, [k]: v } }));
  const setCM = (k, v) => setParsed((p) => ({ ...p, communication: { ...p.communication, [k]: v } }));
  const setAC = (block, k, v) => setParsed((p) => ({
    ...p, academic: { ...p.academic, [block]: { ...p.academic[block], [k]: v } },
  }));

  const validate = () => {
    const errors = [];
    if (!parsed.basic_info.student_full_name?.trim()) errors.push("Student name is required");
    if (!parsed.basic_info.mobile_number?.trim()) errors.push("Student mobile is required");
    if (!parsed.basic_info.email?.trim()) errors.push("Email is required");
    if (!parsed.basic_info.date_of_birth?.trim()) errors.push("Date of birth is required");
    if (!parsed.course.interested_course?.trim()) errors.push("Course is required");
    if (!parsed.communication.father_name?.trim()) errors.push("Father's name is required");
    if (!parsed.communication.father_mobile?.trim()) errors.push("Father's mobile is required");
    if (!parsed.communication.address_line_1?.trim()) errors.push("Address is required");
    if (!parsed.communication.city?.trim()) errors.push("City is required");
    if (!parsed.communication.pincode?.trim()) errors.push("Pincode is required");
    return errors;
  };

  const save = async () => {
    const errors = validate();
    if (errors.length) {
      if (errors.length === 1) {
        toast.error(errors[0]);
      } else {
        toast.error(`Please fill ${errors.length} required field(s)`, {
          description: errors.join(" · "),
        });
      }
      return;
    }
    setSaving(true);
    try {
      const payload = buildApplicationPayload(parsed);
      const { data } = await api.post("/applications/admin", payload);
      toast.success("Student enrolled as Inquiry");
      onCreated?.(data);
      close();
      if (data?.id) nav(`/students/${data.id}`);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Save failed");
      console.error("[paste-app] save:", err);
    } finally {
      setSaving(false);
    }
  };

  const fieldCount = useMemo(() => {
    if (!parsed) return 0;
    const bi = parsed.basic_info;
    const co = parsed.course;
    const cm = parsed.communication;
    const ac = parsed.academic;
    return [
      bi.student_full_name, bi.mobile_number, bi.email, bi.date_of_birth, bi.gender,
      bi.aadhaar_number, bi.nationality, bi.religion, bi.caste,
      co.interested_course, co.preferred_college,
      cm.father_name, cm.father_mobile, cm.mother_name, cm.mother_mobile,
      cm.address_line_1, cm.city, cm.pincode,
      ac.tenth.register_number, ac.tenth.school_name, ac.tenth.percentage,
      ac.twelfth.register_number, ac.twelfth.school_name, ac.twelfth.percentage,
    ].filter((v) => String(v || "").trim().length > 0).length;
  }, [parsed]);

  return (
    <Dialog open={open} onOpenChange={(v) => v ? onOpenChange?.(true) : close()}>
      <DialogContent
        className="bg-card max-w-3xl max-h-[92vh] overflow-y-auto"
        data-testid="paste-app-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ClipboardText size={20} className="text-amber-600 dark:text-amber-400" />
            {step === "paste" ? "Paste student application" : "Review & confirm"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {step === "paste"
              ? "Paste the application text you received — we'll auto-detect every field."
              : `${fieldCount} fields auto-detected · adjust anything that needs a fix, then save as an Inquiry.`}
          </DialogDescription>
        </DialogHeader>

        {step === "paste" ? (
          <div className="space-y-4">
            <div>
              <Label>Application text</Label>
              <Textarea
                rows={14}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={SAMPLE}
                data-testid="paste-textarea"
                className="font-mono text-xs mt-1.5"
              />
              <div className="flex items-center justify-between mt-2">
                <p className="text-[11px] text-muted-foreground">
                  Tip: format is <code className="px-1 rounded bg-muted">Key : Value</code> per line — most spellings are accepted.
                </p>
                <button
                  type="button"
                  onClick={() => setRawText(SAMPLE)}
                  data-testid="paste-load-sample"
                  className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline"
                >
                  Load sample
                </button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button
                type="button"
                onClick={doParse}
                disabled={!rawText.trim()}
                className="btn-amber border-0"
                data-testid="paste-parse-btn"
              >
                <MagicWand size={15} className="mr-1.5" /> Parse details
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <PasteReviewStep
            parsed={parsed}
            setBI={setBI}
            setCO={setCO}
            setCM={setCM}
            setAC={setAC}
            pastePlace={pastePlace}
            setPastePlace={setPastePlace}
            fieldCount={fieldCount}
            unmatched={unmatched}
            saving={saving}
            onBack={() => setStep("paste")}
            onCancel={close}
            onSave={save}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
