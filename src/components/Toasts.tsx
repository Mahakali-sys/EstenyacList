import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useStore } from "../store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[340px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`anim-toast pointer-events-auto flex items-start gap-2.5 border border-edge bg-surface px-3 py-2.5 shadow-[var(--shadow-pop)] ${
            t.kind === "error"
              ? "border-l-2 border-l-[var(--danger)]"
              : t.kind === "success"
                ? "border-l-2 border-l-[var(--moss)]"
                : "border-l-2 border-l-edge-2"
          }`}
        >
          {t.kind === "error" ? (
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
          ) : t.kind === "success" ? (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-moss" />
          ) : (
            <Info size={14} className="mt-0.5 shrink-0 text-fg-faint" />
          )}
          <div className="flex-1 break-words text-[11.5px] leading-relaxed text-fg-muted">
            {t.msg}
          </div>
          <button
            className="btn btn-ghost btn-icon !h-5 !w-5 shrink-0"
            onClick={() => dismiss(t.id)}
            title="Dismiss"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
