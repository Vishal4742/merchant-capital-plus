import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google";
import { TestModeBadge } from "@/components/TestModeBadge";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Self-hosted at build time by next/font: no request to Google at runtime (NFR-8).
const instrumentSans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: "italic" }); // italic only: used for one emphasis phrase
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WhiteFlow — Business Payments Workspace",
  description: "One invoice. Clear settlement. Request business payments, accept supported crypto, and settle exact USDT to Whitechain.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      {/* the saved day/night choice, before first paint (batch 060); it sets data-theme, hence suppressHydrationWarning */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <TestModeBadge />
        {children}
      </body>
    </html>
  );
}
