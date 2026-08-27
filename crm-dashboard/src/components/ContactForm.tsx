import { useEffect, useState } from "react";
import type { Contact } from "../types";
import { Button, Field } from "./primitives";

export interface ContactFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  companyId: string | null;
  lifecycleStage: Contact["lifecycleStage"];
  notes: string;
}

const BLANK: ContactFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  jobTitle: "",
  companyId: null,
  lifecycleStage: "lead",
  notes: "",
};

export function validate(values: ContactFormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!values.firstName.trim()) errors.firstName = "First name is required";
  if (!values.lastName.trim()) errors.lastName = "Last name is required";

  if (!values.email) {
    errors.email = "Email is required";
  } else if (!/^\S+@\S+$/.test(values.email)) {
    errors.email = "That does not look like an email address";
  }

  if (values.phone && !/^[\d\s+()-]{6,}$/.test(values.phone)) {
    errors.phone = "Phone can only contain digits and + ( ) -";
  }

  return errors;
}

export function ContactForm({
  initial,
  onSubmit,
  onCancel,
  saving,
}: {
  initial?: Partial<ContactFormValues>;
  onSubmit: (values: ContactFormValues) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const [values, setValues] = useState<ContactFormValues>({ ...BLANK, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setValues({ ...BLANK, ...initial });
  }, []);

  const set = <K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) => {
    setValues({ ...values, [key]: value });
    setTouched({ ...touched, [key]: true });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit(values);
  };

  return (
    <form className="contact-form" onSubmit={handleSubmit}>
      <div className="contact-form__row">
        <Field label="First name" hint={touched.firstName ? errors.firstName : undefined}>
          <input value={values.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </Field>
        <Field label="Last name" hint={touched.lastName ? errors.lastName : undefined}>
          <input value={values.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </Field>
      </div>

      <Field label="Email" hint={errors.email}>
        <input type="email" value={values.email} onChange={(e) => set("email", e.target.value)} />
      </Field>

      <Field label="Phone" hint={errors.phone}>
        <input value={values.phone} onChange={(e) => set("phone", e.target.value)} />
      </Field>

      <Field label="Job title">
        <input value={values.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
      </Field>

      <Field label="Lifecycle stage">
        <select
          value={values.lifecycleStage}
          onChange={(e) => set("lifecycleStage", e.target.value as Contact["lifecycleStage"])}
        >
          <option value="subscriber">Subscriber</option>
          <option value="lead">Lead</option>
          <option value="customer">Customer</option>
          <option value="evangelist">Evangelist</option>
        </select>
      </Field>

      <Field label="Notes" hint="Basic HTML is supported">
        <textarea rows={6} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <div className="contact-form__actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save contact"}
        </Button>
      </div>
    </form>
  );
}
