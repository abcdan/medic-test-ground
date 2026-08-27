import { useEffect } from "react";

/** Fire a handler when a key combination is pressed. */
export function useHotkey(combo: string, handler: () => void): void {
  useEffect(() => {
    const parts = combo.toLowerCase().split("+");
    const key = parts[parts.length - 1];
    const needsMeta = parts.includes("cmd") || parts.includes("meta");
    const needsShift = parts.includes("shift");

    const onKeyDown = (event: KeyboardEvent) => {
      if (needsMeta && !(event.metaKey || event.ctrlKey)) return;
      if (needsShift && !event.shiftKey) return;
      if (event.key.toLowerCase() !== key) return;
      event.preventDefault();
      handler();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [combo, handler]);
}

/** Close something when Escape is pressed. */
export function useEscape(onEscape: () => void): void {
  useHotkey("escape", onEscape);
}

/** Detect a click outside a ref, for popovers. */
export function useClickOutside(ref: { current: HTMLElement | null }, onOutside: () => void): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onOutside();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [ref, onOutside]);
}
