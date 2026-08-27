import { useEffect, useMemo, useState } from "react";
import { useFetch, useMutation } from "../hooks/useFetch";
import { getCompany, updateCompany } from "../api/companies";
import { listContacts } from "../api/contacts";
import { listDeals } from "../api/deals";
import { listActivities } from "../api/activities";
import { useToasts, useUser } from "../state/store";
import type { Contact, Deal } from "../types";
import { STAGE_LABELS } from "../types";
import { formatCompactMoney, formatMoney, formatNumber, fullName } from "../utils/format";
import { formatDate, relativeTime } from "../utils/dates";
import { findDuplicates } from "../utils/dedupe";
import { Avatar, Badge, Button, Card, ErrorBanner, Field, Spinner, Stat, Tag } from "../components/primitives";
import { ActivityFeed } from "../components/ActivityFeed";
import { EmailComposer } from "../components/EmailComposer";
import { Modal } from "../components/Modal";

export function CompanyDetail({ companyId }: { companyId: string }) {
  const { push } = useToasts();
  const [composing, setComposing] = useState(false);

  const company = useFetch((signal) => getCompany(companyId, signal), [companyId]);
  const contacts = useFetch((signal) => listContacts({ companyId, pageSize: 100 }, signal), [companyId]);
  const deals = useFetch((signal) => listDeals({ companyId, pageSize: 100 }, signal), [companyId]);
  const activities = useFetch((signal) => listActivities({ companyId, pageSize: 50 }, signal), [companyId]);

  const owner = useUser(company.data?.ownerId);
  const save = useMutation((patch: Parameters<typeof updateCompany>[1]) => updateCompany(companyId, patch));

  useEffect(() => {
    if (company.data) document.title = `${company.data.name} · CRM`;
  }, [company.data]);

  const people: Contact[] = contacts.data?.items ?? [];
  const dealList: Deal[] = deals.data?.items ?? [];

  const totals = useMemo(() => {
    const won = dealList.filter((d) => d.stage === "won");
    const open = dealList.filter((d) => d.stage !== "won" && d.stage !== "lost");
    return {
      lifetime: won.reduce((sum, d) => sum + d.amount, 0),
      open: open.reduce((sum, d) => sum + d.amount, 0),
      count: dealList.length,
    };
  }, [dealList]);

  const duplicates = useMemo(() => findDuplicates(people, 0.8), [people]);

  if (company.loading) return <Spinner label="Loading company" />;
  if (company.error) return <ErrorBanner error={company.error} onRetry={company.refetch} />;
  if (!company.data) return null;

  const record = company.data;

  return (
    <div className="page page--company-detail">
      <header className="company-header">
        <div>
          <h1>{record.name}</h1>
          <p className="company-header__subtitle">
            <a href={`https://${record.domain}`} target="_blank" rel="noreferrer">
              {record.domain}
            </a>{" "}
            · {record.industry} · {record.country}
          </p>
          <div className="company-header__tags">
            {record.tags.map((tag) => (
              <Tag key={tag} label={tag} />
            ))}
          </div>
        </div>
        <div className="company-header__actions">
          <Avatar name={owner.name} url={owner.avatarUrl} size={32} />
          <Button onClick={() => setComposing(true)} disabled={people.length === 0}>
            Email everyone
          </Button>
        </div>
      </header>

      <div className="company-detail__stats">
        <Stat label="Lifetime value" value={formatMoney(totals.lifetime)} />
        <Stat label="Open pipeline" value={formatCompactMoney(totals.open)} />
        <Stat label="Deals" value={String(totals.count)} />
        <Stat label="Contacts" value={String(people.length)} />
      </div>

      <div className="company-detail__grid">
        <Card title="Details">
          <Field label="Employees">
            <input
              type="number"
              defaultValue={record.employeeCount}
              onBlur={(e) => save.run({ employeeCount: Number(e.target.value) })}
            />
          </Field>
          <Field label="Annual revenue" hint="In euros">
            <input
              type="number"
              defaultValue={record.annualRevenue / 100}
              onBlur={(e) => save.run({ annualRevenue: Number(e.target.value) * 100 })}
            />
          </Field>
          <Field label="Website">
            <input defaultValue={record.website} onBlur={(e) => save.run({ website: e.target.value })} />
          </Field>
          <p className="hint">Added {formatDate(record.createdAt)}, updated {relativeTime(record.updatedAt)}</p>
        </Card>

        <Card title={`People (${formatNumber(people.length)})`}>
          {contacts.loading ? (
            <Spinner />
          ) : (
            <ul className="people-list">
              {people.map((person) => (
                <li key={person.id}>
                  <Avatar name={fullName(person)} size={24} />
                  <a href={`/contacts/${person.id}`}>{fullName(person)}</a>
                  <span className="people-list__title">{person.jobTitle}</span>
                  {person.optedOut && <Badge tone="danger">opted out</Badge>}
                </li>
              ))}
            </ul>
          )}

          {duplicates.length > 0 && (
            <div className="duplicate-warning">
              <strong>{duplicates.length} possible duplicates</strong>
              <ul>
                {duplicates.slice(0, 3).map((pair) => (
                  <li key={pair.a.id + pair.b.id}>
                    {fullName(pair.a)} ↔ {fullName(pair.b)} ({pair.reasons.join(", ")})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Deals">
          {deals.loading ? (
            <Spinner />
          ) : (
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Stage</th>
                  <th>Amount</th>
                  <th>Close</th>
                </tr>
              </thead>
              <tbody>
                {dealList.map((deal) => (
                  <tr key={deal.id}>
                    <td>
                      <a href={`/deals/${deal.id}`}>{deal.title}</a>
                    </td>
                    <td>
                      <Badge tone={deal.stage}>{STAGE_LABELS[deal.stage]}</Badge>
                    </td>
                    <td>{formatMoney(deal.amount, deal.currency)}</td>
                    <td>{formatDate(deal.expectedCloseDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Activity">
          {activities.loading ? <Spinner /> : <ActivityFeed activities={activities.data?.items ?? []} />}
        </Card>
      </div>

      <Modal title="Email everyone at this company" open={composing} onClose={() => setComposing(false)}>
        <EmailComposer
          recipients={people}
          onSent={() => {
            setComposing(false);
            push("success", "Emails logged");
            activities.refetch();
          }}
        />
      </Modal>
    </div>
  );
}
