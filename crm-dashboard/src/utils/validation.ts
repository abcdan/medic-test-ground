/** Shared field validation used by the forms and the CSV importer. */

export type Validator<T> = (value: T) => string | null;

export const required =
  (label: string): Validator<string> =>
  (value) =>
    value && value.trim().length > 0 ? null : `${label} is required`;

export const maxLength =
  (limit: number): Validator<string> =>
  (value) =>
    value.length <= limit ? null : `Must be ${limit} characters or fewer`;

export const minLength =
  (limit: number): Validator<string> =>
  (value) =>
    value.length >= limit ? null : `Must be at least ${limit} characters`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const email: Validator<string> = (value) =>
  !value || EMAIL_RE.test(value) ? null : "That does not look like an email address";

const URL_RE = /^https?:\/\/[^\s]+$/;

export const url: Validator<string> = (value) =>
  !value || URL_RE.test(value) ? null : "Must start with http:// or https://";

const PHONE_RE = /^[\d\s+()-]{6,20}$/;

export const phone: Validator<string> = (value) =>
  !value || PHONE_RE.test(value) ? null : "Only digits, spaces and + ( ) - please";

export const positiveNumber: Validator<string> = (value) => {
  const n = Number(value);
  if (Number.isNaN(n)) return "Must be a number";
  return n > 0 ? null : "Must be greater than zero";
};

export const isoDate: Validator<string> = (value) =>
  !value || /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "Use YYYY-MM-DD";

/** Run several validators, returning the first complaint. */
export function all<T>(...validators: Validator<T>[]): Validator<T> {
  return (value) => {
    for (const validator of validators) {
      const problem = validator(value);
      if (problem) return problem;
    }
    return null;
  };
}

export type Schema<T> = { [K in keyof T]?: Validator<T[K]> };

/** Validate an object against a schema of per-field validators. */
export function validateObject<T extends Record<string, unknown>>(
  values: T,
  schema: Schema<T>,
): Partial<Record<keyof T, string>> {
  const errors: Partial<Record<keyof T, string>> = {};

  for (const key of Object.keys(schema) as (keyof T)[]) {
    const validator = schema[key];
    if (!validator) continue;
    const problem = validator(values[key]);
    if (problem) errors[key] = problem;
  }

  return errors;
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some(Boolean);
}

/** Normalise an email for comparison. */
export function normaliseEmail(value: string): string {
  const [local, domain] = value.trim().toLowerCase().split("@");
  if (!domain) return value.trim().toLowerCase();
  const withoutTag = local.split("+")[0];
  return `${withoutTag.replace(/\./g, "")}@${domain}`;
}

/** Normalise a phone number to digits only, keeping a leading plus. */
export function normalisePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

/** Pull the registrable domain out of an email or url. */
export function domainOf(value: string): string {
  if (value.includes("@")) return value.split("@")[1].toLowerCase();
  return value.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
}
