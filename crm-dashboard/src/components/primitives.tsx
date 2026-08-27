import type { ReactNode, CSSProperties } from "react";
import { colourFor, initials } from "../utils/format";

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card__header">
          {title && <h2 className="card__title">{title}</h2>}
          {action}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button className={`btn btn--${variant}`} onClick={onClick} disabled={disabled} type={type}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Tag({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="tag" style={{ backgroundColor: colourFor(label) }}>
      {label}
      {onRemove && (
        <span className="tag__remove" onClick={onRemove}>
          ×
        </span>
      )}
    </span>
  );
}

export function Avatar({ name, url, size = 32 }: { name: string; url?: string; size?: number }) {
  const [first, last = ""] = name.split(" ");
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    backgroundColor: colourFor(name),
    fontSize: size / 2.5,
  };

  if (url) {
    return <img className="avatar" src={url} alt={name} style={style} />;
  }
  return (
    <span className="avatar avatar--initials" style={style} title={name}>
      {initials(first, last)}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__ring" />
      <span className="spinner__label">{label}…</span>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <strong>Something went wrong.</strong> {error.message}
      {onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function ProgressBar({ value, max, tone = "primary" }: { value: number; max: number; tone?: string }) {
  const percent = Math.round((value / max) * 100);
  return (
    <div className="progress" title={`${percent}%`}>
      <div className={`progress__fill progress__fill--${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Stat({ label, value, delta }: { label: string; value: string; delta?: number }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {delta !== undefined && (
        <span className={`stat__delta stat__delta--${delta >= 0 ? "up" : "down"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
        </span>
      )}
    </div>
  );
}
