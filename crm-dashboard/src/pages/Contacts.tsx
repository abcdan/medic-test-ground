import { useEffect, useMemo, useState } from "react";
import { useFetch, useMutation } from "../hooks/useFetch";
import { usePagination } from "../hooks/usePagination";
import { useSelection } from "../hooks/useSelection";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useHotkey } from "../hooks/useKeyboard";
import { listContacts, createContact, deleteContact, bulkTag } from "../api/contacts";
import { useFilter, useStore, useToasts, useUser } from "../state/store";
import type { Contact } from "../types";
import { fullName, highlight, truncate } from "../utils/format";
import { formatDate, relativeTime } from "../utils/dates";
import { toCsv, downloadCsv } from "../utils/csv";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { Pagination } from "../components/Pagination";
import { FilterBar } from "../components/FilterBar";
import { Modal, ConfirmDialog } from "../components/Modal";
import { ContactForm, type ContactFormValues } from "../components/ContactForm";
import { Avatar, Badge, Button, Card, ErrorBanner, Tag } from "../components/primitives";

function OwnerCell({ ownerId }: { ownerId: string }) {
  const owner = useUser(ownerId);
  return (
    <span className="owner-cell">
      <Avatar name={owner.name} url={owner.avatarUrl} size={22} />
      {owner.name}
    </span>
  );
}

export function Contacts() {
  const [filter] = useFilter();
  const { dispatch } = useStore();
  const { push } = useToasts();

  const [pageSize] = useLocalStorage("crm.contacts.pageSize", 25);
  const [total, setTotal] = useState(0);
  const pagination = usePagination(total, pageSize);
  const selection = useSelection();

  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const contacts = useFetch(
    (signal) =>
      listContacts(
        {
          search: filter.search,
          ownerId: filter.ownerId,
          page: pagination.page,
          pageSize: pagination.pageSize,
        },
        signal,
      ),
    [filter.search, filter.ownerId, pagination.page, pagination.pageSize],
  );

  useEffect(() => {
    if (contacts.data) {
      setTotal(contacts.data.total);
      dispatch({ type: "set-contacts", contacts: contacts.data.items });
    }
  }, [contacts.data]);

  const create = useMutation(createContact);
  const remove = useMutation(deleteContact);

  useHotkey("cmd+k", () => setCreating(true));

  const columns: ColumnDef<Contact>[] = useMemo(
    () => [
      {
        key: "firstName",
        header: "Name",
        sortable: true,
        render: (row) => (
          <span
            className="contact-name"
            dangerouslySetInnerHTML={{ __html: highlight(fullName(row), filter.search) }}
          />
        ),
      },
      { key: "email", header: "Email", sortable: true },
      { key: "jobTitle", header: "Title", sortable: true },
      {
        key: "lifecycleStage",
        header: "Stage",
        render: (row) => <Badge tone={row.lifecycleStage}>{row.lifecycleStage}</Badge>,
      },
      {
        key: "tags",
        header: "Tags",
        render: (row) => (
          <span className="tag-list">
            {row.tags.slice(0, 3).map((tag) => (
              <Tag key={tag} label={tag} />
            ))}
            {row.tags.length > 3 && <span>+{row.tags.length - 3}</span>}
          </span>
        ),
      },
      { key: "ownerId", header: "Owner", render: (row) => <OwnerCell ownerId={row.ownerId} /> },
      {
        key: "lastContactedAt",
        header: "Last contacted",
        sortable: true,
        align: "right",
        render: (row) => (row.lastContactedAt ? relativeTime(row.lastContactedAt) : "never"),
      },
      {
        key: "createdAt",
        header: "Created",
        sortable: true,
        align: "right",
        render: (row) => formatDate(row.createdAt),
      },
      {
        key: "notes",
        header: "Notes",
        render: (row) => <span title={row.notes}>{truncate(row.notes, 40)}</span>,
      },
    ],
    [filter.search],
  );

  const handleCreate = async (values: ContactFormValues) => {
    const created = await create.run(values);
    if (created) {
      dispatch({ type: "upsert-contact", contact: created });
      push("success", `${fullName(created)} added`);
      setCreating(false);
      contacts.refetch();
    }
  };

  const handleExport = () => {
    const rows = contacts.data?.items ?? [];
    const csv = toCsv(rows, [
      { key: "firstName", label: "First name", value: (r) => r.firstName },
      { key: "lastName", label: "Last name", value: (r) => r.lastName },
      { key: "email", label: "Email", value: (r) => r.email },
      { key: "phone", label: "Phone", value: (r) => r.phone },
      { key: "jobTitle", label: "Job title", value: (r) => r.jobTitle },
      { key: "tags", label: "Tags", value: (r) => r.tags.join("; ") },
    ]);
    downloadCsv("contacts.csv", csv);
  };

  if (contacts.error) return <ErrorBanner error={contacts.error} onRetry={contacts.refetch} />;

  return (
    <div className="page page--contacts">
      <header className="page__header">
        <h1>Contacts</h1>
        <div className="page__actions">
          <Button onClick={handleExport}>Export CSV</Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            New contact
          </Button>
        </div>
      </header>

      <FilterBar />

      {selection.count > 0 && (
        <div className="bulk-bar">
          <span>{selection.count} selected</span>
          <Button
            onClick={() => {
              bulkTag(selection.selected, "campaign-q3");
              push("info", `Tagged ${selection.count} contacts`);
              selection.clear();
            }}
          >
            Tag as campaign-q3
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(selection.selected[0])}>
            Delete
          </Button>
        </div>
      )}

      <Card>
        <DataTable
          rows={contacts.data?.items ?? []}
          columns={columns}
          loading={contacts.loading}
          selection={selection}
          emptyTitle="No contacts match those filters"
          onRowClick={(row) => (window.location.href = `/contacts/${row.id}`)}
        />
        <Pagination state={pagination} total={total} />
      </Card>

      <Modal title="New contact" open={creating} onClose={() => setCreating(false)}>
        <ContactForm onSubmit={handleCreate} onCancel={() => setCreating(false)} saving={create.pending} />
      </Modal>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete contact"
        message="This cannot be undone. The contact's activity history will be kept."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) {
            await remove.run(confirmDelete);
            dispatch({ type: "remove-contact", id: confirmDelete });
            push("success", "Contact deleted");
          }
          setConfirmDelete(null);
          contacts.refetch();
        }}
      />
    </div>
  );
}
