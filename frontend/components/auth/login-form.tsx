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

const DEMO = { email: "owner@neobank.dev", password: "NeoBank@123" };

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Sign-in failed. Please try again.";
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await authApi.login({
        email: email.trim(),
        password,
      });

      /* The auth response only carries a hint; ask for the real next step. */
      let destination = routeForStep(result.onboarding.nextStep);

      try {
        const current = await businessApi.getCurrent();
        destination = routeForStep(current.onboarding.nextStep);
      } catch {
        /* Keep the hint if the follow-up read fails; the page guards itself. */
      }

      router.replace(destination);
    } catch (caught) {
      setError(messageOf(caught));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {error ? <Alert label="Could not sign in">{error}</Alert> : null}

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@company.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />

      <Field
        label="Password"
        name="password"
        type={showPassword ? "text" : "password"}
        autoComplete="current-password"
        placeholder="••••••••"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted transition-colors hover:text-teal"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        }
      />

      <div className="pt-1">
        <SubmitButton loading={submitting}>Sign in</SubmitButton>
      </div>

      <p className="text-[13px] leading-relaxed text-ink-muted">
        Opening an account for a company?{" "}
        <Link
          href="/register"
          className="text-ink underline decoration-teal/40 underline-offset-4 transition-colors hover:text-teal"
        >
          Register the business
        </Link>
        .
      </p>

      <div className="mt-2 border-t border-rule pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">Demo access</p>
          <button
            type="button"
            onClick={() => {
              setEmail(DEMO.email);
              setPassword(DEMO.password);
              setError(null);
            }}
            className="font-mono text-[9px] uppercase tracking-[0.18em] text-teal transition-opacity hover:opacity-70"
          >
            Fill credentials
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-[3.5rem_1fr] gap-y-1.5 font-mono text-[11px] text-ink-muted">
          <dt className="text-ink-muted/60">Email</dt>
          <dd className="truncate text-ink">{DEMO.email}</dd>
          <dt className="text-ink-muted/60">Password</dt>
          <dd className="text-ink">{DEMO.password}</dd>
        </dl>
      </div>
    </form>
  );
}
