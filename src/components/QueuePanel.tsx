import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  ListVideo,
  Magnet,
  Play,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import type { QueueItem } from "../lib/types";
import { useStore } from "../store";
import { Btn, EmptyState, IconBtn, Toggle, useEscape } from "./ui";

function ago(ts: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function QueuePanel() {
  const open = useStore((s) => s.queueOpen);
  const setOpen = useStore((s) => s.setQueueOpen);
  const queue = useStore((s) => s.queue);
  const removeItem = useStore((s) => s.queueRemove);
  const clear = useStore((s) => s.queueClear);
  const reorder = useStore((s) => s.queueReorder);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ id: number; after: boolean } | null>(
    null,
  );

  useEscape(open, () => setOpen(false));

  if (!open) return null;

  const apply = (next: QueueItem[]) => {
    void reorder(next.map((q) => q.id));
  };

  const moveBy = (id: number, delta: number) => {
    const from = queue.findIndex((q) => q.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= queue.length) return;
    const next = queue.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    apply(next);
  };

  const moveTo = (fromId: number, toId: number, after: boolean) => {
    const from = queue.findIndex((q) => q.id === fromId);
    const to = queue.findIndex((q) => q.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = queue.slice();
    const [item] = next.splice(from, 1);
    let insert = to + (after ? 1 : 0);
    if (from < to) insert -= 1;
    insert = Math.max(0, Math.min(insert, next.length));
    next.splice(insert, 0, item);
    apply(next);
  };

  const play = async (item: QueueItem) => {
    const st = useStore.getState();
    const ok = await st.playerPlay(
      item.magnet,
      item.title,
      item.entryId,
      item.episode,
    );
    if (ok) {
      await removeItem(item.id);
      setOpen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />
      <div className="anim-sheet absolute right-0 top-0 flex h-full w-[360px] max-w-full flex-col border-l border-edge bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <div>
            <div className="label-caps">watch queue</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="display text-[17px] font-semibold leading-none">
                {queue.length} queued
              </span>
              <span className="font-mono text-[10px] text-fg-faint">
                drag rows to reorder
              </span>
            </div>
          </div>
          <IconBtn title="Close queue" onClick={() => setOpen(false)}>
            <X size={15} />
          </IconBtn>
        </div>

        {queue.length > 0 && (
          <div className="border-b border-edge px-4 py-3">
            <Btn
              variant="primary"
              className="w-full"
              onClick={() => void play(queue[0])}
              icon={<Play size={13} className="shrink-0" />}
              title={`Play next — ${queue[0].title}`}
            >
              <span className="min-w-0 truncate">
                Play next — {queue[0].title}
              </span>
            </Btn>
            <div className="mt-2.5 flex items-center justify-between">
              <Toggle
                checked={settings.queueAutoAdvance !== false}
                onChange={(v) => setSetting("queueAutoAdvance", v)}
                label="Auto-advance after each episode"
              />
            </div>
            <div className="mt-1 flex items-center gap-1 font-mono text-[9px] text-fg-faint">
              <Zap size={9} strokeWidth={1.75} />
              when an episode ends, the next queued one starts automatically
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {queue.length === 0 ? (
            <EmptyState
              icon={<ListVideo size={26} strokeWidth={1.5} />}
              title="Nothing queued"
              sub="Queue releases from any detail sheet to watch them later."
            />
          ) : (
            <div>
              {queue.map((q, i) => (
                <div
                  key={q.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(q.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(q.id));
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropAt(null);
                  }}
                  onDragOver={(e) => {
                    if (dragId == null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const r = e.currentTarget.getBoundingClientRect();
                    const after = e.clientY > r.top + r.height / 2;
                    if (dropAt?.id !== q.id || dropAt.after !== after) {
                      setDropAt({ id: q.id, after });
                    }
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node | null))
                      return;
                    setDropAt((cur) => (cur?.id === q.id ? null : cur));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId != null) {
                      const r = e.currentTarget.getBoundingClientRect();
                      moveTo(dragId, q.id, e.clientY > r.top + r.height / 2);
                    }
                    setDragId(null);
                    setDropAt(null);
                  }}
                  className={`group relative flex items-start gap-2 border-b border-edge px-2 py-2.5 transition-colors hover:bg-surface-2/60 ${
                    dragId === q.id ? "opacity-40" : ""
                  } ${dropAt?.id === q.id && dragId !== q.id ? "bg-accent/10" : ""}`}
                >
                  {dropAt?.id === q.id && dragId !== q.id && (
                    <span
                      className={`pointer-events-none absolute inset-x-0 h-0.5 bg-accent ${
                        dropAt.after ? "bottom-0" : "top-0"
                      }`}
                    />
                  )}
                  <span
                    className="mt-1 flex w-4 shrink-0 cursor-grab items-center justify-center text-fg-faint active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    <GripVertical size={12} strokeWidth={1.75} />
                  </span>
                  <span className="mt-0.5 w-5 shrink-0 text-center font-mono text-[10.5px] text-fg-faint tnum">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[12px] font-semibold leading-snug">
                      {q.title}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-fg-faint">
                      {q.size ? `${q.size} · ` : ""}
                      {ago(q.addedAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-center opacity-60 transition-opacity group-hover:opacity-100">
                    <IconBtn
                      title="Move up"
                      onClick={() => moveBy(q.id, -1)}
                      disabled={i === 0}
                      className="disabled:opacity-30"
                    >
                      <ChevronUp size={12} strokeWidth={2} />
                    </IconBtn>
                    <IconBtn
                      title="Move down"
                      onClick={() => moveBy(q.id, 1)}
                      disabled={i === queue.length - 1}
                      className="disabled:opacity-30"
                    >
                      <ChevronDown size={12} strokeWidth={2} />
                    </IconBtn>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                    <IconBtn
                      title="Open in mpv"
                      onClick={() => void play(q)}
                      className="border border-edge bg-surface-2"
                    >
                      <Magnet size={12} strokeWidth={1.75} />
                    </IconBtn>
                    <IconBtn
                      title="Remove from queue"
                      onClick={() => void removeItem(q.id)}
                    >
                      <Trash2 size={12} strokeWidth={1.75} />
                    </IconBtn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {queue.length > 0 && (
          <div className="border-t border-edge p-3">
            <Btn variant="danger" size="sm" className="w-full" onClick={() => void clear()} icon={<Trash2 size={12} />}>
              Clear queue
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
