import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function Dropdown({
  trigger,
  children,
  align = "right",
  className = "",
  onOpenChange,
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  /** "window" pins the menu to the window's right margin instead of the trigger. */
  align?: "left" | "right" | "window";
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    openChange.current?.(true);
    return () => openChange.current?.(false);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const p: { top: number; left?: number; right?: number } = {
        top: r.bottom + 4,
      };
      if (align === "window") p.right = 8;
      else if (align === "right") p.right = Math.max(8, window.innerWidth - r.right);
      else p.left = Math.max(8, r.left);
      setPos(p);
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, align]);

  useLayoutEffect(() => {
    if (!open || !pos) return;
    const el = menuRef.current;
    const r = wrapRef.current?.getBoundingClientRect();
    if (!el || !r) return;
    const h = el.offsetHeight;
    const desired =
      r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    setPos((p) => (p && p.top === desired ? p : { ...p!, top: desired }));
  }, [open, pos]);

  return (
    <div className="relative" ref={wrapRef}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className={`menu anim-in fixed z-[95] ${className}`}
              style={{
                top: pos.top,
                ...(pos.left != null ? { left: pos.left } : {}),
                ...(pos.right != null ? { right: pos.right } : {}),
              }}
              onClick={() => setOpen(false)}
            >
              {children(() => setOpen(false))}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
