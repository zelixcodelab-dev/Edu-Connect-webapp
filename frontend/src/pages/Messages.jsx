import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Megaphone, Clock, PaperPlaneRight, Trash, ArrowLeft, MagnifyingGlass,
  PlusCircle, CalendarBlank, Users as UsersIcon, Warning,
} from "@phosphor-icons/react";
import { formatDate } from "@/lib/format";

import ComposeMessageDialog from "@/components/messages/ComposeMessageDialog";
import MentionTextarea, { MentionBody } from "@/components/messages/MentionTextarea";

const KIND_BADGE = {
  announcement: { label: "Announcement", icon: Megaphone, cls: "bg-amber-100/60 text-amber-700 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30" },
  reminder:     { label: "Reminder",     icon: Clock,     cls: "bg-sky-100/60 text-sky-700 border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30" },
};
const PRIORITY_BADGE = {
  low:    { label: "Low",    cls: "bg-muted/50 text-muted-foreground border-border" },
  normal: { label: "Normal", cls: "bg-muted/50 text-muted-foreground border-border" },
  urgent: { label: "URGENT", cls: "bg-rose-100/60 text-rose-700 border-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30" },
};

function ThreadList({ items, currentUser, onSelect, selectedId }) {
  if (items.length === 0) {
    return (
      <Card className="card-premium p-10 text-center text-sm text-muted-foreground" data-testid="messages-empty">
        Nothing here yet. Tap <PlusCircle size={14} weight="duotone" className="inline mx-0.5" /> Compose to send your first message.
      </Card>
    );
  }
  return (
    <ul className="space-y-2" data-testid="messages-list">
      {items.map((m) => {
        const meta = KIND_BADGE[m.kind] || KIND_BADGE.announcement;
        const Icon = meta.icon;
        const prio = PRIORITY_BADGE[m.priority] || PRIORITY_BADGE.normal;
        const isMine = m.sender_id === currentUser?.id;
        const unread = !isMine && !m.my_read;
        return (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onSelect(m.id)}
              data-testid={`msg-row-${m.id}`}
              className={`w-full text-left rounded-lg border p-3 flex items-start gap-3 transition-all ${
                selectedId === m.id
                  ? "border-orange-500/60 bg-amber-gradient-soft"
                  : "border-border bg-card hover:border-orange-500/30"
              }`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${meta.cls} shrink-0`}>
                <Icon size={15} weight="bold" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {unread && <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" data-testid={`msg-unread-${m.id}`} />}
                  <p className="text-sm font-medium text-foreground truncate flex-1">{m.subject}</p>
                  {m.priority === "urgent" && (
                    <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${prio.cls}`}>
                      {prio.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{m.body}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1.5">
                  <span className="uppercase tracking-wider">
                    {isMine ? `To ${m.recipient_ids?.length || 0}` : `From ${m.sender_name}`}
                  </span>
                  <span>·</span>
                  <span>{formatDate(m.created_at)}</span>
                  {m.due_date && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <CalendarBlank size={10} /> due {formatDate(m.due_date)}
                      </span>
                    </>
                  )}
                  {m.reply_count > 0 && (
                    <>
                      <span>·</span>
                      <span>{m.reply_count} repl{m.reply_count === 1 ? "y" : "ies"}</span>
                    </>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ThreadView({ id, currentUser, onClose, onChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [replyMentions, setReplyMentions] = useState([]);
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/messages/${id}`);
      setData(r.data);
      // mark read if I'm a recipient and not yet read
      if (r.data?.root && !r.data.root.my_read
          && (r.data.root.recipient_ids || []).includes(currentUser?.id)) {
        await api.post(`/messages/${id}/read`);
        onChange?.();
      }
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not load thread");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const submit = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/messages/${id}/replies`, {
        body: reply.trim(),
        mentions: replyMentions,
      });
      setReply("");
      setReplyMentions([]);
      load();
      onChange?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not reply");
    } finally {
      setSending(false);
    }
  };

  const removeThread = async () => {
    if (!window.confirm("Delete this thread for everyone?")) return;
    try {
      await api.delete(`/messages/${id}`);
      toast.success("Thread deleted");
      onClose();
      onChange?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Delete failed");
    }
  };

  if (loading) {
    return <Card className="card-premium p-10 text-center text-sm text-muted-foreground">Loading…</Card>;
  }
  if (!data?.root) return null;

  const root = data.root;
  const meta = KIND_BADGE[root.kind] || KIND_BADGE.announcement;
  const Icon = meta.icon;
  const replies = data.replies || [];
  const canDelete = root.sender_id === currentUser?.id;

  // Build a lookup of {id → {id, name, role}} for every participant so the
  // mention renderer can pull display names without an extra fetch.
  const participants = [
    { id: root.sender_id, name: root.sender_name, role: root.sender_role },
    ...(root.recipient_summary || []),
  ];
  const optionsById = participants.reduce((acc, p) => {
    if (p?.id) acc[p.id] = p;
    return acc;
  }, {});
  // Reply mention options exclude the current user.
  const replyMentionOptions = participants.filter((p) => p.id !== currentUser?.id);

  return (
    <Card className="card-premium overflow-hidden" data-testid="thread-view">
      <header className="px-5 py-4 border-b border-border flex items-start gap-3">
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1 -ml-1 lg:hidden"
          data-testid="thread-back"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.cls}`}>
              <Icon size={11} weight="bold" />
              {meta.label}
            </span>
            {root.priority === "urgent" && (
              <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${PRIORITY_BADGE.urgent.cls}`}>
                {PRIORITY_BADGE.urgent.label}
              </span>
            )}
            {root.due_date && (
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <CalendarBlank size={10} /> Due {formatDate(root.due_date)}
              </span>
            )}
          </div>
          <h2 className="font-display text-xl mt-1 leading-tight" data-testid="thread-subject">{root.subject}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            From <span className="text-foreground font-medium">{root.sender_name}</span>
            {" · "}{formatDate(root.created_at)}
            {root.recipient_summary?.length > 0 && (
              <>
                {" · "}
                <span className="inline-flex items-center gap-1">
                  <UsersIcon size={11} />
                  {root.recipient_summary.length} recipient{root.recipient_summary.length === 1 ? "" : "s"}
                </span>
              </>
            )}
          </p>
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={removeThread}
            data-testid="thread-delete"
            className="text-muted-foreground hover:text-rose-600 p-1.5"
            title="Delete thread"
          >
            <Trash size={15} />
          </button>
        )}
      </header>

      <div className="p-5 space-y-4 max-h-[55vh] overflow-y-auto" data-testid="thread-body">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-sm text-foreground">
            <MentionBody body={root.body} mentionIds={root.mentions || []} optionsById={optionsById} />
          </p>
        </div>
        {replies.map((r) => (
          <div key={r.id} className={`rounded-lg border p-3 ${
            r.sender_id === currentUser?.id
              ? "ml-6 border-orange-500/30 bg-amber-gradient-soft/40"
              : "mr-6 border-border bg-card"
          }`} data-testid={`reply-${r.id}`}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              {r.sender_name} · {formatDate(r.created_at)}
            </p>
            <p className="text-sm text-foreground">
              <MentionBody body={r.body} mentionIds={r.mentions || []} optionsById={optionsById} />
            </p>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3 bg-muted/20" data-testid="reply-composer">
        <MentionTextarea
          value={reply}
          onChange={setReply}
          rows={2}
          placeholder="Write a reply… (type @ to mention)"
          testid="reply-textarea"
          options={replyMentionOptions}
          mentions={replyMentions}
          onMentionsChange={setReplyMentions}
          className="bg-card"
        />
        <div className="flex justify-between items-center mt-2">
          <p className="text-[10px] text-muted-foreground">
            {replyMentions.length > 0 && (
              <span data-testid="reply-mentions-count">
                Highlighting {replyMentions.length} {replyMentions.length === 1 ? "person" : "people"}
              </span>
            )}
          </p>
          <Button
            type="button"
            onClick={submit}
            disabled={!reply.trim() || sending}
            className="btn-amber border-0 h-9"
            data-testid="reply-send"
          >
            <PaperPlaneRight size={14} className="mr-1.5" />
            {sending ? "Sending…" : "Send reply"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const { id: routeId } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [folder, setFolder] = useState("inbox");
  const [kindFilter, setKindFilter] = useState("all");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [bumper, setBumper] = useState(0);

  // Deep-link support: /messages?compose=1 auto-opens the composer. Used by
  // the Staff dashboard's "Reminder to office admin" quick action so the flow
  // happens inside the Messages page (in-context reply-all + threading UX).
  useEffect(() => {
    if (searchParams.get("compose") === "1") {
      setComposeOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("compose");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = async () => {
    setLoading(true);
    try {
      const q = `folder=${folder}${kindFilter !== "all" ? `&kind=${kindFilter}` : ""}`;
      const r = await api.get(`/messages?${q}`);
      setItems(r.data || []);
    } catch (e) {
      toast.error("Could not load messages");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, kindFilter, bumper]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const s = search.toLowerCase();
    return items.filter(
      (m) => m.subject?.toLowerCase().includes(s) || m.body?.toLowerCase().includes(s)
    );
  }, [items, search]);

  const select = (id) => nav(`/messages/${id}`);

  const canCompose = user?.role === "super_admin"
    || user?.role === "office_admin"
    || user?.role === "user"
    || user?.role === "staff";

  return (
    <div className="space-y-6 animate-fade-in" data-testid="messages-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">Inbox</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2">Messages</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Announcements and reminders across your team.
          </p>
        </div>
        {canCompose && (
          <Button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="h-10 btn-amber border-0 self-start sm:self-auto"
            data-testid="compose-btn"
          >
            <PlusCircle size={16} className="mr-1.5" /> New message
          </Button>
        )}
      </header>

      {/* Folder + kind tabs */}
      <div className="flex flex-wrap gap-2" data-testid="messages-tabs">
        {[
          { v: "inbox", label: "Inbox" },
          { v: "sent",  label: "Sent" },
        ].map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => setFolder(t.v)}
            data-testid={`tab-folder-${t.v}`}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              folder === t.v ? "bg-amber-gradient text-white shadow-md shadow-orange-500/25"
                              : "bg-card border border-border text-foreground hover:bg-muted/40"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="hidden sm:inline-block w-px bg-border self-stretch mx-1" />
        {[
          { v: "all",          label: "All" },
          { v: "announcement", label: "Announcements" },
          { v: "reminder",     label: "Reminders" },
        ].map((k) => (
          <button
            key={k.v}
            type="button"
            onClick={() => setKindFilter(k.v)}
            data-testid={`tab-kind-${k.v}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              kindFilter === k.v
                ? "border-orange-500/50 bg-amber-gradient-soft text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by subject or body…"
          className="pl-9 bg-card"
          data-testid="messages-search"
        />
      </div>

      {/* Layout: list + thread view side-by-side on desktop, swap on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.4fr] gap-4">
        <div className={routeId ? "hidden lg:block" : ""}>
          {loading ? (
            <Card className="card-premium p-10 text-center text-sm text-muted-foreground">Loading…</Card>
          ) : (
            <ThreadList items={filtered} currentUser={user} onSelect={select} selectedId={routeId} />
          )}
        </div>
        <div className={routeId ? "" : "hidden lg:block"}>
          {routeId ? (
            <ThreadView
              id={routeId}
              currentUser={user}
              onClose={() => nav("/messages")}
              onChange={() => setBumper((n) => n + 1)}
            />
          ) : (
            <Card className="card-premium p-12 text-center text-sm text-muted-foreground" data-testid="thread-placeholder">
              <Megaphone size={28} className="mx-auto text-muted-foreground/50 mb-2" />
              Pick a message from the list to read it here.
            </Card>
          )}
        </div>
      </div>

      <ComposeMessageDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSent={() => { setFolder("sent"); setBumper((n) => n + 1); }}
      />
    </div>
  );
}
