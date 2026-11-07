// Whiteflow navigation (FR-UX-2): the five destinations Overview, Invoices, Payments, Connections, Settings, then the
// existing gateway tools (links, pages, vouchers, reports, settlements, developers, docs) and legacy Capital, outside the
// five (its existing positions stay visible). Between screens that send the same CSP a link is next/link (a client
// navigation, the shell prefetched, NFR-13); every other link is a plain <a>, a full load under its own headers
// (security review 005 F-N4, lib/soft-nav.ts). At phone width the list folds into a menu; from md up it is the sidebar.
import Link from "next/link";
import { FoldedMenu } from "@/components/dashboard/FoldedMenu";
import { softNav } from "@/lib/soft-nav";

const SECTIONS = [
  {
    title: "Workspace",
    items: [
      { key: "home", label: "Overview", href: "/merchant", icon: "overview" },
      { key: "invoices", label: "Invoices", href: "/merchant/invoices", icon: "invoices" },
      { key: "payments", label: "Payments", href: "/merchant/payments", icon: "payments" },
      { key: "connections", label: "Connections", href: "/merchant/connections", icon: "connections" },
      { key: "ai", label: "AI connections", href: "/merchant/ai", icon: "connections" },
      { key: "settings", label: "Settings", href: "/merchant/settings", icon: "settings" },
    ],
  },
  {
    title: "Collections",
    items: [
      { key: "links", label: "Payment links", href: "/merchant/links" },
      { key: "pages", label: "Hosted pages", href: "/merchant/pages" },
      { key: "vouchers", label: "Vouchers", href: "/merchant/vouchers" },
    ],
  },
  {
    title: "Accounting",
    items: [
      { key: "reports", label: "Reports", href: "/merchant/reports" },
      { key: "settlements", label: "Settlements", href: "/merchant/settlements" },
      { key: "capital", label: "Capital (legacy)", href: "/merchant/capital" },
    ],
  },
  {
    title: "Developers",
    items: [
      { key: "keys", label: "API keys", href: "/merchant/developers" },
      { key: "webhooks", label: "Webhooks", href: "/merchant/developers#webhooks" }, // a section of Developers (batch 045)
      { key: "docs", label: "Docs", href: "/docs" },
    ],
  },
] as const;

export type NavKey = (typeof SECTIONS)[number]["items"][number]["key"];

function NavIcon({ name }: { name: string }) {
  switch (name) {
    case "overview":
      return (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      );
    case "invoices":
      return (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case "payments":
      return (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "connections":
      return (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    case "settings":
      return (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    default:
      return null;
  }
}

const row = "flex min-h-9 items-center justify-between gap-2.5 rounded-[8px] px-2.5 text-sm transition-colors";

const hrefOf = (key: NavKey) => SECTIONS.flatMap((section): readonly { key: NavKey; href: string }[] => section.items).find((item) => item.key === key)?.href ?? "";

function List({ active }: { active: NavKey }) {
  const here = hrefOf(active);
  return (
    <div className="grid gap-1">
      {SECTIONS.map((section) => (
        <ul key={section.title} className="grid gap-0.5" aria-label={section.title}>
          <li aria-hidden="true" className="eyebrow mt-3 mb-1 px-2.5 text-ink-muted">
            {section.title}
          </li>
          {section.items.map((item) => {
            const isCurrent = item.key === active;
            const className = `${row} ${isCurrent ? "bg-accent-soft font-medium text-accent dark:bg-accent/15" : "text-ink hover:bg-surface-sunk"}`;
            const label = (
              <span className="flex min-w-0 items-center gap-2">
                {"icon" in item && item.icon && <NavIcon name={item.icon} />}
                <span className="truncate">{item.label}</span>
              </span>
            );
            return (
              <li key={item.key}>
                {softNav(here, item.href) ? (
                  <Link href={item.href} aria-current={isCurrent ? "page" : undefined} className={className}>
                    {label}
                  </Link>
                ) : (
                  // a full load: this screen or the target sends another CSP (F-N4)
                  <a href={item.href} aria-current={isCurrent ? "page" : undefined} className={className}>
                    {label}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}

export function Nav({ active }: { active: NavKey }) {
  const current = SECTIONS.flatMap((section): readonly { key: NavKey; label: string }[] => section.items).find((item) => item.key === active)?.label;
  return (
    <nav aria-label="Dashboard" className="w-full">
      <FoldedMenu className="group rounded-[10px] border border-hairline bg-surface md:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <span className="text-ink">Menu</span>
            <span className="font-normal text-ink-muted">· {current}</span>
          </span>
          <span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-hairline p-2">
          <List active={active} />
        </div>
      </FoldedMenu>
      <div className="hidden md:block">
        <List active={active} />
      </div>
    </nav>
  );
}
