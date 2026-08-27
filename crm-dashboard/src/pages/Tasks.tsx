import { useEffect, useMemo, useState } from "react";
import { useFetch } from "../hooks/useFetch";
import { listActivities, completeActivity, logActivity } from "../api/activities";
import { useStore, useToasts, useUser } from "../state/store";
import type { Activity } from "../types";
import { addDays, formatDate, isOverdue, relativeTime, today } from "../utils/dates";
import { groupBy } from "../utils/sort";
import { Avatar, Badge, Button, Card, EmptyState, ErrorBanner, Field, Spinner } from "../components/primitives";

type Bucket = "overdue" | "today" | "week" | "later" | "done";

function bucketOf(task: Activity): Bucket {
  if (task.completed) return "done";
  if (!task.dueAt) return "later";
  if (isOverdue(task.dueAt)) return "overdue";

  const due = task.dueAt.slice(0, 10);
  if (due === today()) return "today";
  if (due <= addDays(today(), 7)) return "week";
  return "later";
}

const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "This week",
  later: "Later",
  done: "Completed",
};

function TaskRow({ task, onDone }: { task: Activity; onDone: () => void }) {
  const owner = useUser(task.ownerId);

  return (
    <li className={`task ${task.completed ? "task--done" : ""}`}>
      <input
        type="checkbox"
        checked={task.completed}
        onChange={() => {
          completeActivity(task.id);
          onDone();
        }}
      />
      <div className="task__main">
        <span className="task__subject">{task.subject}</span>
        {task.dueAt && (
          <time className="task__due" dateTime={task.dueAt}>
            {relativeTime(task.dueAt)}
          </time>
        )}
      </div>
      <Avatar name={owner.name} url={owner.avatarUrl} size={20} />
      {isOverdue(task.dueAt) && !task.completed && <Badge tone="danger">Late</Badge>}
    </li>
  );
}

export function Tasks() {
  const { state } = useStore();
  const { push } = useToasts();

  const [subject, setSubject] = useState("");
  const [dueAt, setDueAt] = useState(today());
  const [showDone, setShowDone] = useState(false);

  const tasks = useFetch(
    (signal) => listActivities({ kind: "task", pageSize: 200 }, signal),
    [showDone],
  );

  const items = tasks.data?.items ?? [];

  const buckets = useMemo(() => groupBy(items, bucketOf), [items]);

  const order: Bucket[] = showDone
    ? ["overdue", "today", "week", "later", "done"]
    : ["overdue", "today", "week", "later"];

  const addTask = async () => {
    await logActivity({
      kind: "task",
      subject,
      dueAt,
      completed: false,
      ownerId: state.currentUser?.id,
      occurredAt: new Date().toISOString(),
    });
    setSubject("");
    push("success", "Task added");
    tasks.refetch();
  };

  if (tasks.error) return <ErrorBanner error={tasks.error} onRetry={tasks.refetch} />;

  return (
    <div className="page page--tasks">
      <header className="page__header">
        <h1>Tasks</h1>
        <label className="switch">
          <input type="checkbox" checked={showDone} onChange={() => setShowDone(!showDone)} />
          Show completed
        </label>
      </header>

      <Card title="Add a task">
        <div className="task-form">
          <Field label="What needs doing?">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Due">
            <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={addTask} disabled={!subject}>
            Add
          </Button>
        </div>
      </Card>

      {tasks.loading ? (
        <Spinner />
      ) : (
        order.map((bucket) => {
          const list = buckets[bucket] ?? [];
          if (list.length === 0) return null;

          return (
            <Card key={bucket} title={`${BUCKET_LABELS[bucket]} (${list.length})`}>
              <ul className="task-list">
                {list.map((task) => (
                  <TaskRow key={task.id} task={task} onDone={tasks.refetch} />
                ))}
              </ul>
            </Card>
          );
        })
      )}

      {items.length === 0 && !tasks.loading && (
        <EmptyState title="Nothing on your plate" hint="Add a task above to get started." />
      )}
    </div>
  );
}
