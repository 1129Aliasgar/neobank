import type { Metadata } from "next";
import { Geist_Mono, Noto_Sans, EB_Garamond } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

const notoSans = Noto_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "NeoBank — Business accounts, properly opened",
    template: "%s · NeoBank",
  },
  description:
    "Open a NeoBank business account: register your company, complete its profile and pass KYB verification.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full",
        "antialiased",
        geistMono.variable,
        "font-sans",
        notoSans.variable,
        ebGaramond.variable,
      )}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
