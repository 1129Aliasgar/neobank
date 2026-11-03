"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { SealMark } from "@/components/brand/wordmark";
import { Alert, StatusPill } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import type { CurrentBusiness } from "@/lib/business";
import {
  verificationApi,
  type StartVerificationResult,
} from "@/lib/verification";

const POINTS = [
  "Your company details are pre-filled from the profile you just saved.",
  "Didit checks the company against the registry and may ask for a document.",
  "Scan the code with your phone — a business check is usually finished on a phone.",
  "Documents stay with Didit. NeoBank never receives or stores them.",
];

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Could not open a verification session.";
}

export function VerificationStart({ current }: { current: CurrentBusiness }) {
  const router = useRouter();
  const [session, setSession] = useState<StartVerificationResult | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const attempted = useRef(false);

  const isSimulator = session?.provider === "SIMULATOR";
  const isOpen = current.onboarding.nextStep === "OPEN_VERIFICATION";
  const isReturning = current.onboarding.nextStep === "RETURN_TO_PROVIDER";
  const previous = current.onboarding.verification;
  const isRetry = previous?.status === "REJECTED";

  async function begin() {
    setStarting(true);
    setError(null);

    try {
      const result = await verificationApi.start();
      setSession(result);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setStarting(false);
    }
  }

  /*
   * The session URL is a credential and is never persisted, so an unfinished
   * attempt has to ask the provider again to be reopened. Didit opens a new
   * session per call, so this runs once per page load (guarded by `attempted`)
   * and never in a loop. The previous session stays valid and its webhook still
   * resolves through `vendor_data`, so completing an older tab is not lost.
   */
  useEffect(() => {
    if (!isOpen && !isReturning) {
      return;
    }

    if (attempted.current) {
      return;
    }

    attempted.current = true;
    void begin();
  }, [isOpen, isReturning]);

  async function copyLink() {
    if (!session) {
      return;
    }

    try {
      await navigator.clipboard.writeText(session.verificationUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <StatusPill
          label={
            session
              ? "Session ready"
              : isOpen
                ? "Open session"
                : isRetry
                  ? "New attempt"
                  : "Not started"
          }
          tone={session || isRetry ? "progress" : "neutral"}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted/70">
          {session
            ? `Attempt ${session.attemptNumber}`
            : isRetry
              ? `Attempt ${(previous?.attemptNumber ?? 0) + 1}`
              : "No attempt yet"}
        </span>
      </div>

      {error ? (
        <Alert tone="error" label="Provider unavailable" className="mb-7">
          {error}
        </Alert>
      ) : null}

      {isRetry && !session ? (
        <Alert tone="warn" label="Retrying after a decline" className="mb-7">
          {previous?.rejectionReason
            ? `The last attempt was declined: ${previous.rejectionReason}`
            : "The last attempt was declined."}{" "}
          Starting again opens a fresh session; the previous attempt stays on
          the record.
        </Alert>
      ) : null}

      {session && !session.desktopAllowed ? (
        <Alert tone="warn" label="Finish this on your phone" className="mb-7">
          Didit does not allow this business check to run in a desktop browser,
          so the check will not advance here. Scan the QR code with your phone
          camera — this page updates by itself when the phone finishes.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_20rem] lg:gap-14">
        <div>
          <ol className="flex flex-col gap-5">
            {POINTS.map((point, index) => (
              <li key={point} className="flex gap-4">
                <span className="mt-[3px] font-mono text-[10px] tabular-nums tracking-[0.12em] text-teal">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="max-w-md text-[13.5px] leading-relaxed text-ink-muted">
                  {point}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-8 border-l-2 border-gold/50 py-1 pl-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#7a5a17]">
              Sandbox
            </p>
            <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-ink-muted">
              This build runs against Didit&apos;s sandbox. Decisions are not real
              registry checks and are labelled as sandbox everywhere they appear.
            </p>
          </div>

          {session ? (
            <div className="mt-8 flex flex-col gap-4 sm:max-w-sm">
              <SubmitButton
                type="button"
                variant="outline"
                onClick={() => router.push("/onboarding/status")}
              >
                I&apos;ve finished — check the decision
              </SubmitButton>
            </div>
          ) : (
            <div className="mt-8 sm:max-w-xs">
              <SubmitButton
                type="button"
                loading={starting}
                onClick={() => void begin()}
              >
                {isOpen
                  ? "Reopen verification"
                  : isRetry
                    ? "Start a new attempt"
                    : "Begin verification"}
              </SubmitButton>
            </div>
          )}
        </div>

        <aside className="paper-emboss border border-rule p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Secure session</p>
              <p className="mt-2 font-heading text-xl leading-tight text-ink">
                {session ? "Your check is ready" : "Awaiting a session"}
              </p>
            </div>
            <SealMark className="h-9 w-9 shrink-0 opacity-70" />
          </div>

          {session ? (
            isSimulator ? (
              <div className="border border-dashed border-rule px-4 py-6 text-center">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#7a5a17]">
                  Simulator attached
                </p>
                <p className="mx-auto mt-3 max-w-[14rem] text-[12.5px] leading-relaxed text-ink-muted">
                  This session is decided by the local sandbox console, not by
                  Didit. Choose an outcome there to continue.
                </p>
                <a
                  href={session.verificationUrl}
                  className="mt-5 inline-flex h-10 w-full items-center justify-center bg-ink px-4 font-mono text-[10px] uppercase tracking-[0.2em] text-paper-raised transition-colors hover:bg-teal"
                >
                  Open sandbox console
                </a>
              </div>
            ) : (
              <div>
                <div className="flex justify-center bg-white p-4">
                  <QRCodeSVG
                    value={session.verificationUrl}
                    size={164}
                    bgColor="#ffffff"
                    fgColor="#14191a"
                    level="M"
                    marginSize={0}
                    title="Didit verification QR code"
                  />
                </div>
                <p className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted/70">
                  Scan with a phone camera
                </p>

                {session.desktopAllowed ? (
                  <a
                    href={session.verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex h-10 w-full items-center justify-center border border-ink/25 px-4 font-mono text-[10px] uppercase tracking-[0.2em] text-ink transition-colors hover:border-ink hover:bg-ink/[0.04]"
                  >
                    Open in this tab
                  </a>
                ) : (
                  <p className="mt-5 border border-dashed border-rule px-4 py-3 text-center text-[11.5px] leading-relaxed text-ink-muted">
                    Phone required. Opening this link on a desktop will not let
                    you continue.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="mt-3 w-full border-b border-rule pb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:border-teal hover:text-teal"
                >
                  {copied ? "Link copied" : "Copy secure link"}
                </button>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center border border-dashed border-rule px-4 py-10 text-center">
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                {starting
                  ? "Registering the attempt…"
                  : "The session link appears here once the provider accepts the request."}
              </p>
            </div>
          )}

          <div className="mt-5 border-t border-rule pt-4 font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em] text-ink-muted/60">
            {session ? (
              <>
                <p>Provider · {session.provider}</p>
                <p>Environment · {session.environment}</p>
              </>
            ) : (
              <p>Provider · Didit</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
