import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./state/store";
import { currentUser, listUsers } from "./api/companies";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { Spinner } from "./components/primitives";
import { Dashboard } from "./pages/Dashboard";
import { Contacts } from "./pages/Contacts";
import { ContactDetail } from "./pages/ContactDetail";
import { Companies } from "./pages/Companies";
import { Deals } from "./pages/Deals";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { DealDetail } from "./pages/DealDetail";
import { Tasks } from "./pages/Tasks";
import { CompanyDetail } from "./pages/CompanyDetail";
import { CommandPalette } from "./components/CommandPalette";
import { useHotkey } from "./hooks/useKeyboard";

/** Very small hash-free router: we only ever push whole page loads. */
function route(path: string) {
  if (path === "/" ) return <Dashboard />;
  if (path === "/contacts") return <Contacts />;
  if (path.startsWith("/contacts/")) return <ContactDetail contactId={path.split("/")[2]} />;
  if (path === "/companies") return <Companies />;
  if (path.startsWith("/companies/")) return <CompanyDetail companyId={path.split("/")[2]} />;
  if (path === "/deals") return <Deals />;
  if (path.startsWith("/deals/")) return <DealDetail dealId={path.split("/")[2]} />;
  if (path === "/tasks") return <Tasks />;
  if (path === "/reports") return <Reports />;
  if (path === "/settings") return <Settings />;
  return <p>Not found</p>;
}

function Shell() {
  const { state, dispatch } = useStore();
  const [path, setPath] = useState(window.location.pathname);
  const [booting, setBooting] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useHotkey("cmd+k", () => setPaletteOpen(true));

  useEffect(() => {
    Promise.all([currentUser(), listUsers()]).then(([me, users]) => {
      dispatch({ type: "set-user", user: me });
      dispatch({ type: "set-users", users });
      setBooting(false);
    });
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (booting) return <Spinner label="Loading your workspace" />;

  return (
    <div className={`app ${state.sidebarCollapsed ? "app--narrow" : ""}`}>
      <Sidebar current={path} />
      <main className="app__main">{route(path)}</main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
