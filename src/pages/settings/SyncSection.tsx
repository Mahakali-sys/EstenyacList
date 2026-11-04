import { Download, ExternalLink, Link2, Loader2, LogOut } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { useStore } from "../../store";
import { Btn, Label, Panel, Toggle } from "../../components/ui";

const LBL =
  "mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint";

export function SyncSection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const loadSettings = useStore((s) => s.loadSettings);
  const toast = useStore((s) => s.toast);
  const pullFromAniList = useStore((s) => s.pullFromAniList);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"connect" | "disconnect" | "pull" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = Boolean(settings.anilistUsername);
  const clientId = settings.anilistClientId ?? "";

  const openDeveloper = async () => {
    try {
      await api.openAniListDeveloper();
    } catch (e) {
      setError(String(e));
    }
  };

  const openAuth = async () => {
    setError(null);
    try {
      await api.openAniListAuth(clientId);
    } catch (e) {
      setError(String(e));
    }
  };

  const connect = async () => {
    setBusy("connect");
    setError(null);
    try {
      const account = await api.anilistConnect(clientId, secret, code);
      setSecret("");
      setCode("");
      await loadSettings();
      toast(`connected to AniList as ${account.username}`, "success");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const pull = async () => {
    setBusy("pull");
    setError(null);
    try {
      const r = await pullFromAniList();
      const parts = [`${r.added} added`, `${r.updated} updated`];
      if (r.customListsCreated > 0) parts.push(`${r.customListsCreated} lists created`);
      if (r.keptLocal > 0) parts.push(`${r.keptLocal} local-only kept`);
      toast(`AniList pull complete: ${parts.join(", ")}`, "success");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setError(null);
    try {
      await api.anilistDisconnect();
      await loadSettings();
      toast("AniList disconnected", "success");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-2.5">
      <Panel className="p-4">
        <Label
          right={
            <Link2 size={12} strokeWidth={1.75} className="text-accent" />
          }
        >
          anilist account
        </Label>

        {connected ? (
          <div className="mt-3 grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[11px] text-fg">
                connected as{" "}
                <b className="text-accent">{settings.anilistUsername}</b>
              </span>
              <Btn
                size="sm"
                variant="danger"
                onClick={disconnect}
                disabled={busy !== null}
                icon={
                  busy === "disconnect" ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <LogOut size={11} strokeWidth={1.75} />
                  )
                }
              >
                Disconnect
              </Btn>
            </div>

            <div className="border-t border-edge pt-3">
              <Toggle
                checked={settings.anilistSync === true}
                onChange={(v) => setSetting("anilistSync", v)}
                label="Push local changes to AniList"
              />
              <div className="mt-2 font-mono text-[9.5px] leading-relaxed text-fg-faint">
                progress, status, score, start/finish dates and rewatches are
                sent after each edit. entries missing from AniList are created.
                if AniList already has more progress, the push is skipped
                instead of rolling it back. failed pushes stay queued and retry
                automatically.
              </div>
            </div>

            <div className="border-t border-edge pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Btn
                  size="sm"
                  onClick={pull}
                  disabled={busy !== null}
                  icon={
                    busy === "pull" ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Download size={11} strokeWidth={1.75} />
                    )
                  }
                >
                  Pull from AniList
                </Btn>
                <span className="font-mono text-[9.5px] leading-relaxed text-fg-faint">
                  manual one-way import: your AniList lists are copied into the
                  app. new entries are added, existing ones updated, local-only
                  entries kept
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-4">
            <div>
              <div className={LBL}>1 · create an api client</div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Btn
                  size="sm"
                  onClick={openDeveloper}
                  icon={<ExternalLink size={11} strokeWidth={1.75} />}
                >
                  anilist developer settings
                </Btn>
                <span className="font-mono text-[9.5px] text-fg-faint">
                  redirect url: https://anilist.co/api/v2/oauth/pin
                </span>
              </div>
            </div>

            <div>
              <div className={LBL}>2 · client id + secret</div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input w-32"
                  value={clientId}
                  onChange={(e) =>
                    setSetting("anilistClientId", e.target.value.trim())
                  }
                  placeholder="client id"
                  inputMode="numeric"
                />
                <input
                  className="input min-w-40 flex-1"
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="client secret"
                  autoComplete="off"
                />
              </div>
            </div>

            <div>
              <div className={LBL}>3 · authorization code</div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Btn
                  size="sm"
                  onClick={openAuth}
                  disabled={!clientId}
                  icon={<ExternalLink size={11} strokeWidth={1.75} />}
                >
                  open approval page
                </Btn>
                <span className="font-mono text-[9.5px] text-fg-faint">
                  approve, then copy the code shown on the page
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="paste authorization code"
                  autoComplete="off"
                />
                <Btn
                  size="sm"
                  variant="primary"
                  onClick={connect}
                  disabled={!clientId || !secret.trim() || !code.trim() || busy !== null}
                  icon={
                    busy === "connect" ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : undefined
                  }
                >
                  Connect
                </Btn>
              </div>
            </div>

            {error && (
              <div className="font-mono text-[10px] leading-relaxed text-danger">
                {error}
              </div>
            )}

            <div className="border-t border-edge pt-2 font-mono text-[9px] leading-relaxed text-fg-faint">
              the access token is stored in the local app database and is only
              sent to graphql.anilist.co. the client secret and code are only
              used once to get the token. AniList tokens last about a year.
            </div>
          </div>
        )}

        {connected && error && (
          <div className="mt-3 font-mono text-[10px] leading-relaxed text-danger">
            {error}
          </div>
        )}
      </Panel>
    </div>
  );
}
