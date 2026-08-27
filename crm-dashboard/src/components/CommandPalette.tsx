import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useDebounce } from "../hooks/useDebounce";
import { listContacts } from "../api/contacts";
import { listDeals } from "../api/deals";
import { fullName } from "../utils/format";
import type { Contact, Deal } from "../types";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const STATIC_COMMANDS: Omit<Command, "run">[] = [
  { id: "goto-dashboard", label: "Go to dashboard" },
  { id: "goto-contacts", label: "Go to contacts" },
  { id: "goto-deals", label: "Go to deals" },
  { id: "goto-reports", label: "Go to reports" },
  { id: "new-contact", label: "New contact", hint: "C" },
  { id: "new-deal", label: "New deal", hint: "D" },
];

const ROUTES: Record<string, string> = {
  "goto-dashboard": "/",
  "goto-contacts": "/contacts",
  "goto-deals": "/deals",
  "goto-reports": "/reports",
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dispatch } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  const debounced = useDebounce(query, 200);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!debounced) {
      setContacts([]);
      setDeals([]);
      return;
    }
    listContacts({ search: debounced, pageSize: 5 }).then((page) => setContacts(page.items));
    listDeals({ search: debounced, pageSize: 5 }).then((page) => setDeals(page.items));
  }, [debounced]);

  const commands: Command[] = useMemo(() => {
    const statics = STATIC_COMMANDS.filter((c) =>
      c.label.toLowerCase().includes(query.toLowerCase()),
    ).map((c) => ({
      ...c,
      run: () => {
        const route = ROUTES[c.id];
        if (route) window.location.href = route;
        onClose();
      },
    }));

    const contactCommands = contacts.map((contact) => ({
      id: `contact-${contact.id}`,
      label: fullName(contact),
      hint: contact.email,
      run: () => {
        window.location.href = `/contacts/${contact.id}`;
        onClose();
      },
    }));

    const dealCommands = deals.map((deal) => ({
      id: `deal-${deal.id}`,
      label: deal.title,
      hint: deal.stage,
      run: () => {
        window.location.href = `/deals/${deal.id}`;
        onClose();
      },
    }));

    return [...statics, ...contactCommands, ...dealCommands];
  }, [query, contacts, deals, onClose]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") setCursor((c) => Math.min(c + 1, commands.length - 1));
    if (event.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
    if (event.key === "Enter") commands[cursor]?.run();
    if (event.key === "Escape") onClose();
  };

  if (!open) return null;

  return (
    <div className="palette__backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search or run a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />

        <ul className="palette__results">
          {commands.map((command, index) => (
            <li
              key={command.id}
              className={index === cursor ? "is-active" : undefined}
              onMouseEnter={() => setCursor(index)}
              onClick={command.run}
            >
              <span>{command.label}</span>
              {command.hint && <small>{command.hint}</small>}
            </li>
          ))}
          {commands.length === 0 && <li className="palette__empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
