import { useEffect } from "react";
import { useToasts } from "../state/store";

export function Toasts() {
  const { toasts, dismiss } = useToasts();

  useEffect(() => {
    for (const toast of toasts) {
      setTimeout(() => dismiss(toast.id), 4000);
    }
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <span>{toast.message}</span>
          <button onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
