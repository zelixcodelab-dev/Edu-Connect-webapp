import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Megaphone, X, ArrowRight, CalendarBlank, At } from "@phosphor-icons/react";

const PRIO_CLS = {
  urgent: "border-rose-500/40 bg-rose-50/60 dark:bg-rose-500/10",
  normal: "border-amber-500/30 bg-amber-gradient-soft",
  low:    "border-border bg-card",
};
const PRIO_ICON_CLS = {
  urgent: "text-rose-700 dark:text-rose-400",
  normal: "text-amber-700 dark:text-amber-400",
  low:    "text-muted-foreground",
};

/** Pinned banner stack of un-dismissed announcement messages addressed to me.
 * Polls `/messages/banners` on mount + when bumper changes. Each banner has a
 * dismiss button that hides it forever for THIS user only.
 */
export default function AnnouncementBanners({ bumper = 0 }) {
  const { user } = useAuth();
  const myId = user?.id;
  const [banners, setBanners] = useState([]);

  const load = async () => {
    try {
      const r = await api.get("/messages/banners");
      setBanners(r.data || []);
    } catch (_e) { /* silent */ }
  };

  useEffect(() => { load(); }, [bumper]);

  const dismiss = async (id) => {
    try {
      await api.post(`/messages/${id}/dismiss`);
      setBanners((b) => b.filter((x) => x.id !== id));
    } catch (_e) { /* silent */ }
  };

  if (banners.length === 0) return null;

  return (
    <section className="space-y-2" data-testid="announcement-banners">
      {banners.map((b) => {
        const prio = b.priority || "normal";
        const mentionedMe = myId && (b.mentions || []).includes(myId);
        return (
          <div
            key={b.id}
            data-testid={`banner-${b.id}`}
            className={`rounded-lg border ${mentionedMe ? "border-orange-500/60 ring-2 ring-orange-500/20 " : ""}${PRIO_CLS[prio]} px-4 py-3 flex items-start gap-3`}
          >
            <Megaphone size={18} weight="duotone" className={`${PRIO_ICON_CLS[prio]} mt-0.5 shrink-0`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {prio === "urgent" && (
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-rose-700 dark:text-rose-400">
                    URGENT
                  </span>
                )}
                {mentionedMe && (
                  <span
                    data-testid={`banner-mentioned-${b.id}`}
                    className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider font-semibold text-orange-700 dark:text-orange-400 bg-amber-gradient-soft border border-orange-500/40 px-1.5 py-0.5 rounded-full"
                  >
                    <At size={9} weight="bold" /> You
                  </span>
                )}
                <p className="text-sm font-semibold text-foreground" data-testid={`banner-subject-${b.id}`}>
                  {b.subject}
                </p>
              </div>
              <p className="text-xs text-foreground/80 mt-1 line-clamp-2">{b.body}</p>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                <span>From {b.sender_name}</span>
                {b.due_date && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarBlank size={10} /> Due {new Date(b.due_date).toLocaleDateString()}
                  </span>
                )}
                <Link
                  to={`/messages/${b.id}`}
                  data-testid={`banner-open-${b.id}`}
                  className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 hover:underline"
                >
                  Open <ArrowRight size={10} />
                </Link>
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismiss(b.id)}
              className="text-muted-foreground hover:text-foreground p-1 -mr-1 shrink-0"
              data-testid={`banner-dismiss-${b.id}`}
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </section>
  );
}
