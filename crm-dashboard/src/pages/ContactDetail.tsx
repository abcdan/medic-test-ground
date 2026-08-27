import { useEffect, useState } from "react";
import { useFetch, useMutation } from "../hooks/useFetch";
import { getContact, updateContact } from "../api/contacts";
import { getCompany } from "../api/companies";
import { listActivities, logActivity, completeActivity } from "../api/activities";
import { listDeals } from "../api/deals";
import { useToasts, useUser } from "../state/store";
import type { Activity, ActivityKind } from "../types";
import { fullName } from "../utils/format";
import { formatDate, relativeTime } from "../utils/dates";
import { Avatar, Badge, Button, Card, ErrorBanner, Field, Spinner, Tag } from "../components/primitives";
import { ActivityFeed } from "../components/ActivityFeed";
import { ContactForm, type ContactFormValues } from "../components/ContactForm";
import { Modal } from "../components/Modal";
import { formatMoney } from "../utils/format";

function LogActivityForm({ contactId, onLogged }: { contactId: string; onLogged: () => void }) {
  const [kind, setKind] = useState<ActivityKind>("call");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [duration, setDuration] = useState(15);

  const log = useMutation(logActivity);

  const submit = async () => {
    await log.run({
      kind,
      subject,
      body,
      contactId,
      durationMinutes: duration,
      occurredAt: new Date().toISOString(),
      completed: true,
    });
    setSubject("");
    setBody("");
    onLogged();
  };

  return (
    <div className="log-activity">
      <div className="log-activity__tabs">
        {(["call", "email", "meeting", "note", "task"] as ActivityKind[]).map((k) => (
          <button key={k} className={k === kind ? "is-active" : undefined} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>

      <Field label="Subject">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>

      <Field label="Details">
        <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>

      {kind === "call" || kind === "meeting" ? (
        <Field label="Duration (minutes)">
          <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </Field>
      ) : null}

      <Button variant="primary" onClick={submit} disabled={log.pending || !subject}>
        Log {kind}
      </Button>
    </div>
  );
}

export function ContactDetail({ contactId }: { contactId: string }) {
  const { push } = useToasts();
  const [editing, setEditing] = useState(false);

  const contact = useFetch((signal) => getContact(contactId, signal), [contactId]);
  const activities = useFetch((signal) => listActivities({ contactId }, signal), [contactId]);
  const deals = useFetch((signal) => listDeals({ companyId: contact.data?.companyId }, signal), [contact.data]);
  const company = useFetch(
    (signal) => getCompany(contact.data!.companyId!, signal),
    [contact.data?.companyId],
  );

  const owner = useUser(contact.data?.ownerId);
  const save = useMutation((patch: Partial<ContactFormValues>) => updateContact(contactId, patch));

  useEffect(() => {
    document.title = contact.data ? `${fullName(contact.data)} · CRM` : "CRM";
  }, [contact.data]);

  if (contact.loading) return <Spinner label="Loading contact" />;
  if (contact.error) return <ErrorBanner error={contact.error} onRetry={contact.refetch} />;
  if (!contact.data) return null;

  const person = contact.data;

  return (
    <div className="page page--contact-detail">
      <header className="contact-header">
        <Avatar name={fullName(person)} size={64} />
        <div>
          <h1>{fullName(person)}</h1>
          <p className="contact-header__subtitle">
            {person.jobTitle}
            {company.data && <> at {company.data.name}</>}
          </p>
          <div className="contact-header__tags">
            {person.tags.map((tag) => (
              <Tag key={tag} label={tag} />
            ))}
          </div>
        </div>
        <div className="contact-header__actions">
          <Badge tone={person.lifecycleStage}>{person.lifecycleStage}</Badge>
          {person.optedOut && <Badge tone="danger">Opted out</Badge>}
          <Button onClick={() => setEditing(true)}>Edit</Button>
        </div>
      </header>

      <div className="contact-detail__grid">
        <Card title="Details">
          <dl className="detail-list">
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${person.email}`}>{person.email}</a>
            </dd>
            <dt>Phone</dt>
            <dd>{person.phone || "—"}</dd>
            <dt>Owner</dt>
            <dd>{owner.name}</dd>
            <dt>Created</dt>
            <dd>{formatDate(person.createdAt)}</dd>
            <dt>Last contacted</dt>
            <dd>{person.lastContactedAt ? relativeTime(person.lastContactedAt) : "never"}</dd>
          </dl>
        </Card>

        <Card title="Notes">
          <div className="notes" dangerouslySetInnerHTML={{ __html: person.notes }} />
        </Card>

        <Card title="Deals">
          {deals.loading ? (
            <Spinner />
          ) : (
            <ul className="deal-list">
              {(deals.data?.items ?? []).map((deal) => (
                <li key={deal.id}>
                  <a href={`/deals/${deal.id}`}>{deal.title}</a>
                  <span>{formatMoney(deal.amount, deal.currency)}</span>
                  <Badge>{deal.stage}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Log activity">
          <LogActivityForm contactId={contactId} onLogged={activities.refetch} />
        </Card>

        <Card title="Timeline">
          {activities.loading ? (
            <Spinner />
          ) : (
            <ActivityFeed
              activities={(activities.data?.items ?? []) as Activity[]}
              onComplete={(id) => {
                completeActivity(id);
                activities.refetch();
              }}
            />
          )}
        </Card>
      </div>

      <Modal title="Edit contact" open={editing} onClose={() => setEditing(false)}>
        <ContactForm
          initial={person}
          saving={save.pending}
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            await save.run(values);
            push("success", "Contact updated");
            setEditing(false);
            contact.refetch();
          }}
        />
      </Modal>
    </div>
  );
}
