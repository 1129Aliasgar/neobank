"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ApiClientError, tokenStore } from "@/lib/api";
import { authApi } from "@/lib/auth";
import { roleLabel } from "@/lib/dashboard";
import { teamApi, type InvitationPreview } from "@/lib/team";

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center bg-paper">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-ink-muted">
            Reading invitation…
          </p>
        </div>
      }
    >
      <InviteRoute />
    </Suspense>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiClientError || error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}

function InviteRoute() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const nextPath = `/dashboard/invite/${encodeURIComponent(token)}`;

  useEffect(() => {
    let active = true;

    void teamApi
      .resolve(token)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((caught) => {
        if (active) setError(messageOf(caught));
      });

    if (tokenStore.get()) {
      void authApi
        .session()
        .then((session) => {
          if (active) setSignedInEmail(session.user.email);
        })
        .catch(() => {
          if (active) setSignedInEmail(null);
        });
    }

    return () => {
      active = false;
    };
  }, [token]);

  async function accept() {
    setAccepting(true);
    setActionError(null);
    try {
      const result = await teamApi.accept(token);
      tokenStore.set(result.token);
      router.replace("/dashboard");
    } catch (caught) {
      setActionError(messageOf(caught));
      setAccepting(false);
    }
  }

  async function register(event: React.FormEvent) {
    event.preventDefault();
    setActionError(null);
    if (password !== confirm) {
      setActionError("Passwords do not match");
      return;
    }
    setRegistering(true);
    try {
      const result = await teamApi.register(token, { username, password });
      tokenStore.set(result.token);
      router.replace("/dashboard");
    } catch (caught) {
      setActionError(messageOf(caught));
      setRegistering(false);
    }
  }

  function switchAccount() {
    tokenStore.clear();
    router.push(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <main className="flex min-h-svh flex-col bg-paper">
      <header className="border-b border-rule bg-paper-raised px-5 py-4 sm:px-8">
        <Wordmark />
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-12 sm:px-8">
        <p className="eyebrow">Invitation</p>
        <h1 className="mt-4 font-heading text-[clamp(2.1rem,6vw,3.7rem)] font-light leading-[1.03] tracking-[-0.035em] text-ink">
          {preview
            ? `Join ${preview.invitation.business.legalName}`
            : "Open your invitation"}
        </h1>

        {error ? (
          <div className="mt-8">
            <Alert tone="error" label="Invitation">
              {error}
            </Alert>
            <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
              The link may have expired, been replaced, or already been used.
              Ask the person who invited you for a new link, or{" "}
              <Link
                href="/login"
                className="text-ink underline decoration-teal/40 underline-offset-4 hover:text-teal"
              >
                sign in
              </Link>
              .
            </p>
          </div>
        ) : null}

        {!preview && !error ? (
          <div className="mt-8 h-48 animate-pulse border border-rule bg-paper-raised" />
        ) : null}

        {preview ? (
          <>
            <div className="mt-6 border-y border-rule py-5">
              <dl className="grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                    Invited email
                  </dt>
                  <dd className="mt-1 break-all text-[13px] text-ink">
                    {preview.invitation.email}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                    Role
                  </dt>
                  <dd className="mt-1 text-[13px] text-ink">
                    {roleLabel(preview.invitation.role)}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                    Expires
                  </dt>
                  <dd className="mt-1 text-[13px] text-ink">
                    {new Date(preview.invitation.expiresAt).toLocaleDateString(
                      "en-US",
                      { day: "numeric", month: "short", year: "numeric" },
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            {actionError ? (
              <Alert tone="error" label="Could not join" className="mt-6">
                {actionError}
              </Alert>
            ) : null}

            {signedInEmail ? (
              <div className="mt-7">
                <p className="text-[13px] leading-relaxed text-ink">
                  You are signed in as{" "}
                  <span className="font-medium">{signedInEmail}</span>.
                </p>
                {signedInEmail.toLowerCase() !==
                preview.invitation.email.toLowerCase() ? (
                  <Alert tone="warn" label="Wrong account" className="mt-4">
                    This invitation was sent to{" "}
                    {preview.invitation.email}. Sign in with that address before
                    accepting.
                  </Alert>
                ) : null}
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <SubmitButton
                    type="button"
                    loading={accepting}
                    onClick={() => void accept()}
                  >
                    Accept invitation
                  </SubmitButton>
                  <button
                    type="button"
                    onClick={switchAccount}
                    className="h-12 border border-rule px-4 font-mono text-[10px] uppercase tracking-[0.18em] text-ink transition-colors hover:border-teal hover:text-teal"
                  >
                    Use another account
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-7 grid gap-8 lg:grid-cols-2">
                <div>
                  <h2 className="font-heading text-[1.3rem] font-light tracking-[-0.02em] text-ink">
                    Already have an account
                  </h2>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                    Sign in with{" "}
                    <span className="text-ink">
                      {preview.invitation.email}
                    </span>{" "}
                    and accept from this same link.
                  </p>
                  <Link
                    href={`/login?next=${encodeURIComponent(nextPath)}`}
                    className="mt-5 inline-flex h-12 w-full items-center justify-between border border-ink/25 px-4 font-mono text-[10px] uppercase tracking-[0.18em] text-ink transition-colors hover:border-teal hover:text-teal"
                  >
                    Sign in
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>

                <form
                  onSubmit={register}
                  className="border-t border-rule pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"
                >
                  <h2 className="font-heading text-[1.3rem] font-light tracking-[-0.02em] text-ink">
                    Create your account
                  </h2>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                    This creates a login for the invitation. It does not create a
                    business.
                  </p>
                  <div className="mt-5 flex flex-col gap-5">
                    <Field
                      label="Username"
                      name="invite-username"
                      autoComplete="username"
                      minLength={3}
                      maxLength={30}
                      required
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                    <Field
                      label="Password"
                      name="invite-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={72}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <Field
                      label="Confirm password"
                      name="invite-confirm"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={72}
                      required
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                    />
                  </div>
                  <div className="mt-5">
                    <SubmitButton type="submit" loading={registering}>
                      Join the team
                    </SubmitButton>
                  </div>
                </form>
              </div>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
