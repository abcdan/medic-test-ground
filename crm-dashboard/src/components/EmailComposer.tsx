import { useMemo, useState } from "react";
import { logActivity } from "../api/activities";
import { useStore, useToasts } from "../state/store";
import type { Contact } from "../types";
import { fullName } from "../utils/format";
import { email as validEmail } from "../utils/validation";
import { Button, Card, Field, Badge } from "./primitives";
import { NotesEditor } from "./NotesEditor";

/**
 * Compose an email to one or more contacts, with merge tags.
 *
 * `{{first_name}}`, `{{last_name}}`, `{{company}}` and `{{owner}}` are
 * replaced per recipient before sending.
 */

export interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "intro",
    name: "Introduction",
    subject: "Quick hello from {{owner}}",
    body: "<p>Hi {{first_name}},</p><p>I noticed {{company}} is growing fast…</p>",
  },
  {
    id: "follow-up",
    name: "Follow up",
    subject: "Following up on our chat",
    body: "<p>Hi {{first_name}},</p><p>Just circling back on the proposal.</p>",
  },
  {
    id: "renewal",
    name: "Renewal reminder",
    subject: "{{company}} renewal coming up",
    body: "<p>Hi {{first_name}},</p><p>Your subscription renews next month.</p>",
  },
];

const MERGE_TAGS = ["first_name", "last_name", "company", "owner"];

export function renderTemplate(
  text: string,
  values: Record<string, string>,
): string {
  let out = text;
  for (const tag of MERGE_TAGS) {
    out = out.replace(new RegExp(`{{${tag}}}`, "g"), values[tag] ?? "");
  }
  return out;
}

/** Tags in the text that have no value supplied. */
export function unresolvedTags(text: string, values: Record<string, string>): string[] {
  const found = text.match(/{{(\w+)}}/g) ?? [];
  return found
    .map((tag) => tag.slice(2, -2))
    .filter((tag) => !values[tag]);
}

export function EmailComposer({
  recipients,
  onSent,
}: {
  recipients: Contact[];
  onSent?: () => void;
}) {
  const { state } = useStore();
  const { push } = useToasts();

  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  const applyTemplate = (id: string) => {
    const template = TEMPLATES.find((t) => t.id === id);
    setTemplateId(id);
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
    }
  };

  const valuesFor = (contact: Contact): Record<string, string> => ({
    first_name: contact.firstName,
    last_name: contact.lastName,
    company: contact.companyId ?? "",
    owner: state.currentUser?.name ?? "",
  });

  const preview = useMemo(() => {
    const contact = recipients[previewIndex];
    if (!contact) return { subject, body };
    const values = valuesFor(contact);
    return {
      subject: renderTemplate(subject, values),
      body: renderTemplate(body, values),
    };
  }, [subject, body, recipients, previewIndex]);

  const problems = useMemo(() => {
    const out: string[] = [];
    const bad = recipients.filter((c) => validEmail(c.email) !== null);
    if (bad.length) out.push(`${bad.length} recipients have an invalid email`);

    const optedOut = recipients.filter((c) => c.optedOut);
    if (optedOut.length) out.push(`${optedOut.length} recipients have opted out`);

    const missing = unresolvedTags(subject + body, valuesFor(recipients[0] ?? ({} as Contact)));
    if (missing.length) out.push(`unresolved tags: ${missing.join(", ")}`);

    return out;
  }, [recipients, subject, body]);

  const send = async () => {
    setSending(true);
    for (const contact of recipients) {
      const values = valuesFor(contact);
      await logActivity({
        kind: "email",
        subject: renderTemplate(subject, values),
        body: renderTemplate(body, values),
        contactId: contact.id,
        occurredAt: new Date().toISOString(),
        completed: true,
      });
    }
    setSending(false);
    push("success", `Sent to ${recipients.length} recipients`);
    onSent?.();
  };

  return (
    <div className="email-composer">
      <Card title={`To ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`}>
        <div className="email-composer__chips">
          {recipients.slice(0, 8).map((contact) => (
            <span key={contact.id} className="chip">
              {fullName(contact)}
              {contact.optedOut && <Badge tone="danger">opted out</Badge>}
            </span>
          ))}
          {recipients.length > 8 && <span className="chip">+{recipients.length - 8} more</span>}
        </div>

        <Field label="Template">
          <select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Start from scratch</option>
            {TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Subject">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>

        <Field label="Body" hint={`Merge tags: ${MERGE_TAGS.map((t) => `{{${t}}}`).join(" ")}`}>
          <NotesEditor value={body} onSave={setBody} placeholder="Write your email…" />
        </Field>

        {problems.length > 0 && (
          <ul className="email-composer__problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <Button variant="primary" onClick={send} disabled={sending || recipients.length === 0}>
          {sending ? "Sending…" : `Send ${recipients.length}`}
        </Button>
      </Card>

      <Card title="Preview">
        <div className="email-composer__preview-nav">
          <button disabled={previewIndex === 0} onClick={() => setPreviewIndex(previewIndex - 1)}>
            ‹
          </button>
          <span>
            {previewIndex + 1} / {recipients.length}
          </span>
          <button
            disabled={previewIndex >= recipients.length - 1}
            onClick={() => setPreviewIndex(previewIndex + 1)}
          >
            ›
          </button>
        </div>

        <p className="email-composer__preview-subject">{preview.subject}</p>
        <div className="email-composer__preview-body" dangerouslySetInnerHTML={{ __html: preview.body }} />
      </Card>
    </div>
  );
}
