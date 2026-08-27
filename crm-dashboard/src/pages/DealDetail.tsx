import { useEffect, useMemo, useState } from "react";
import { useFetch, useMutation } from "../hooks/useFetch";
import { getDeal, updateDeal, moveDeal } from "../api/deals";
import { getCompany } from "../api/companies";
import { getContact } from "../api/contacts";
import { listActivities, logActivity } from "../api/activities";
import { useStore, useToasts, useUser } from "../state/store";
import { DEAL_STAGES, STAGE_LABELS, STAGE_PROBABILITY, type DealStage } from "../types";
import { formatMoney, formatPercent } from "../utils/format";
import { daysBetween, formatDate, relativeTime, today } from "../utils/dates";
import { Avatar, Badge, Button, Card, ErrorBanner, Field, ProgressBar, Spinner } from "../components/primitives";
import { ActivityFeed } from "../components/ActivityFeed";
import { NotesEditor } from "../components/NotesEditor";
import { ConfirmDialog } from "../components/Modal";

function StageStepper({ current, onChange }: { current: DealStage; onChange: (stage: DealStage) => void }) {
  const currentIndex = DEAL_STAGES.indexOf(current);

  return (
    <ol className="stepper">
      {DEAL_STAGES.map((stage, index) => (
        <li
          key={stage}
          className={`stepper__step ${index <= currentIndex ? "is-done" : ""} ${stage === current ? "is-current" : ""}`}
          onClick={() => onChange(stage)}
        >
          <span className="stepper__dot">{index + 1}</span>
          <span className="stepper__label">{STAGE_LABELS[stage]}</span>
        </li>
      ))}
    </ol>
  );
}

export function DealDetail({ dealId }: { dealId: string }) {
  const { dispatch } = useStore();
  const { push } = useToasts();

  const [confirmLoss, setConfirmLoss] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [notes, setNotes] = useState("");

  const deal = useFetch((signal) => getDeal(dealId, signal), [dealId]);
  const activities = useFetch((signal) => listActivities({ dealId }, signal), [dealId]);
  const company = useFetch(
    (signal) => getCompany(deal.data!.companyId, signal),
    [deal.data?.companyId],
  );
  const contact = useFetch(
    (signal) => getContact(deal.data!.primaryContactId!, signal),
    [deal.data?.primaryContactId],
  );

  const owner = useUser(deal.data?.ownerId);
  const save = useMutation((patch: Parameters<typeof updateDeal>[1]) => updateDeal(dealId, patch));

  useEffect(() => {
    if (deal.data) document.title = `${deal.data.title} · CRM`;
  }, [deal.data]);

  const age = useMemo(
    () => (deal.data ? daysBetween(deal.data.createdAt, today()) : 0),
    [deal.data],
  );

  if (deal.loading) return <Spinner label="Loading deal" />;
  if (deal.error) return <ErrorBanner error={deal.error} onRetry={deal.refetch} />;
  if (!deal.data) return null;

  const record = deal.data;
  const weighted = record.amount * STAGE_PROBABILITY[record.stage];

  const changeStage = async (stage: DealStage) => {
    if (stage === "lost") {
      setConfirmLoss(true);
      return;
    }
    dispatch({ type: "move-deal", id: dealId, stage });
    await moveDeal(dealId, stage);
    push("success", `Moved to ${STAGE_LABELS[stage]}`);
    deal.refetch();
  };

  return (
    <div className="page page--deal-detail">
      <header className="deal-header">
        <div>
          <h1>{record.title}</h1>
          <p className="deal-header__subtitle">
            {company.data?.name ?? "No company"} · {formatMoney(record.amount, record.currency)}
          </p>
        </div>
        <div className="deal-header__meta">
          <Badge tone={record.stage}>{STAGE_LABELS[record.stage]}</Badge>
          <Avatar name={owner.name} url={owner.avatarUrl} size={32} />
        </div>
      </header>

      <StageStepper current={record.stage} onChange={changeStage} />

      <div className="deal-detail__grid">
        <Card title="Summary">
          <dl className="detail-list">
            <dt>Amount</dt>
            <dd>{formatMoney(record.amount, record.currency)}</dd>
            <dt>Weighted</dt>
            <dd>
              {formatMoney(weighted, record.currency)} at {formatPercent(STAGE_PROBABILITY[record.stage])}
            </dd>
            <dt>Expected close</dt>
            <dd>{formatDate(record.expectedCloseDate)}</dd>
            <dt>Age</dt>
            <dd>{age} days</dd>
            <dt>Source</dt>
            <dd>{record.source || "—"}</dd>
            <dt>Primary contact</dt>
            <dd>
              {contact.data ? (
                <a href={`/contacts/${contact.data.id}`}>
                  {contact.data.firstName} {contact.data.lastName}
                </a>
              ) : (
                "—"
              )}
            </dd>
            {record.lostReason && (
              <>
                <dt>Lost reason</dt>
                <dd>{record.lostReason}</dd>
              </>
            )}
          </dl>
        </Card>

        <Card title="Progress">
          <ProgressBar value={DEAL_STAGES.indexOf(record.stage) + 1} max={DEAL_STAGES.length} />
          <p>
            Created {relativeTime(record.createdAt)}, last updated {relativeTime(record.updatedAt)}
          </p>
        </Card>

        <Card title="Edit">
          <Field label="Title">
            <input
              defaultValue={record.title}
              onBlur={(e) => save.run({ title: e.target.value })}
            />
          </Field>
          <Field label="Amount" hint="In euros">
            <input
              type="number"
              defaultValue={record.amount / 100}
              onBlur={(e) => save.run({ amount: Number(e.target.value) * 100 })}
            />
          </Field>
          <Field label="Expected close">
            <input
              type="date"
              defaultValue={record.expectedCloseDate}
              onBlur={(e) => save.run({ expectedCloseDate: e.target.value })}
            />
          </Field>
        </Card>

        <Card title="Notes">
          <NotesEditor value={notes} onSave={setNotes} />
        </Card>

        <Card title="Activity">
          {activities.loading ? <Spinner /> : <ActivityFeed activities={activities.data?.items ?? []} />}
          <Button
            onClick={() => {
              logActivity({
                kind: "note",
                subject: "Quick note",
                body: notes,
                dealId,
                occurredAt: new Date().toISOString(),
              });
              activities.refetch();
            }}
          >
            Log note
          </Button>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmLoss}
        title="Mark as lost"
        message="Tell us why so the reporting stays useful."
        confirmLabel="Mark lost"
        onCancel={() => setConfirmLoss(false)}
        onConfirm={async () => {
          await save.run({ stage: "lost", lostReason });
          setConfirmLoss(false);
          push("info", "Deal marked lost");
          deal.refetch();
        }}
      />
    </div>
  );
}
