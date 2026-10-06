import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

// The one dialog every My community overlay is built on: the Friends drawer, the hide, block or
// report sheet, and the Find and Alerts panels. It is a proper modal dialog: the focus moves in
// when it opens and stays inside, Escape closes it (only the newest one, when one opens over
// another), pressing the dimmed page closes it, and the focus goes back to what opened it.

export type CommunityDialogKind = "drawer" | "sheet" | "panel";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Open dialogs, oldest first. Only the newest one answers Escape and keeps the focus. */
const openDialogs: HTMLElement[] = [];

/**
 * How many drawers and sheets are holding the page still, and how the page scrolled before the
 * first of them. The page is let go only when the last one closes, in whatever order they close
 * (the safety sheet can open over the Friends drawer, and Back can take the drawer away first).
 */
let pageHolds = 0;
let overflowBefore = "";

function holdPage(root: HTMLElement) {
  if (pageHolds++ === 0) {
    overflowBefore = root.style.overflow;
    root.style.overflow = "hidden";
  }
}

function letPageGo(root: HTMLElement) {
  if (pageHolds === 0) return;
  if (--pageHolds === 0) root.style.overflow = overflowBefore;
}

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.prototype.slice.call(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element: HTMLElement) => !element.closest("[hidden], [inert]") && element.getClientRects().length > 0);
}

const usable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  !!element && element.isConnected && element !== document.body && !element.closest("[hidden], [inert]");

/** Where a panel sits: just under the button that opened it, lined up with its right-hand edge. */
function panelPlace(anchor: HTMLElement | null): CSSProperties | undefined {
  if (!anchor || typeof window === "undefined") return undefined;
  const box = anchor.getBoundingClientRect();
  const top = Math.round(box.bottom + 10);
  return { top, right: Math.max(16, Math.round(window.innerWidth - box.right)), maxHeight: `calc(100vh - ${top + 16}px)` };
}

export type CommunityDialogProps = {
  /** "drawer" slides in from the right (Friends); "sheet" sits in the middle, or at the bottom on a phone (hide, block or report); "panel" drops down under a toolbar button (Find, Alerts). */
  kind: CommunityDialogKind;
  /** The id of the dialog's heading, which names it. Give the heading this id. */
  labelledBy: string;
  /** Called on Escape, on pressing the dimmed page, and by your own Close buttons. */
  onClose: () => void;
  /** Your classes for the dialog box, such as "cm-fr-drawer". */
  className?: string;
  /** For a panel: the toolbar button it drops down from. */
  anchor?: HTMLElement | null;
  /** What the focus returns to on closing. By default, whatever had the focus when it opened. */
  returnFocus?: HTMLElement | null;
  /** Where the focus goes instead if that has gone (for example the Friends button in the toolbar). */
  fallbackFocus?: () => HTMLElement | null | undefined;
  children: ReactNode;
};

/**
 * The focus starts on the element marked `data-autofocus` inside the dialog, or else on its
 * heading. Inner controls that use Escape themselves (a search box clearing its words) can call
 * `event.preventDefault()` to keep the dialog open.
 */
export default function CommunityDialog({ kind, labelledBy, onClose, className = "", anchor = null, returnFocus = null, fallbackFocus, children }: CommunityDialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const fallbackRef = useRef(fallbackFocus);
  closeRef.current = onClose;
  fallbackRef.current = fallbackFocus;
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined);

  useLayoutEffect(() => {
    if (kind !== "panel" || !anchor) return;
    const update = () => setPlace(panelPlace(anchor));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update); };
  }, [kind, anchor]);

  useEffect(() => {
    const dialog = box.current;
    if (!dialog) return;
    const opener = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    openDialogs.push(dialog);

    const heading = document.getElementById(labelledBy);
    if (heading && dialog.contains(heading) && !heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? (heading && dialog.contains(heading) ? heading : dialog);
    first.focus({ preventScroll: true });

    const newest = () => openDialogs[openDialogs.length - 1] === dialog;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !newest()) return;
      event.preventDefault();
      closeRef.current();
    };
    // If the focus wanders out (a click on the page behind, an assistive tool), it is brought back.
    const onFocusIn = (event: FocusEvent) => {
      if (!newest() || dialog.contains(event.target as Node)) return;
      (focusablesIn(dialog)[0] ?? dialog).focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);

    // A drawer or a sheet holds the page still behind it.
    const root = document.documentElement;
    if (kind !== "panel") holdPage(root);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      const at = openDialogs.indexOf(dialog);
      if (at >= 0) openDialogs.splice(at, 1);
      if (kind !== "panel") letPageGo(root);
      const target = usable(opener) ? opener : fallbackRef.current?.();
      if (usable(target)) target.focus({ preventScroll: true });
    };
    // Set up once, when the dialog opens: the latest onClose and fallback are read through refs.
  }, []);

  // Tab and Shift+Tab go round the dialog's controls.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !box.current) return;
    const items = focusablesIn(box.current);
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !items.includes(active as HTMLElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !items.includes(active as HTMLElement))) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className={`cm-dialog-layer cm-dialog-layer-${kind}`}>
      {/* The dimmed page: pressing it closes the dialog. Keyboard users have Escape and the Close button. */}
      <div className="cm-scrim" aria-hidden="true" onClick={() => closeRef.current()} />
      <div ref={box} className={`cm-dialog cm-dialog-${kind} ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} style={place} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  );
}
