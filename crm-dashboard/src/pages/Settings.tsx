import { useState } from "react";
import { useLocalStorage, useToggle } from "../hooks/useLocalStorage";
import { useStore, useToasts } from "../state/store";
import { clearToken } from "../api/client";
import { PAGE_SIZES } from "../hooks/usePagination";
import { Button, Card, Field } from "../components/primitives";

export function Settings() {
  const { state, dispatch } = useStore();
  const { push } = useToasts();

  const [pageSize, setPageSize] = useLocalStorage("crm.contacts.pageSize", 25);
  const [density, setDensity] = useLocalStorage("crm.density", "comfortable");
  const [emailDigest, toggleDigest] = useToggle("crm.digest", true);
  const [signature, setSignature] = useState("");

  return (
    <div className="page page--settings">
      <header className="page__header">
        <h1>Settings</h1>
      </header>

      <Card title="Profile">
        <dl className="detail-list">
          <dt>Name</dt>
          <dd>{state.currentUser?.name}</dd>
          <dt>Email</dt>
          <dd>{state.currentUser?.email}</dd>
          <dt>Role</dt>
          <dd>{state.currentUser?.role}</dd>
        </dl>
      </Card>

      <Card title="Table preferences">
        <Field label="Rows per page">
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Density">
          <select value={density} onChange={(e) => setDensity(e.target.value)}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </Field>

        <Field label="Sidebar">
          <Button onClick={() => dispatch({ type: "toggle-sidebar" })}>
            {state.sidebarCollapsed ? "Expand" : "Collapse"}
          </Button>
        </Field>
      </Card>

      <Card title="Notifications">
        <label className="switch">
          <input type="checkbox" checked={emailDigest} onChange={toggleDigest} />
          Daily email digest
        </label>
      </Card>

      <Card title="Email signature">
        <Field label="Signature" hint="HTML is allowed">
          <textarea rows={6} value={signature} onChange={(e) => setSignature(e.target.value)} />
        </Field>
        <div className="signature-preview" dangerouslySetInnerHTML={{ __html: signature }} />
        <Button variant="primary" onClick={() => push("success", "Signature saved")}>
          Save
        </Button>
      </Card>

      <Card title="Session">
        <Button
          variant="danger"
          onClick={() => {
            clearToken();
            window.location.href = "/login";
          }}
        >
          Sign out
        </Button>
      </Card>
    </div>
  );
}
