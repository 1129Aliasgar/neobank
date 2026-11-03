import { cn } from "@/lib/utils";

/**
 * The engraved seal used as the only ornament in the product.
 *
 * It is deliberately drawn rather than imported: a bank's seal is a mark of
 * record, and the concentric rings read as a stamp on paper at small sizes.
 */
export function SealMark({
  className,
  tone = "teal",
}: {
  className?: string;
  tone?: "teal" | "paper" | "ink";
}) {
  const stroke =
    tone === "paper" ? "var(--paper)" : tone === "ink" ? "var(--ink)" : "var(--teal)";

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={cn("h-10 w-10", className)}
      fill="none"
    >
      <circle cx="50" cy="50" r="47" stroke={stroke} strokeWidth="1.2" />
      <circle cx="50" cy="50" r="38" stroke={stroke} strokeWidth="0.7" />
      <circle
        cx="50"
        cy="50"
        r="29"
        stroke={stroke}
        strokeWidth="0.7"
        strokeDasharray="1 4"
      />
      {/* Cardinal ticks, like a surveyor's compass rose. */}
      <path d="M50 0v7M50 93v7M0 50h7M93 50h7" stroke={stroke} strokeWidth="1" />
      <path
        d="M50 32l13 18-13 18-13-18 13-18z"
        stroke={stroke}
        strokeWidth="0.9"
      />
      <path d="M44 58V42l12 16V42" stroke={stroke} strokeWidth="1.4" />
    </svg>
  );
}

/**
 * The wordmark sets the name in the display serif. The small rotated square is
 * the same teal used for seals and focus states.
 */
export function Wordmark({
  tone = "ink",
  className,
  withTagline = false,
}: {
  tone?: "ink" | "paper";
  className?: string;
  withTagline?: boolean;
}) {
  const primary = tone === "paper" ? "text-paper" : "text-ink";
  const secondary = tone === "paper" ? "text-paper/55" : "text-ink-muted";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className="mt-px size-1.5 rotate-45 bg-teal"
      />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-heading text-[22px] font-normal tracking-[-0.01em]",
            primary,
          )}
        >
          NeoBank
        </span>
        {withTagline ? (
          <span
            className={cn(
              "mt-1 font-mono text-[9px] uppercase tracking-[0.28em]",
              secondary,
            )}
          >
            Business accounts
          </span>
        ) : null}
      </span>
    </span>
  );
}
