import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

export function Cover({
  anilistId,
  coverUrl,
  title,
  className = "",
  remoteFallback = true,
}: {
  anilistId: number;
  coverUrl?: string | null;
  title?: string | null;
  className?: string;
  remoteFallback?: boolean;
}) {
  const requestImage = useStore((s) => s.requestImage);
  const dataUrl = useStore((s) => s.images[anilistId]);
  const [errored, setErrored] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (visible && !dataUrl && !errored) {
      requestImage(anilistId).then((d) => {
        if (!d) setErrored(true);
      });
    }
  }, [visible, anilistId, dataUrl, errored, requestImage]);

  return (
    <div ref={ref} className={className}>
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={title ?? ""}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : remoteFallback && coverUrl && !errored ? (
        <img
          src={coverUrl}
          alt={title ?? ""}
          className="h-full w-full object-cover"
          loading="lazy"
          draggable={false}
          onError={() => setErrored(true)}
        />
      ) : (
        <div className="display flex h-full w-full select-none items-center justify-center border border-edge bg-surface-2 text-[1.4em] text-fg-faint">
          {(title ?? "?").trim().charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}
