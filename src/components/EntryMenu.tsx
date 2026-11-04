import {
  BookOpen,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { STATUSES, statusLabel } from "../lib/types";
import type { EntryView } from "../lib/types";
import { useStore } from "../store";
import { Dropdown } from "./Dropdown";

export function EntryMenu({
  entry,
  triggerClassName = "btn btn-ghost btn-icon btn-sm opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
}: {
  entry: EntryView;
  triggerClassName?: string;
}) {
  const update = useStore((s) => s.updateEntry);
  const removeEntry = useStore((s) => s.removeEntry);
  const removeEntryLocal = useStore((s) => s.removeEntryLocal);
  const customLists = useStore((s) => s.customLists);
  const toast = useStore((s) => s.toast);
  const [searching, setSearching] = useState(false);

  const manga = entry.mediaType === "MANGA";

  const changeStatus = async (st: string) => {
    await update({ id: entry.id, status: st });
    toast(`${entry.title ?? "Entry"} → ${statusLabel(st, manga)}`, "success");
  };

  const bump = async (delta: number) => {
    const next = Math.max(
      0,
      Math.min(entry.total ?? 99999, entry.progress + delta),
    );
    await update({ id: entry.id, progress: next });
  };

  const remove = async () => {
    await removeEntry(entry.id);
    removeEntryLocal(entry.id);
    toast("Removed from list", "success");
  };

  const searchReleases = async () => {
    setSearching(true);
    try {
      const nextEp = entry.progress + 1;
      const found = await api.searchReleasesNow(entry.anilistId, nextEp);
      toast(
        found
          ? `Found ${found} release(s) for ep ${nextEp}`
          : `No releases found for ep ${nextEp}`,
        found ? "success" : "info",
      );
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setSearching(false);
    }
  };

  const moveToList = async (customListId: number | null) => {
    // patchEntryLocal re-buckets the entry into/out of loaded list views
    await update({
      id: entry.id,
      customListId: customListId ?? -1,
    });
  };

  return (
    <Dropdown
      trigger={
        <button className={triggerClassName} title="Entry actions">
          <MoreHorizontal size={14} strokeWidth={1.75} />
        </button>
      }
      align="right"
    >
      {(close) => (
        <div className="max-h-72 overflow-y-auto py-0.5">
          <button
            className="menu-item text-accent"
            onClick={() => {
              close();
              bump(1);
            }}
          >
            <Plus size={13} strokeWidth={2} /> +1 {manga ? "chapter" : "episode"}
          </button>
          {!manga && (
            <button
              className="menu-item"
              disabled={searching}
              onClick={() => {
                close();
                searchReleases();
              }}
            >
              {searching ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Search size={13} strokeWidth={1.75} />
              )}
              Search latest release
            </button>
          )}
          <div className="menu-rule" />
          {STATUSES.filter((s) => s !== entry.status).map((s) => (
            <button
              key={s}
              className="menu-item"
              onClick={() => {
                close();
                changeStatus(s);
              }}
            >
              {statusLabel(s, manga)}
            </button>
          ))}
          {customLists.some((c) => c.mediaType === entry.mediaType) && (
            <>
              <div className="menu-rule" />
              {customLists
                .filter((c) => c.mediaType === entry.mediaType)
                .map((c) => (
                  <button
                    key={c.id}
                    className={`menu-item ${entry.customListId === c.id ? "text-accent" : ""}`}
                    onClick={() => {
                      close();
                      moveToList(entry.customListId === c.id ? null : c.id);
                    }}
                  >
                    <BookOpen size={13} strokeWidth={1.75} />
                    {entry.customListId === c.id ? "★ " : ""}
                    {c.name}
                  </button>
                ))}
            </>
          )}
          <div className="menu-rule" />
          <button
            className="menu-item menu-item-danger"
            onClick={() => {
              close();
              remove();
            }}
          >
            <Trash2 size={13} strokeWidth={1.75} /> Remove
          </button>
        </div>
      )}
    </Dropdown>
  );
}
