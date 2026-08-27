import { useMemo, useState } from "react";
import { DEAL_STAGES, STAGE_LABELS, STAGE_PROBABILITY, type Deal, type DealStage } from "../types";
import { formatCompactMoney, formatMoney } from "../utils/format";
import { relativeTime } from "../utils/dates";
import { useStore, useUser } from "../state/store";
import { moveDeal } from "../api/deals";
import { Avatar, Badge } from "./primitives";

function DealCard({ deal, onDragStart }: { deal: Deal; onDragStart: (id: string) => void }) {
  const owner = useUser(deal.ownerId);

  return (
    <article
      className="deal-card"
      draggable
      onDragStart={() => onDragStart(deal.id)}
      style={{ borderLeftColor: deal.stage === "lost" ? "#c33" : "#39c" }}
    >
      <h4 className="deal-card__title">{deal.title}</h4>
      <p className="deal-card__amount">{formatMoney(deal.amount, deal.currency)}</p>
      <footer className="deal-card__footer">
        <Avatar name={owner.name} url={owner.avatarUrl} size={20} />
        <span className="deal-card__date" title={deal.expectedCloseDate}>
          {relativeTime(deal.expectedCloseDate)}
        </span>
      </footer>
    </article>
  );
}

function StageColumn({
  stage,
  deals,
  onDrop,
  onDragStart,
}: {
  stage: DealStage;
  deals: Deal[];
  onDrop: (stage: DealStage) => void;
  onDragStart: (id: string) => void;
}) {
  const total = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const weighted = total * STAGE_PROBABILITY[stage];

  return (
    <section
      className="pipeline__column"
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDrop(stage)}
    >
      <header className="pipeline__column-header">
        <h3>{STAGE_LABELS[stage]}</h3>
        <Badge>{deals.length}</Badge>
        <span className="pipeline__total">{formatCompactMoney(total)}</span>
        <span className="pipeline__weighted">weighted {formatCompactMoney(weighted)}</span>
      </header>

      <div className="pipeline__cards">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onDragStart={onDragStart} />
        ))}
      </div>
    </section>
  );
}

export function PipelineBoard({ deals }: { deals: Deal[] }) {
  const { dispatch } = useStore();
  const [dragging, setDragging] = useState<string | null>(null);

  const byStage = useMemo(() => {
    const grouped: Record<DealStage, Deal[]> = {
      lead: [],
      qualified: [],
      proposal: [],
      negotiation: [],
      won: [],
      lost: [],
    };
    for (const deal of deals) {
      grouped[deal.stage].push(deal);
    }
    return grouped;
  }, [deals]);

  const handleDrop = (stage: DealStage) => {
    if (!dragging) return;
    dispatch({ type: "move-deal", id: dragging, stage });
    moveDeal(dragging, stage);
    setDragging(null);
  };

  return (
    <div className="pipeline">
      {DEAL_STAGES.map((stage) => (
        <StageColumn
          key={stage}
          stage={stage}
          deals={byStage[stage]}
          onDrop={handleDrop}
          onDragStart={setDragging}
        />
      ))}
    </div>
  );
}
