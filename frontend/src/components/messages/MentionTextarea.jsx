import React, { useCallback, useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { At } from "@phosphor-icons/react";

/** Textarea that supports @-mentions. Triggers a dropdown when the user
 * types "@" — filterable by what they type after — and on selection inserts
 * `@<name>` text + bubbles the picked user's id up to the parent via
 * `onMentionsChange`. Multiple distinct mentions are tracked.
 *
 * Props:
 *   value, onChange — standard textarea value / setter
 *   options — [{ id, name, role? }] — eligible mention targets
 *   mentions — current array of user_ids (controlled by parent)
 *   onMentionsChange — (next_array) => void
 *   placeholder, rows, testid — passthrough
 */
export default function MentionTextarea({
  value, onChange,
  options = [],
  mentions = [],
  onMentionsChange,
  placeholder, rows = 3, testid,
  maxLength,
  className = "",
}) {
  const textareaRef = useRef(null);
  const [trigger, setTrigger] = useState(null); // {start, query} | null
  const [activeIdx, setActiveIdx] = useState(0);

  // Compute the trigger window: find the most recent unmatched "@" preceding
  // the cursor that isn't immediately preceded by a word char.
  const computeTrigger = (txt, caret) => {
    if (caret <= 0) return null;
    // Walk backwards from cursor looking for an "@". Stop at whitespace.
    let i = caret - 1;
    while (i >= 0) {
      const ch = txt[i];
      if (ch === "@") {
        // Must be at start OR preceded by whitespace
        if (i === 0 || /\s/.test(txt[i - 1] || "")) {
          const query = txt.slice(i + 1, caret);
          if (/\s/.test(query)) return null; // ended with a space — no longer triggering
          return { start: i, query };
        }
        return null;
      }
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  };

  const handleChange = (e) => {
    const next = e.target.value;
    onChange(next);
    const caret = e.target.selectionStart || next.length;
    const t = computeTrigger(next, caret);
    setTrigger(t);
    setActiveIdx(0);
  };

  // Cursor moves without text change (arrow keys, click) — still recompute.
  const handleKeyUp = (e) => {
    const caret = e.target.selectionStart || 0;
    const t = computeTrigger(e.target.value, caret);
    setTrigger(t);
  };

  const filtered = (trigger
    ? options.filter((o) =>
        !trigger.query
        || (o.name || "").toLowerCase().includes(trigger.query.toLowerCase()))
    : []
  ).slice(0, 6);

  // Stable callback to insert a pick at current trigger position.
  const insertPick = useCallback((opt) => {
    if (!trigger) return;
    const before = value.slice(0, trigger.start);
    const after = value.slice((textareaRef.current?.selectionStart) ?? value.length);
    const insertion = `@${opt.name} `;
    const next = `${before}${insertion}${after}`;
    onChange(next);
    if (!mentions.includes(opt.id)) {
      onMentionsChange?.([...mentions, opt.id]);
    }
    setTrigger(null);
    // Restore caret right after insertion
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = before.length + insertion.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }, [trigger, value, onChange, mentions, onMentionsChange]);

  const handleKeyDown = (e) => {
    if (!trigger || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertPick(filtered[activeIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setTrigger(null);
    }
  };

  // Hide picker when textarea loses focus (small delay so click on item registers)
  const hideSoon = () => { setTimeout(() => setTrigger(null), 120); };

  // If text no longer contains @<name> for any mention id, drop it. Keeps the
  // mentions array tidy when users delete their typed mention.
  useEffect(() => {
    if (mentions.length === 0) return;
    const survivors = mentions.filter((id) => {
      const opt = options.find((o) => o.id === id);
      if (!opt || !opt.name) return false;
      return value.includes(`@${opt.name}`);
    });
    if (survivors.length !== mentions.length) onMentionsChange?.(survivors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative" data-testid={testid ? `${testid}-wrap` : undefined}>
      <Textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={hideSoon}
        placeholder={placeholder}
        data-testid={testid}
        maxLength={maxLength}
        className={className}
      />
      {trigger && filtered.length > 0 && (
        <div
          className="absolute z-30 mt-1 w-72 max-w-full rounded-md border border-border bg-popover shadow-lg overflow-hidden"
          data-testid={testid ? `${testid}-mention-dropdown` : "mention-dropdown"}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30 flex items-center gap-1">
            <At size={11} /> Mention someone
          </div>
          {filtered.map((opt, i) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => insertPick(opt)}
              data-testid={`mention-opt-${opt.id}`}
              className={`w-full text-left px-3 py-2 hover:bg-amber-gradient-soft transition-colors flex flex-col ${i === activeIdx ? "bg-amber-gradient-soft" : ""}`}
            >
              <span className="text-sm text-foreground">{opt.name}</span>
              {opt.role && (
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {opt.role.replace("_", " ")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Render a body with `@Name` substrings highlighted as colored pills when
 * the corresponding ids are in `mentionIds`. Falls back to plain text when
 * there are no mentions. Use anywhere a stored message body is rendered. */
export function MentionBody({ body, mentionIds = [], optionsById = {} }) {
  if (!body) return null;
  if (mentionIds.length === 0) {
    return <span className="whitespace-pre-wrap">{body}</span>;
  }
  const tokens = [];
  let remaining = body;
  // Greedy match longest name first to avoid prefix clashes ("@Jane" vs "@Jane Doe")
  const sortedNames = mentionIds
    .map((id) => optionsById[id])
    .filter(Boolean)
    .sort((a, b) => (b.name || "").length - (a.name || "").length);
  // Each iteration carves off the next mention occurrence
  while (true) {
    let nextIdx = -1;
    let nextOpt = null;
    for (const opt of sortedNames) {
      const idx = remaining.indexOf(`@${opt.name}`);
      if (idx !== -1 && (nextIdx === -1 || idx < nextIdx)) {
        nextIdx = idx;
        nextOpt = opt;
      }
    }
    if (nextIdx === -1) {
      tokens.push(remaining);
      break;
    }
    if (nextIdx > 0) tokens.push(remaining.slice(0, nextIdx));
    tokens.push(
      <span
        key={`m-${tokens.length}`}
        data-testid={`mention-pill-${nextOpt.id}`}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-xs font-medium bg-amber-gradient-soft text-amber-700 dark:text-amber-300 border border-amber-500/30"
      >
        <At size={10} weight="bold" />
        {nextOpt.name}
      </span>
    );
    remaining = remaining.slice(nextIdx + `@${nextOpt.name}`.length);
  }
  return (
    <span className="whitespace-pre-wrap leading-relaxed">
      {tokens.map((t, i) => (typeof t === "string" ? <React.Fragment key={`t-${i}`}>{t}</React.Fragment> : t))}
    </span>
  );
}
