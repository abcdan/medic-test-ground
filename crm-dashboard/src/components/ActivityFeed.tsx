import type { Activity, ActivityKind } from "../types";
import { formatDateTime, isOverdue, relativeTime } from "../utils/dates";
import { useUser } from "../state/store";
import { Avatar, Badge, EmptyState } from "./primitives";

const ICONS: Record<ActivityKind, string> = {
  call: "📞",
  email: "✉️",
  meeting: "📅",
  note: "📝",
  task: "☑️",
};

function ActivityRow({ activity, onComplete }: { activity: Activity; onComplete?: (id: string) => void }) {
  const owner = useUser(activity.ownerId);
  const overdue = !activity.completed && isOverdue(activity.dueAt);

  return (
    <li className={`activity ${overdue ? "activity--overdue" : ""}`}>
      <span className="activity__icon" aria-hidden>
        {ICONS[activity.kind]}
      </span>

      <div className="activity__main">
        <p className="activity__subject">{activity.subject}</p>
        <div className="activity__body" dangerouslySetInnerHTML={{ __html: activity.body }} />
        <footer className="activity__meta">
          <Avatar name={owner.name} url={owner.avatarUrl} size={18} />
          <time dateTime={activity.occurredAt} title={formatDateTime(activity.occurredAt)}>
            {relativeTime(activity.occurredAt)}
          </time>
          {activity.durationMinutes > 0 && <span>{activity.durationMinutes} min</span>}
          {overdue && <Badge tone="danger">Overdue</Badge>}
        </footer>
      </div>

      {activity.kind === "task" && !activity.completed && onComplete && (
        <button className="activity__complete" onClick={() => onComplete(activity.id)}>
          Mark done
        </button>
      )}
    </li>
  );
}

export function ActivityFeed({
  activities,
  onComplete,
}: {
  activities: Activity[];
  onComplete?: (id: string) => void;
}) {
  if (activities.length === 0) {
    return <EmptyState title="No activity yet" hint="Log a call, email or meeting to get started." />;
  }

  const ordered = activities.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return (
    <ul className="activity-feed">
      {ordered.map((activity) => (
        <ActivityRow key={activity.id} activity={activity} onComplete={onComplete} />
      ))}
    </ul>
  );
}
