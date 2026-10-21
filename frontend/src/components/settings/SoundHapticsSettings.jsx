/**
 * "Sound & Haptics" preference toggle for the Profile / Settings page.
 * Controls the app-wide success chime + phone-tap that plays on saves and
 * milestone wins. Default ON; state persists in localStorage (see
 * lib/feedbackSound.js). Toggling ON plays a sample cue so the change is felt.
 */
import React, { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SpeakerHigh } from "@phosphor-icons/react";
import { isSoundEnabled, setSoundEnabled, playSuccessCue } from "@/lib/feedbackSound";

export default function SoundHapticsSettings() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => { setEnabled(isSoundEnabled()); }, []);

  const onToggle = (v) => {
    setEnabled(v);
    setSoundEnabled(v);
    if (v) playSuccessCue({ milestone: false }); // let the user hear/feel it
  };

  return (
    <Card className="p-4 sm:p-6" data-testid="sound-haptics-settings-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <SpeakerHigh size={20} weight="duotone" />
          </div>
          <div>
            <h3 className="font-display text-base font-semibold">Sound &amp; Haptics</h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
              Play a subtle chime and a gentle phone tap when something saves or a milestone
              is reached. Turn this off for silent, buzz-free feedback.
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          data-testid="sound-haptics-toggle"
          aria-label="Toggle success sound and haptics"
        />
      </div>
    </Card>
  );
}
