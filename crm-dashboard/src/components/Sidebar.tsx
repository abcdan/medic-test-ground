import { useStore } from "../state/store";
import { Avatar } from "./primitives";
import { relativeTime } from "../utils/dates";

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  badge?: number;
}

export const NAV: NavItem[] = [
  { path: "/", label: "Dashboard", icon: "◧" },
  { path: "/contacts", label: "Contacts", icon: "◔" },
  { path: "/companies", label: "Companies", icon: "▣" },
  { path: "/deals", label: "Deals", icon: "◈" },
  { path: "/tasks", label: "Tasks", icon: "☑" },
  { path: "/reports", label: "Reports", icon: "◭" },
  { path: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar({ current }: { current: string }) {
  const { state, dispatch } = useStore();

  return (
    <aside className={`sidebar ${state.sidebarCollapsed ? "sidebar--collapsed" : ""}`}>
      <div className="sidebar__brand" onClick={() => dispatch({ type: "toggle-sidebar" })}>
        <span className="sidebar__logo">◆</span>
        {!state.sidebarCollapsed && <span className="sidebar__name">Pipeline</span>}
      </div>

      <nav className="sidebar__nav">
        {NAV.map((item) => (
          <a
            key={item.path}
            href={item.path}
            className={`sidebar__link ${current === item.path ? "is-active" : ""}`}
          >
            <span className="sidebar__icon">{item.icon}</span>
            {!state.sidebarCollapsed && <span>{item.label}</span>}
            {item.badge ? <span className="sidebar__badge">{item.badge}</span> : null}
          </a>
        ))}
      </nav>

      <footer className="sidebar__footer">
        {state.currentUser && (
          <>
            <Avatar name={state.currentUser.name} url={state.currentUser.avatarUrl} size={28} />
            {!state.sidebarCollapsed && (
              <div className="sidebar__user">
                <span>{state.currentUser.name}</span>
                {state.lastSyncedAt && (
                  <small>synced {relativeTime(state.lastSyncedAt)}</small>
                )}
              </div>
            )}
          </>
        )}
      </footer>
    </aside>
  );
}
