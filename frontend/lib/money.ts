export function parseDollarsToMinor(input: string): string {
  if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error("Enter a valid amount");
  const [whole, fraction = ""] = input.split(".");
  const value =
    BigInt(whole) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
  if (value <= BigInt(0)) throw new Error("Enter an amount greater than zero");
  return value.toString();
}

export function formatMinor(minor: string, currency = "USD"): string {
  const value = BigInt(minor);
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const dollars = absolute / BigInt(100);
  const cents = absolute % BigInt(100);
  return `${negative ? "−" : ""}${new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(dollars))}.${cents.toString().padStart(2, "0")}`;
}
