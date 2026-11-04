import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  ListPlus,
  PauseCircle,
  Pencil,
  PlayCircle,
  Radio,
  Settings as SettingsIcon,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { statusLabel, type CustomList } from "../lib/types";
import { useStore } from "../store";

function fmtUntil(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600)
    return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(s / 3600);
  if (h < 24)
    return `${h}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function NavItem({
  active,
  onClick,
  icon,
  label,
  indent = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  indent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex w-full items-center gap-2.5 py-[5px] pr-2 text-[12.5px] font-medium transition-colors ${
        indent ? "pl-7" : "pl-3"
      } ${
        active
          ? "bg-surface-2 text-fg"
          : "text-fg-muted hover:bg-surface-2/60 hover:text-fg"
      }`}
    >
      {active && (
        <span className="absolute bottom-[3px] left-0 top-[3px] w-[2px] bg-accent" />
      )}
      <span className={active ? "text-accent" : "text-fg-faint"}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function SectionRule({ title }: { title: string }) {
  return (
    <div className="mb-1 mt-5 flex items-center gap-2 px-3">
      <span className="label-caps">{title}</span>
      <span className="h-px flex-1 bg-edge" />
    </div>
  );
}

const ANIME_ITEMS = [
  { status: "CURRENT", icon: <PlayCircle size={14} strokeWidth={1.75} /> },
  { status: "COMPLETED", icon: <CheckCircle2 size={14} strokeWidth={1.75} /> },
  { status: "PAUSED", icon: <PauseCircle size={14} strokeWidth={1.75} /> },
  { status: "DROPPED", icon: <XCircle size={14} strokeWidth={1.75} /> },
  { status: "PLANNING", icon: <CircleDashed size={14} strokeWidth={1.75} /> },
];

function CustomListRow({
  list,
  active,
  dragging,
  dropTarget,
  confirming,
  onSelect,
  onDragState,
  onDropOn,
  onCommit,
  onRequestDelete,
  onDelete,
  onCancelDelete,
}: {
  list: CustomList;
  active: boolean;
  dragging: boolean;
  dropTarget: boolean;
  confirming: boolean;
  onSelect: () => void;
  onDragState: (s: { id: number; mediaType: string } | null) => void;
  onDropOn: (target: CustomList) => void;
  onCommit: (name: string) => void;
  onRequestDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(list.name);

  const commit = () => {
    const name = value.trim();
    setEditing(false);
    if (name && name !== list.name) onCommit(name);
    else setValue(list.name);
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-1 py-[3px] pl-7 pr-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
          delete “{list.name}”?
        </span>
        <button onClick={onDelete} className="btn btn-danger btn-sm h-5 px-1.5">
          Yes
        </button>
        <button onClick={onCancelDelete} className="btn btn-outline btn-sm h-5 px-1.5">
          No
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 py-[3px] pl-7 pr-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setValue(list.name);
              setEditing(false);
            }
          }}
          onBlur={commit}
          className="input h-6 min-w-0 flex-1 text-[11.5px]"
        />
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragState({ id: list.id, mediaType: list.mediaType });
      }}
      onDragEnd={() => onDragState(null)}
      onDragOver={(e) => {
        if (dragging) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn(list);
      }}
      className={`group relative ${
        dropTarget ? "border-t-2 border-accent" : "border-t-2 border-transparent"
      }`}
    >
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-2.5 py-[5px] pl-7 pr-14 text-[12.5px] font-medium transition-colors ${
          active
            ? "bg-surface-2 text-fg"
            : "text-fg-muted hover:bg-surface-2/60 hover:text-fg"
        }`}
      >
        {active && (
          <span className="absolute bottom-[4px] left-0 top-[4px] w-[2px] bg-accent" />
        )}
        <span className={active ? "text-accent" : "text-fg-faint"}>
          <BookOpen size={13} strokeWidth={1.75} />
        </span>
        <span className="truncate">{list.name}</span>
      </button>
      <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          title="Rename list"
          onClick={(e) => {
            e.stopPropagation();
            setValue(list.name);
            setEditing(true);
          }}
          className="btn btn-ghost btn-icon h-5 w-5"
        >
          <Pencil size={11} strokeWidth={1.75} />
        </button>
        <button
          title="Delete list"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
          className="btn btn-ghost btn-icon h-5 w-5 hover:text-danger"
        >
          <Trash2 size={11} strokeWidth={1.75} />
        </button>
      </span>
    </div>
  );
}

export function Sidebar() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const customLists = useStore((s) => s.customLists);
  const loadCustomLists = useStore((s) => s.loadCustomLists);
  const createCustomList = useStore((s) => s.createCustomList);
  const schedule = useStore((s) => s.schedule);
  const openEntrySheet = useStore((s) => s.openEntrySheet);
  const toast = useStore((s) => s.toast);
  const [adding, setAdding] = useState<"ANIME" | "MANGA" | null>(null);
  const [name, setName] = useState("");
  const [drag, setDrag] = useState<{ id: number; mediaType: string } | null>(null);
  const [dropOn, setDropOn] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const nextAiring = useMemo(() => {
    const rows = (schedule ?? []).filter(
      (s) =>
        s.inList &&
        s.entryStatus === "CURRENT" &&
        s.airingAt * 1000 > now,
    );
    rows.sort((a, b) => a.airingAt - b.airingAt);
    return rows[0] ?? null;
  }, [schedule, now]);

  const isList = (mt: string, st: string) =>
    tab.kind === "list" && tab.mediaType === mt && tab.status === st;
  const isCustom = (mt: string, id: number) =>
    tab.kind === "list" && tab.mediaType === mt && tab.customListId === id;

  const addList = async (mediaType: "ANIME" | "MANGA") => {
    if (!name.trim()) return;
    try {
      await createCustomList(mediaType, name.trim());
      await loadCustomLists();
      setName("");
      setAdding(null);
      toast("List created", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const deleteList = async (c: CustomList) => {
    setConfirmId(null);
    try {
      await api.deleteCustomList(c.id);
      await loadCustomLists();
      if (isCustom(c.mediaType, c.id))
        setTab({ kind: "list", mediaType: c.mediaType as "ANIME" | "MANGA", status: "CURRENT" });
      toast("List deleted");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const dropList = async (target: CustomList) => {
    const d = drag;
    setDrag(null);
    setDropOn(null);
    if (!d || d.mediaType !== target.mediaType || d.id === target.id) return;
    const arr = customLists.filter((c) => c.mediaType === target.mediaType);
    const from = arr.findIndex((c) => c.id === d.id);
    const to = arr.findIndex((c) => c.id === target.id);
    if (from < 0 || to < 0) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    try {
      await api.reorderCustomLists(arr.map((c) => c.id));
      await loadCustomLists();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const renderMediaSection = (mt: "ANIME" | "MANGA") => (
    <>
      {ANIME_ITEMS.map((it) => (
        <NavItem
          key={`${mt}-${it.status}`}
          active={isList(mt, it.status)}
          onClick={() => setTab({ kind: "list", mediaType: mt, status: it.status })}
          icon={it.icon}
          label={statusLabel(it.status, mt === "MANGA")}
        />
      ))}
      {customLists
        .filter((c) => c.mediaType === mt)
        .map((c) => (
          <div
            key={`${mt}-${c.id}`}
            onDragOver={() => {
              if (drag && drag.mediaType === mt && drag.id !== c.id) setDropOn(c.id);
            }}
            onDragLeave={() => setDropOn((v) => (v === c.id ? null : v))}
          >
            <CustomListRow
              list={c}
              active={isCustom(mt, c.id)}
              dragging={drag?.id === c.id}
              dropTarget={dropOn === c.id}
              confirming={confirmId === c.id}
              onSelect={() => setTab({ kind: "list", mediaType: mt, customListId: c.id })}
              onDragState={(s) => {
                setDrag(s);
                if (!s) setDropOn(null);
              }}
              onDropOn={dropList}
              onCommit={async (n) => {
                try {
                  await api.renameCustomList(c.id, n);
                  await loadCustomLists();
                } catch (e) {
                  toast(String(e), "error");
                }
              }}
              onDelete={() => void deleteList(c)}
              onRequestDelete={() => setConfirmId(c.id)}
              onCancelDelete={() => setConfirmId(null)}
            />
          </div>
        ))}
      <button
        onClick={() => setAdding((v) => (v === mt ? null : mt))}
        className="flex w-full items-center gap-2.5 py-[5px] pl-7 pr-2 text-[11.5px] font-medium text-fg-faint transition-colors hover:text-fg-muted"
      >
        <ListPlus size={13} strokeWidth={1.75} /> New custom list
      </button>
      {adding === mt && (
        <div className="mt-1 flex gap-1 px-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addList(mt);
              if (e.key === "Escape") setAdding(null);
            }}
            placeholder="List name"
            className="input h-6 text-[11px]"
          />
          <button
            onClick={() => addList(mt)}
            className="btn btn-primary btn-sm px-2"
            title="Create list"
          >
            +
          </button>
        </div>
      )}
    </>
  );

  return (
    <aside className="flex w-[218px] shrink-0 flex-col border-r border-edge bg-surface">
      <div className="flex items-center gap-2.5 px-3 pb-2 pt-4">
        <div className="stamp h-7 w-7 bg-accent/10 text-[13px] font-bold text-accent">
          E
        </div>
        <div className="leading-none">
          <div className="display text-[15px] font-semibold tracking-tight">
            Estenyac
          </div>
          <div className="label-caps mt-1 !text-[8.5px]">list · tracker</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        <div className="mt-2">
          <SectionRule title="Anime" />
          <NavItem
            active={tab.kind === "airing"}
            onClick={() => setTab({ kind: "airing", mediaType: "ANIME" })}
            icon={<Radio size={14} strokeWidth={1.75} />}
            label="Airing this week"
          />
          {renderMediaSection("ANIME")}
        </div>

        <div className="mt-2">
          <SectionRule title="Manga" />
          {renderMediaSection("MANGA")}
        </div>
      </div>

      {nextAiring && (
        <div className="border-t border-edge px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="label-caps flex items-center gap-1.5">
              <Radio size={10} strokeWidth={1.75} className="text-accent" />
              next episode
            </span>
            <span className="font-mono text-[9.5px] text-accent tnum">
              {fmtUntil(nextAiring.airingAt * 1000 - now)}
            </span>
          </div>
          <button
            onClick={() =>
              nextAiring.entryId != null
                ? openEntrySheet(nextAiring.entryId)
                : setTab({ kind: "airing", mediaType: "ANIME" })
            }
            className="mt-1 block w-full truncate text-left text-[11.5px] font-medium text-fg-muted transition-colors hover:text-fg"
            title={nextAiring.titleRomaji ?? nextAiring.titleEnglish ?? "Untitled"}
          >
            <span className="font-mono text-[9.5px] text-fg-faint">
              ep {nextAiring.episode} ·
            </span>{" "}
            {nextAiring.titleRomaji ?? nextAiring.titleEnglish ?? "Untitled"}
          </button>
        </div>
      )}

      <div className="border-t border-edge py-1.5">
        <NavItem
          active={tab.kind === "stats"}
          onClick={() => setTab({ kind: "stats" })}
          icon={<BarChart3 size={14} strokeWidth={1.75} />}
          label="Statistics"
        />
        <NavItem
          active={tab.kind === "settings"}
          onClick={() => setTab({ kind: "settings" })}
          icon={<SettingsIcon size={14} strokeWidth={1.75} />}
          label="Settings"
        />
      </div>
    </aside>
  );
}
