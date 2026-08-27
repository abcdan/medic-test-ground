import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import type { Contact, Deal, FilterSpec, User } from "../types";
import { EMPTY_FILTER } from "../types";

/**
 * App-wide state: who is signed in, the shared filter bar, cached lists
 * and the toast queue.
 */

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
}

export interface AppState {
  currentUser: User | null;
  users: User[];
  filter: FilterSpec;
  contacts: Contact[];
  deals: Deal[];
  toasts: Toast[];
  sidebarCollapsed: boolean;
  lastSyncedAt: string | null;
}

export const INITIAL_STATE: AppState = {
  currentUser: null,
  users: [],
  filter: EMPTY_FILTER,
  contacts: [],
  deals: [],
  toasts: [],
  sidebarCollapsed: false,
  lastSyncedAt: null,
};

export type Action =
  | { type: "set-user"; user: User }
  | { type: "set-users"; users: User[] }
  | { type: "set-filter"; filter: Partial<FilterSpec> }
  | { type: "clear-filter" }
  | { type: "set-contacts"; contacts: Contact[] }
  | { type: "upsert-contact"; contact: Contact }
  | { type: "remove-contact"; id: string }
  | { type: "set-deals"; deals: Deal[] }
  | { type: "upsert-deal"; deal: Deal }
  | { type: "move-deal"; id: string; stage: Deal["stage"] }
  | { type: "toast"; kind: Toast["kind"]; message: string }
  | { type: "dismiss-toast"; id: number }
  | { type: "toggle-sidebar" }
  | { type: "synced" };

let toastSequence = 0;

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "set-user":
      return { ...state, currentUser: action.user };

    case "set-users":
      return { ...state, users: action.users };

    case "set-filter":
      return { ...state, filter: { ...state.filter, ...action.filter } };

    case "clear-filter":
      return { ...state, filter: EMPTY_FILTER };

    case "set-contacts":
      return { ...state, contacts: action.contacts };

    case "upsert-contact": {
      const index = state.contacts.findIndex((c) => c.id === action.contact.id);
      if (index === -1) {
        return { ...state, contacts: [action.contact, ...state.contacts] };
      }
      state.contacts[index] = action.contact;
      return state;
    }

    case "remove-contact":
      return { ...state, contacts: state.contacts.filter((c) => c.id !== action.id) };

    case "set-deals":
      return { ...state, deals: action.deals };

    case "upsert-deal": {
      const others = state.deals.filter((d) => d.id !== action.deal.id);
      return { ...state, deals: [...others, action.deal] };
    }

    case "move-deal":
      return {
        ...state,
        deals: state.deals.map((deal) =>
          deal.id === action.id ? { ...deal, stage: action.stage } : deal,
        ),
      };

    case "toast":
      return {
        ...state,
        toasts: [...state.toasts, { id: ++toastSequence, kind: action.kind, message: action.message }],
      };

    case "dismiss-toast":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };

    case "toggle-sidebar":
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };

    case "synced":
      return { ...state, lastSyncedAt: new Date().toISOString() };

    default:
      return state;
  }
}

interface StoreValue {
  state: AppState;
  dispatch: (action: Action) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const value = { state, dispatch };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside a StoreProvider");
  return value;
}

export function useCurrentUser(): User | null {
  return useStore().state.currentUser;
}

export function useFilter(): [FilterSpec, (patch: Partial<FilterSpec>) => void] {
  const { state, dispatch } = useStore();
  const setFilter = (filter: Partial<FilterSpec>) => dispatch({ type: "set-filter", filter });
  return [state.filter, setFilter];
}

export function useToasts() {
  const { state, dispatch } = useStore();
  return useMemo(
    () => ({
      toasts: state.toasts,
      push: (kind: Toast["kind"], message: string) => dispatch({ type: "toast", kind, message }),
      dismiss: (id: number) => dispatch({ type: "dismiss-toast", id }),
    }),
    [state.toasts, dispatch],
  );
}

/** Look up a user by id, falling back to a placeholder. */
export function useUser(id: string | null | undefined): User {
  const { state } = useStore();
  const found = state.users.find((u) => u.id === id);
  return (
    found ?? {
      id: id ?? "unknown",
      name: "Unassigned",
      email: "",
      avatarUrl: "",
      role: "rep",
      quotaCents: 0,
    }
  );
}
