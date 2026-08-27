import { useMemo, useState } from "react";
import type { Contact } from "../types";
import { createContact } from "../api/contacts";
import { useToasts } from "../state/store";
import { email as validEmail, hasErrors, validateObject, required } from "../utils/validation";
import { Button, Card, Field, ProgressBar, Badge } from "./primitives";

/**
 * Three step CSV import: upload, map the columns, review and commit.
 */

type Step = "upload" | "map" | "review" | "done";

const TARGET_FIELDS = [
  { key: "firstName", label: "First name", required: true },
  { key: "lastName", label: "Last name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "phone", label: "Phone", required: false },
  { key: "jobTitle", label: "Job title", required: false },
  { key: "tags", label: "Tags", required: false },
] as const;

type TargetKey = (typeof TARGET_FIELDS)[number]["key"];

export interface ParsedFile {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string, delimiter = ","): ParsedFile {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const rows = lines.map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
  const [headers, ...body] = rows;
  return { headers, rows: body };
}

/** Guess which source column belongs to which target field. */
export function guessMapping(headers: string[]): Record<TargetKey, string> {
  const mapping = {} as Record<TargetKey, string>;

  for (const field of TARGET_FIELDS) {
    const match = headers.find(
      (header) => header.toLowerCase().replace(/[\s_]/g, "") === field.key.toLowerCase(),
    );
    if (match) mapping[field.key] = match;
  }

  return mapping;
}

interface RowResult {
  index: number;
  values: Record<TargetKey, string>;
  errors: Partial<Record<TargetKey, string>>;
}

export function ImportWizard({ onClose }: { onClose: () => void }) {
  const { push } = useToasts();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Record<TargetKey, string>>({} as Record<TargetKey, string>);
  const [progress, setProgress] = useState(0);
  const [imported, setImported] = useState(0);

  const handleFile = async (input: File) => {
    const text = await input.text();
    const parsed = parseCsv(text);
    setFile(parsed);
    setMapping(guessMapping(parsed.headers));
    setStep("map");
  };

  const results: RowResult[] = useMemo(() => {
    if (!file) return [];

    return file.rows.map((row, index) => {
      const values = {} as Record<TargetKey, string>;
      for (const field of TARGET_FIELDS) {
        const column = mapping[field.key];
        const at = file.headers.indexOf(column);
        values[field.key] = at >= 0 ? row[at] : "";
      }

      const errors = validateObject(values, {
        firstName: required("First name"),
        lastName: required("Last name"),
        email: validEmail,
      });

      return { index, values, errors };
    });
  }, [file, mapping]);

  const valid = results.filter((r) => !hasErrors(r.errors));
  const invalid = results.filter((r) => hasErrors(r.errors));

  const commit = async () => {
    let done = 0;
    for (const row of valid) {
      await createContact({
        firstName: row.values.firstName,
        lastName: row.values.lastName,
        email: row.values.email,
        phone: row.values.phone,
        jobTitle: row.values.jobTitle,
        tags: row.values.tags ? row.values.tags.split(";").map((t) => t.trim()) : [],
      } as Partial<Contact>);
      done++;
      setProgress(done / valid.length);
    }
    setImported(done);
    setStep("done");
    push("success", `Imported ${done} contacts`);
  };

  return (
    <div className="import-wizard">
      <ol className="import-wizard__steps">
        {(["upload", "map", "review", "done"] as Step[]).map((s) => (
          <li key={s} className={s === step ? "is-current" : undefined}>
            {s}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <Card title="Choose a file">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => e.target.files && handleFile(e.target.files[0])}
          />
          <p className="hint">
            The first row should be a header. Tags can be separated by semicolons.
          </p>
        </Card>
      )}

      {step === "map" && file && (
        <Card title="Map the columns">
          {TARGET_FIELDS.map((field) => (
            <Field key={field.key} label={field.label}>
              <select
                value={mapping[field.key] ?? ""}
                onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
              >
                <option value="">Skip</option>
                {file.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </Field>
          ))}

          <div className="import-wizard__actions">
            <Button variant="ghost" onClick={() => setStep("upload")}>
              Back
            </Button>
            <Button variant="primary" onClick={() => setStep("review")}>
              Review {file.rows.length} rows
            </Button>
          </div>
        </Card>
      )}

      {step === "review" && (
        <Card
          title="Review"
          action={
            <>
              <Badge tone="success">{valid.length} ready</Badge>
              {invalid.length > 0 && <Badge tone="danger">{invalid.length} with problems</Badge>}
            </>
          }
        >
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Row</th>
                {TARGET_FIELDS.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
                <th>Problems</th>
              </tr>
            </thead>
            <tbody>
              {results.slice(0, 50).map((row) => (
                <tr key={row.index} className={hasErrors(row.errors) ? "is-invalid" : undefined}>
                  <td>{row.index + 2}</td>
                  {TARGET_FIELDS.map((f) => (
                    <td key={f.key}>{row.values[f.key]}</td>
                  ))}
                  <td>{Object.values(row.errors).filter(Boolean).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {progress > 0 && <ProgressBar value={progress} max={1} />}

          <div className="import-wizard__actions">
            <Button variant="ghost" onClick={() => setStep("map")}>
              Back
            </Button>
            <Button variant="primary" onClick={commit} disabled={valid.length === 0}>
              Import {valid.length} contacts
            </Button>
          </div>
        </Card>
      )}

      {step === "done" && (
        <Card title="All done">
          <p>{imported} contacts imported.</p>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </Card>
      )}
    </div>
  );
}
