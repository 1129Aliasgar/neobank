"use client";

import { useCallback, useEffect, useState } from "react";
import { OnboardingGate } from "@/components/app/onboarding-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Refusal } from "@/components/dashboard/refusal";
import { Alert, StatusPill } from "@/components/ui/alert";
import { Field, SelectField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ApiClientError } from "@/lib/api";
import { formatDate, roleLabel } from "@/lib/dashboard";
import {
  teamApi,
  type InvitationLinkResult,
  type InvitableRole,
  type TeamMember,
  type TeamView,
} from "@/lib/team";
import { formatMinor, parseDollarsToMinor } from "@/lib/money";
import type { CurrentBusiness } from "@/lib/business";

export default function TeamPage() {
  return (
    <OnboardingGate allow={["DONE"]}>
      {(current) =>
        current.role === "OWNER" || current.role === "ADMIN" ? (
          <DashboardShell current={current}>
            <TeamContent current={current} />
          </DashboardShell>
        ) : (
          <Refusal role={current.role} />
        )
      }
    </OnboardingGate>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiClientError || error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}

/** The threshold input accepts `0`, which the money parser deliberately rejects. */
function parseThreshold(input: string): string {
  const value = input.trim();
  if (value === "0" || value === "0.00") return "0";
  return parseDollarsToMinor(value);
}

function TeamContent({ current }: { current: CurrentBusiness }) {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkResult, setLinkResult] = useState<InvitationLinkResult | null>(
    null,
  );
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableRole>("EMPLOYEE");
  const [inviting, setInviting] = useState(false);
  const [threshold, setThreshold] = useState("");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [copied, setCopied] = useState(false);

  const applyTeam = useCallback((next: TeamView) => {
    setTeam(next);
    setThreshold(
      (Number(next.policy.approvalThresholdMinor) / 100).toFixed(
        next.policy.approvalThresholdMinor === "0" ? 0 : 2,
      ),
    );
  }, []);

  const load = useCallback(async () => {
    try {
      applyTeam(await teamApi.current());
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, [applyTeam]);

  useEffect(() => {
    let active = true;

    void teamApi
      .current()
      .then((next) => {
        if (active) applyTeam(next);
      })
      .catch((caught) => {
        if (active) setError(messageOf(caught));
      });

    return () => {
      active = false;
    };
  }, [applyTeam]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setInviting(true);
    setError(null);
    setNotice(null);
    setCopied(false);
    try {
      const result = await teamApi.invite({ email, role: inviteRole });
      setLinkResult(result);
      setEmail("");
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setInviting(false);
    }
  }

  async function copyLink() {
    if (!linkResult) return;
    try {
      await navigator.clipboard.writeText(linkResult.link);
      setCopied(true);
    } catch {
      setError("Could not copy automatically. Select the link and copy it.");
    }
  }

  async function resend(id: string) {
    setError(null);
    setNotice(null);
    setCopied(false);
    try {
      const result = await teamApi.resend(id);
      setLinkResult(result);
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function revoke(id: string) {
    setError(null);
    setNotice(null);
    try {
      await teamApi.revoke(id);
      setNotice("Invitation revoked. The old link no longer works.");
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function savePolicy(event: React.FormEvent) {
    event.preventDefault();
    setSavingPolicy(true);
    setError(null);
    setNotice(null);
    try {
      const amountMinor = parseThreshold(threshold);
      const policy = await teamApi.updatePolicy({
        approvalThresholdMinor: amountMinor,
      });
      setTeam((previous) => (previous ? { ...previous, policy } : previous));
      setNotice("Approval policy updated.");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSavingPolicy(false);
    }
  }

  if (!team && !error) {
    return (
      <div className="animate-rise">
        <p className="eyebrow">Business account / team</p>
        <div className="mt-6 h-10 w-48 animate-pulse bg-ink/5" />
        <div className="mt-8 space-y-px border border-rule bg-rule">
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className="h-20 animate-pulse bg-paper-raised"
            />
          ))}
        </div>
      </div>
    );
  }

  const pendingInvitations = team?.invitations ?? [];
  const staff = (team?.members ?? []).filter(
    (member) => member.role !== "OPERATIONS",
  );

  return (
    <div className="animate-rise">
      <p className="eyebrow">Business account / team</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-6">
        <div className="min-w-0">
          <h1 className="font-heading text-[clamp(2.2rem,5vw,3.8rem)] font-light tracking-[-0.035em] text-ink">
            Team
          </h1>
          <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-ink-muted">
            Invite a person, change their role, or disable access. A disabled
            member keeps their history but loses their session immediately.
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          {staff.length} member{staff.length === 1 ? "" : "s"}
          <span className="px-1.5 text-teal">·</span>
          {pendingInvitations.length} pending
        </p>
      </div>

      {error ? (
        <Alert tone="error" label="Team" className="mt-6">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" label="Team" className="mt-6">
          {notice}
        </Alert>
      ) : null}

      {linkResult ? (
        <section className="mt-6 border border-teal/35 bg-teal/[0.05] p-4 sm:p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-teal">
            One-time invitation link
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-ink">
            Share this link yourself. No email is sent by NeoBank. The raw token
            is shown only here and only once.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={linkResult.link}
              aria-label="Invitation link"
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 border border-rule bg-paper-raised px-3 py-2.5 font-mono text-[11px] text-ink"
            />
            <button
              type="button"
              onClick={() => void copyLink()}
              className="h-11 shrink-0 border border-ink/25 px-4 font-mono text-[10px] uppercase tracking-[0.18em] text-ink transition-colors hover:border-teal hover:text-teal"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
            {linkResult.invitation.email}
            <span className="px-1.5 text-teal">·</span>
            {roleLabel(linkResult.invitation.role)}
            <span className="px-1.5 text-teal">·</span>
            expires {formatDate(linkResult.invitation.expiresAt)}
          </p>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-[1.35rem] font-light tracking-[-0.02em] text-ink">
            Members
          </h2>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
            Owner and admin can invite
          </p>
        </div>
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          {(team?.members ?? []).map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              businessCurrency={team?.business.currency ?? "USD"}
              canManage={current.role === "OWNER"}
              onChanged={() => void load()}
            />
          ))}
        </ul>
      </section>

      <section className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div>
          <h2 className="font-heading text-[1.35rem] font-light tracking-[-0.02em] text-ink">
            Pending invitations
          </h2>
          {pendingInvitations.length === 0 ? (
            <p className="mt-3 border border-rule bg-paper-raised p-4 text-[12px] leading-relaxed text-ink-muted">
              No pending invitations. An invitation link is valid for seven days
              and can be revoked or replaced.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-rule border-y border-rule">
              {pendingInvitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink">
                      {invitation.email}
                    </p>
                    <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
                      {roleLabel(invitation.role)}
                      <span className="px-1.5 text-teal">·</span>
                      expires {formatDate(invitation.expiresAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void resend(invitation.id)}
                      className="font-mono text-[9px] uppercase tracking-[0.16em] text-teal underline decoration-teal/30 underline-offset-4"
                    >
                      New link
                    </button>
                    <button
                      type="button"
                      onClick={() => void revoke(invitation.id)}
                      className="font-mono text-[9px] uppercase tracking-[0.16em] text-vermilion underline decoration-vermilion/30 underline-offset-4"
                    >
                      Revoke
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={invite} className="mt-6 border border-rule p-4 sm:p-5">
            <p className="eyebrow">Invite a person</p>
            <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <Field
                label="Email"
                name="invite-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                hint="The invited person must sign in or register with this address."
              />
              <SelectField
                label="Role"
                name="invite-role"
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as InvitableRole)
                }
                options={[
                  { value: "EMPLOYEE", label: "Employee" },
                  { value: "ADMIN", label: "Admin" },
                ]}
              />
            </div>
            <div className="mt-5">
              <SubmitButton type="submit" loading={inviting}>
                Create invitation link
              </SubmitButton>
            </div>
          </form>
        </div>

        <div>
          <h2 className="font-heading text-[1.35rem] font-light tracking-[-0.02em] text-ink">
            Approval policy
          </h2>
          <div className="mt-3 border border-rule bg-paper-raised p-4 sm:p-5">
            <p className="text-[13px] leading-relaxed text-ink">
              {team?.policy.approvalThresholdMinor === "0"
                ? "Every payment requires a second person."
                : `Payments of ${formatMinor(
                    team?.policy.approvalThresholdMinor ?? "0",
                    team?.policy.currency ?? "USD",
                  )} or more require a second person.`}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
              The maker-checker rule cannot be switched off. A payment creator
              can never approve their own request, even below the threshold.
            </p>
            {current.role === "OWNER" ? (
              <form onSubmit={savePolicy} className="mt-5">
                <Field
                  label="Threshold in USD"
                  name="approval-threshold"
                  inputMode="decimal"
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                  hint="Use 0 to require approval for every payment."
                />
                <div className="mt-4">
                  <SubmitButton type="submit" loading={savingPolicy}>
                    Save threshold
                  </SubmitButton>
                </div>
              </form>
            ) : (
              <p className="mt-4 border-t border-rule pt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted">
                Only the owner can change the threshold
              </p>
            )}
            <p className="mt-4 border-t border-rule pt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
              Payment rail: simulator
              <span className="px-1.5 text-teal">·</span>
              no bank transfer
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function MemberRow({
  member,
  businessCurrency,
  canManage,
  onChanged,
}: {
  member: TeamMember;
  businessCurrency: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [role, setRole] = useState<InvitableRole>(
    member.role === "ADMIN" ? "ADMIN" : "EMPLOYEE",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = member.status === "ACTIVE";
  const editable = canManage && active && !member.isYou && member.role !== "OWNER";

  async function saveRole() {
    setBusy(true);
    setError(null);
    try {
      await teamApi.changeRole(member.id, role);
      onChanged();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (
      !window.confirm(
        `Disable ${member.user.email}? Their current session ends immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await teamApi.disable(member.id);
      onChanged();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
            <span className="truncate">{member.user.username}</span>
            {member.isYou ? (
              <span className="border border-rule px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-ink-muted">
                You
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
            {member.user.email}
          </p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted/80">
            Joined {formatDate(member.joinedAt)}
            <span className="px-1.5 text-teal">·</span>
            {businessCurrency}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex items-center gap-3">
            <StatusPill
              label={roleLabel(member.role)}
              tone={
                member.role === "OWNER"
                  ? "positive"
                  : member.role === "ADMIN"
                    ? "progress"
                    : "neutral"
              }
            />
            <StatusPill
              label={active ? "Active" : member.status.toLowerCase()}
              tone={
                active
                  ? "positive"
                  : member.status === "DISABLED"
                    ? "negative"
                    : "attention"
              }
            />
          </div>

          {editable ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Role for ${member.user.email}`}
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as InvitableRole)
                }
                disabled={busy}
                className="h-9 border border-rule bg-paper-raised px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink"
              >
                <option value="EMPLOYEE">Employee</option>
                <option value="ADMIN">Admin</option>
              </select>
              <button
                type="button"
                onClick={() => void saveRole()}
                disabled={busy || role === member.role}
                className="h-9 border border-ink/25 px-3 font-mono text-[9px] uppercase tracking-[0.16em] text-ink transition-colors hover:border-teal hover:text-teal disabled:opacity-40"
              >
                Save role
              </button>
              <button
                type="button"
                onClick={() => void disable()}
                disabled={busy}
                className="h-9 border border-vermilion/35 px-3 font-mono text-[9px] uppercase tracking-[0.16em] text-vermilion transition-colors hover:bg-vermilion/[0.06] disabled:opacity-40"
              >
                Disable
              </button>
            </div>
          ) : member.role === "OWNER" ? (
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted/70">
              Owner is protected
            </p>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-vermilion">
          {error}
        </p>
      ) : null}
    </li>
  );
}
