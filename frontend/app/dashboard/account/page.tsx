"use client";

import { useEffect, useState } from "react";
import { OnboardingGate } from "@/components/app/onboarding-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Refusal } from "@/components/dashboard/refusal";
import { BalanceCard } from "@/components/money/balance-card";
import { SubmitButton } from "@/components/ui/submit-button";
import { ApiClientError } from "@/lib/api";
import { accountApi, type AccountView } from "@/lib/account";
import { parseDollarsToMinor } from "@/lib/money";
import type { CurrentBusiness } from "@/lib/business";

export default function AccountPage() {
  return <OnboardingGate allow={["DONE"]}>{(current) => current.role === "EMPLOYEE" || current.role === "OPERATIONS" ? <Refusal role={current.role} /> : <AccountContent current={current} />}</OnboardingGate>;
}

function AccountContent({ current }: { current: CurrentBusiness }) {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { void accountApi.current().then(setAccount).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load the account.")); }, []);

  async function fund(event: React.FormEvent) {
    event.preventDefault(); setError(null); setMessage(null);
    try {
      const amountMinor = parseDollarsToMinor(amount);
      if (BigInt(amountMinor) > BigInt(5_000_000)) throw new Error("Sandbox funding is limited to $50,000.00 per deposit.");
      const result = await accountApi.deposit({ amountMinor, memo }, `web-${crypto.randomUUID()}`);
      setAccount((previous) => previous ? { ...previous, balance: result.balance } : previous);
      setAmount(""); setMemo(""); setMessage("Sandbox funds added");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : caught instanceof Error ? caught.message : "Could not add funds.");
    }
  }

  return <DashboardShell current={current}><div className="animate-rise"><p className="eyebrow">Business account / funds</p><h1 className="mt-4 font-heading text-[clamp(2.2rem,5vw,3.8rem)] font-light tracking-[-0.035em] text-ink">Account</h1><p className="mt-3 max-w-xl text-[13px] leading-relaxed text-ink-muted">The balance is derived from permanent ledger entries and active authorisations.</p>{error ? <p role="alert" className="mt-6 border-l-2 border-vermilion py-2 pl-3 text-[13px] text-vermilion">{error}</p> : null}{account ? <div className="mt-8"><BalanceCard account={account} /><form onSubmit={fund} className="mt-8 max-w-xl border-t border-rule pt-6"><p className="eyebrow">Sandbox funding</p><p className="mt-2 text-[12px] text-ink-muted">No real money moves. Labelled sandbox funding. Maximum $50,000.00 per deposit.</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="25.00" aria-label="Amount in dollars" className="border border-rule bg-paper-raised px-3 py-2.5 text-[13px] text-ink" /><input value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Memo (optional)" aria-label="Funding memo" className="border border-rule bg-paper-raised px-3 py-2.5 text-[13px] text-ink" /></div><div className="mt-4 flex items-center gap-4"><SubmitButton type="submit">Add sandbox funds</SubmitButton>{message ? <span role="status" className="text-[12px] text-teal">{message}</span> : null}</div></form></div> : !error ? <div className="mt-8 h-52 animate-pulse border border-rule bg-paper-raised" /> : null}</div></DashboardShell>;
}
