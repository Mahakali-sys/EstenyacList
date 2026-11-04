import { X } from "lucide-react";
import { useState } from "react";
import {
  SCORE_TIERS,
  statusLabel,
  STATUSES,
  type CustomList,
} from "../lib/types";
import { useStore } from "../store";
import { Btn, IconBtn, Label, Toggle, useEscape } from "./ui";

export function BulkEditDialog({
  ids,
  mediaType,
  customLists,
  onClose,
  onApplied,
}: {
  ids: number[];
  mediaType: "ANIME" | "MANGA";
  customLists: CustomList[];
  onClose: () => void;
  onApplied?: () => void;
}) {
  useEscape(true, onClose);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);

  const [statusOn, setStatusOn] = useState(false);
  const [status, setStatus] = useState("CURRENT");
  const [scoreOn, setScoreOn] = useState(false);
  const [score, setScore] = useState(8);
  const [startOn, setStartOn] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [finishOn, setFinishOn] = useState(false);
  const [finishDate, setFinishDate] = useState("");
  const [listOn, setListOn] = useState(false);
  const [listId, setListId] = useState<number | -1>(-1);

  const manga = mediaType === "MANGA";
  const any = statusOn || scoreOn || startOn || finishOn || listOn;

  const apply = async () => {
    if (!any || busy) return;
    setBusy(true);
    const patch: {
      status?: string;
      score?: number;
      startDate?: string;
      finishDate?: string;
      customListId?: number;
    } = {};
    if (statusOn) patch.status = status;
    if (scoreOn) patch.score = score;
    if (startOn) patch.startDate = startDate;
    if (finishOn) patch.finishDate = finishDate;
    if (listOn) patch.customListId = listId;
    try {
      const ok = await useStore.getState().bulkUpdate(ids, patch);
      toast(`Updated ${ok} ${ok === 1 ? "entry" : "entries"}`, "success");
      onApplied?.();
      onClose();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const dateRow = (
    label: string,
    on: boolean,
    setOn: (v: boolean) => void,
    value: string,
    setValue: (v: string) => void,
    hint: string,
  ) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <Toggle checked={on} onChange={setOn} label={label} />
      <div className="flex items-center gap-2">
        <input
          type="date"
          disabled={!on}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input h-7 w-36 text-[11px] disabled:opacity-40"
        />
        <span className="w-28 text-right text-[9.5px] leading-tight text-fg-faint">
          {on ? (value ? "" : hint) : ""}
        </span>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="anim-toast relative w-[380px] max-w-full border border-edge bg-surface shadow-[var(--shadow-pop)]">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <div className="label-caps">
            bulk edit · {ids.length} {ids.length === 1 ? "entry" : "entries"}
          </div>
          <IconBtn title="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </IconBtn>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-3 border-b border-edge-2 py-2">
            <Toggle checked={statusOn} onChange={setStatusOn} label="Status" />
            <select
              disabled={!statusOn}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="input h-7 w-36 text-[11px] disabled:opacity-40"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s, manga)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-3 border-b border-edge-2 py-2">
            <Toggle checked={scoreOn} onChange={setScoreOn} label="Score" />
            <select
              disabled={!scoreOn}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              className="input h-7 w-36 text-[11px] disabled:opacity-40"
            >
              {SCORE_TIERS.map((t) => (
                <option key={t.tier} value={t.value}>
                  {t.face} {t.label} ({t.range})
                </option>
              ))}
              <option value={0}>clear score</option>
            </select>
          </div>

          <div className="border-b border-edge-2">
            {dateRow("Start date", startOn, setStartOn, startDate, setStartDate, "empty clears")}
          </div>
          <div className="border-b border-edge-2">
            {dateRow("Finish date", finishOn, setFinishOn, finishDate, setFinishDate, "empty clears")}
          </div>

          <div className="flex items-center justify-between gap-3 py-2">
            <Toggle checked={listOn} onChange={setListOn} label="Custom list" />
            <select
              disabled={!listOn}
              value={listId}
              onChange={(e) => setListId(Number(e.target.value))}
              className="input h-7 w-36 text-[11px] disabled:opacity-40"
            >
              <option value={-1}>No custom list</option>
              {customLists
                .filter((c) => c.mediaType === mediaType)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          <Label className="mt-1">only checked fields are applied</Label>
        </div>

        <div className="flex justify-end gap-2 border-t border-edge px-4 py-2.5">
          <Btn size="sm" onClick={onClose}>
            Cancel
          </Btn>
          <Btn size="sm" variant="primary" disabled={!any || busy} onClick={() => void apply()}>
            Apply to {ids.length}
          </Btn>
        </div>
      </div>
    </div>
  );
}
