"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { authApi } from "@/lib/auth";
import { businessApi, routeForStep } from "@/lib/business";

type FieldName =
  | "businessName"
  | "username"
  | "email"
  | "password"
  | "confirmPassword";

type FieldErrors = Partial<Record<FieldName, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME = /^[a-zA-Z0-9._-]{3,30}$/;

function validate(values: {
  businessName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  if (values.businessName.trim().length < 2) {
    errors.businessName = "Enter the registered name of the business";
  }

  if (!USERNAME.test(values.username.trim())) {
    errors.username =
      "3–30 characters; letters, numbers, dots, underscores and dashes";
  }

  if (!EMAIL.test(values.email.trim())) {
    errors.email = "Enter a valid email address";
  }

  if (values.password.length < 8) {
    errors.password = "At least 8 characters";
  } else if (values.password.length > 72) {
    errors.password = "At most 72 characters";
  }

  if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Passwords do not match";
  }

  return errors;
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Registration failed. Please try again.";
}

export function RegisterForm() {
  const router = useRouter();
  const [values, setValues] = useState({
    businessName: "",
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));

    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const found = validate(values);

    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    setErrors({});
    setSubmitting(true);

    try {
      const result = await authApi.register({
        businessName: values.businessName.trim(),
        username: values.username.trim().toLowerCase(),
        email: values.email.trim(),
        password: values.password,
        country: "US",
      });

      /* A new account always lands on profile completion, but ask the source. */
      let destination = routeForStep(result.onboarding.nextStep);

      try {
        const current = await businessApi.getCurrent();
        destination = routeForStep(current.onboarding.nextStep);
      } catch {
        /* fall back to the hint */
      }

      router.replace(destination);
    } catch (caught) {
      setFormError(messageOf(caught));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {formError ? <Alert label="Could not register">{formError}</Alert> : null}

      <Field
        label="Registered business name"
        name="businessName"
        autoComplete="organization"
        placeholder="Northwind Labs LLC"
        value={values.businessName}
        onChange={(event) => update("businessName", event.target.value)}
        error={errors.businessName}
        required
      />

      <Field
        label="Your username"
        name="username"
        autoComplete="username"
        placeholder="jane.doe"
        value={values.username}
        onChange={(event) => update("username", event.target.value)}
        error={errors.username}
        hint="You are the owner of this business account."
        required
      />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@company.com"
        value={values.email}
        onChange={(event) => update("email", event.target.value)}
        error={errors.email}
        required
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={values.password}
          onChange={(event) => update("password", event.target.value)}
          error={errors.password}
          required
        />

        <Field
          label="Confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={values.confirmPassword}
          onChange={(event) => update("confirmPassword", event.target.value)}
          error={errors.confirmPassword}
          required
        />
      </div>

      <div className="pt-1">
        <SubmitButton loading={submitting}>Create account</SubmitButton>
      </div>

      <p className="text-[13px] leading-relaxed text-ink-muted">
        Already registered?{" "}
        <Link
          href="/login"
          className="text-ink underline decoration-teal/40 underline-offset-4 transition-colors hover:text-teal"
        >
          Sign in
        </Link>
        .
      </p>

      <p className="border-t border-rule pt-4 font-mono text-[9px] leading-relaxed uppercase tracking-[0.16em] text-ink-muted/70">
        Registration always creates the business owner. Team roles are assigned
        later by an owner or admin.
      </p>
    </form>
  );
}
