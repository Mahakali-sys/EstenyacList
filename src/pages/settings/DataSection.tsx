import { listen } from "@tauri-apps/api/event";
import {
  Archive,
  Database,
  Download,
  History,
  ImageDown,
  Loader2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, Btn, Label, Panel } from "../../components/ui";
import { api } from "../../lib/api";
import type { BackupInfo } from "../../lib/types";
import { DEFAULT_TIME_ZONE } from "../../lib/types";
import { useStore } from "../../store";

const LBL = "mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint";

export function DataSection() {
  const toast = useStore((s) => s.toast);
  const timeZone = useStore((s) => s.settings.timeZone ?? DEFAULT_TIME_ZONE);
  const importPhase = useStore((s) => s.importPhase);
  const importReport = useStore((s) => s.importReport);
  const setImportReport = useStore((s) => s.setImportReport);
  const refreshEntries = useStore((s) => s.refreshEntries);
  const loadCustomLists = useStore((s) => s.loadCustomLists);

  const [dbPath, setDbPath] = useState("");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [redownloading, setRedownloading] = useState(false);
  const [coversProgress, setCoversProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    api.getDbPath().then(setDbPath);
    api.listBackups().then(setBackups).catch(() => {});
    let unlisten: (() => void) | undefined;
    listen<{ processed: number; total: number }>("covers-progress", (e) => {
      setCoversProgress(e.payload);
    }).then((un) => {
      unlisten = un;
    });
    return () => unlisten?.();
  }, []);

  const doExport = async () => {
    try {
      const msg = await api.exportMal();
      toast(msg, "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const doImport = async () => {
    try {
      setImportReport(null);
      const report = await api.importMal();
      setImportReport(report);
      toast(
        `Import done: +${report.added} added, ${report.skipped} skipped, ${report.failed} failed`,
        report.failed === 0 ? "success" : "info",
      );
      refreshEntries();
      loadCustomLists();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const doBackupNow = async () => {
    setBackingUp(true);
    try {
      const path = await api.runBackup(true);
      toast(`Backup written: ${path}`, "success");
      setBackups(await api.listBackups());
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBackingUp(false);
    }
  };

  const doRestore = async (name?: string) => {
    setRestoring(true);
    try {
      setImportReport(null);
      const report = await api.restoreBackup(name);
      setImportReport(report);
      toast(
        `Restore done: +${report.added} added, ${report.skipped} already in list, ${report.failed} failed`,
        report.failed === 0 ? "success" : "info",
      );
      refreshEntries();
      loadCustomLists();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setRestoring(false);
    }
  };

  const doRedownload = async () => {
    setRedownloading(true);
    setCoversProgress({ processed: 0, total: 0 });
    try {
      const n = await api.redownloadCovers();
      toast(`Re-cached ${n} cover${n === 1 ? "" : "s"} (JPEG XL, quality 95)`, "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setRedownloading(false);
      setCoversProgress(null);
    }
  };

  const importPct = importPhase
    ? Math.round((importPhase.processed / Math.max(1, importPhase.total)) * 100)
    : 0;

  return (
    <div className="grid gap-2.5">
      <Panel className="p-4">
        <Label right={<Database size={12} strokeWidth={1.75} className="text-accent" />}>
          your data
        </Label>
        <div className="mt-3">
          <div className={LBL}>portable database (next to the .exe)</div>
          <div className="break-all font-mono text-[10.5px] text-fg-muted">{dbPath}</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-edge pt-3">
          <Btn
            variant="primary"
            size="sm"
            onClick={doExport}
            icon={<Download size={11} strokeWidth={1.75} />}
          >
            Export MAL XML
          </Btn>
          <Btn
            size="sm"
            onClick={doImport}
            icon={<Upload size={11} strokeWidth={1.75} />}
          >
            Import MAL XML
          </Btn>
          <Btn
            size="sm"
            onClick={() => void doRedownload()}
            disabled={redownloading}
            icon={
              redownloading ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <ImageDown size={11} strokeWidth={1.75} />
              )
            }
          >
            Redownload covers
          </Btn>
          <Btn
            size="sm"
            variant="danger"
            onClick={async () => {
              try {
                await api.clearImageCache();
                toast("Image cache cleared — use Redownload covers to refill it", "success");
              } catch (e) {
                toast(String(e), "error");
              }
            }}
          >
            Clear image cache
          </Btn>
        </div>

        {coversProgress && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between font-mono text-[10px]">
              <span className="text-fg-muted">re-downloading covers…</span>
              <span className="text-fg-faint tnum">
                {coversProgress.processed}/{coversProgress.total}
              </span>
            </div>
            <Bar
              pct={(coversProgress.processed / Math.max(1, coversProgress.total)) * 100}
            />
          </div>
        )}

        <div className="mt-3 font-mono text-[9.5px] leading-relaxed text-fg-faint">
          import reads your AniList export (MAL format, e.g. scrape_anilistanime.xml);
          each entry is matched via its MAL id — rate limited (~2.3s per entry)
        </div>

        {importPhase && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between font-mono text-[10px]">
              <span className="text-fg-muted">
                {importPhase.kind === "import" ? "importing" : "exporting"} —{" "}
                {importPhase.current}
              </span>
              <span className="text-fg-faint tnum">
                {importPhase.processed}/{importPhase.total}
              </span>
            </div>
            <Bar pct={importPct} />
          </div>
        )}

        {importReport && (
          <div className="mt-3 border border-edge bg-surface p-3 text-[11px] leading-relaxed text-fg-muted">
            <b className="text-moss tnum">{importReport.added}</b> added ·{" "}
            <b className="tnum">{importReport.skipped}</b> skipped (already in list) ·{" "}
            <b className="text-danger tnum">{importReport.failed}</b> failed
            {importReport.notFound.length > 0 && (
              <div className="mt-1 max-h-24 overflow-y-auto font-mono text-[10px] text-fg-faint">
                {importReport.notFound.slice(0, 15).map((t) => (
                  <div key={t}>✕ {t}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel className="p-4">
        <Label right={<Archive size={12} strokeWidth={1.75} className="text-accent" />}>
          backups
        </Label>
        <div className="mt-3 font-mono text-[9.5px] leading-relaxed text-fg-faint">
          a rolling MAL-format XML backup (estenyac_backup_YYYYMM.xml) is written next
          to the database on every launch — the current month stays fresh and the last
          6 months are kept; restores go through the AniList matcher, so they are rate
          limited like imports
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-edge pt-3">
          <Btn
            variant="primary"
            size="sm"
            onClick={doBackupNow}
            disabled={backingUp}
            icon={
              backingUp ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Archive size={11} strokeWidth={1.75} />
              )
            }
          >
            Back up now
          </Btn>
          <Btn
            size="sm"
            onClick={() => void doRestore()}
            disabled={restoring || backups.length === 0}
            icon={
              restoring ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <History size={11} strokeWidth={1.75} />
              )
            }
          >
            Restore latest backup
          </Btn>
        </div>
        <div className="mt-3 border-t border-edge pt-3">
          <div className={LBL}>available backups</div>
          {backups.length === 0 ? (
            <div className="font-mono text-[10px] text-fg-faint">
              none yet — restart the app or click “Back up now”
            </div>
          ) : (
            <div className="max-h-36 overflow-y-auto border border-edge bg-surface">
              {backups.map((b) => (
                <div
                  key={b.path}
                  className="flex items-center justify-between gap-2 border-b border-edge px-2 py-1 font-mono text-[10px] last:border-b-0"
                >
                  <span className="truncate text-fg-muted">{b.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-fg-faint tnum">
                    {(b.size / 1024).toFixed(1)} KB ·{" "}
                    {new Date(b.modified * 1000).toLocaleDateString("en-US", {
                      timeZone,
                    })}
                    <button
                      className="flex items-center gap-0.5 bg-surface-2 px-1.5 py-0.5 font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-40"
                      title={`Restore ${b.name}`}
                      disabled={restoring}
                      onClick={() => void doRestore(b.name)}
                    >
                      <History size={9} strokeWidth={1.75} />
                      restore
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {importPhase && restoring && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between font-mono text-[10px]">
              <span className="text-fg-muted">restoring — {importPhase.current || "…"}</span>
              <span className="text-fg-faint tnum">
                {importPhase.processed}/{importPhase.total}
              </span>
            </div>
            <Bar pct={importPct} />
          </div>
        )}
      </Panel>
    </div>
  );
}
