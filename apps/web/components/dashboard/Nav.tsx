// The merchant dashboard's sections (approved gateway v2 design). Built screens are links; the rest say "Soon" and are
// not links. Between screens that send the same CSP a link is next/link (a client navigation, the shell prefetched,
// NFR-13); every other link is a plain <a>, a full load under its own headers (security review 005 F-N4, lib/soft-nav.ts).
// At phone width the list folds into a <details> menu (no JS); from md up it is the sidebar.
import Link from "next/link";
import { FoldedMenu } from "@/components/dashboard/FoldedMenu";
import { softNav } from "@/lib/soft-nav";

const SECTIONS = [
  {
    title: null,
    items: [
      { key: "home", label: "Home", href: "/merchant" },
      { key: "payments", label: "Payments", href: "/merchant/payments" },
      { key: "links", label: "Links", href: "/merchant/links" },
      { key: "pages", label: "Pages", href: "/merchant/pages" },
      { key: "invoices", label: "Invoices", href: "/merchant#invoices" },
      { key: "vouchers", label: "Vouchers", href: "/merchant/vouchers" },
    ],
  },
  {
    title: "Money",
    items: [
      { key: "reports", label: "Reports", href: "/merchant/reports" },
      { key: "settlements", label: "Settlements", href: "/merchant/settlements" },
      { key: "capital", label: "Capital", href: "/merchant/capital" },
    ],
  },
  {
    title: "Developers",
    items: [
      { key: "keys", label: "API keys", href: "/merchant/developers" },
      { key: "webhooks", label: "Webhooks" },
      { key: "docs", label: "Docs", href: "/docs" },
    ],
  },
] as const;

export type NavKey = (typeof SECTIONS)[number]["items"][number]["key"];

const row = "flex min-h-10 items-center justify-between gap-2 rounded-[10px] px-2.5 text-sm";

const hrefOf = (key: NavKey) => SECTIONS.flatMap((section): readonly { key: NavKey; href?: string }[] => section.items).find((item) => item.key === key)?.href ?? "";

function List({ active }: { active: NavKey }) {
  const here = hrefOf(active);
  return (
    <div className="grid gap-0.5">
      {SECTIONS.map((section) => (
        <ul key={section.title ?? "main"} className="grid gap-0.5" aria-label={section.title ?? undefined}>
          {section.title && (
            <li aria-hidden="true" className="eyebrow mt-4 mb-1 px-2.5 text-ink-muted">
              {section.title}
            </li>
          )}
          {section.items.map((item) => (
            <li key={item.key}>
              {"href" in item ? (
                softNav(here, item.href) ? (
                  <Link
                    href={item.href}
                    aria-current={item.key === active ? "page" : undefined}
                    className={`${row} ${item.key === active ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-sunk"}`}
                  >
                    {item.label}
                  </Link>
                ) : (
                  // a full load: this screen or the target sends another CSP (F-N4)
                  <a
                    href={item.href}
                    aria-current={item.key === active ? "page" : undefined}
                    className={`${row} ${item.key === active ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-sunk"}`}
                  >
                    {item.label}
                  </a>
                )
              ) : (
                <span className={`${row} text-ink-muted`}>
                  {item.label}
                  <span className="eyebrow">Soon</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

export function Nav({ active }: { active: NavKey }) {
  const current = SECTIONS.flatMap((section): readonly { key: NavKey; label: string }[] => section.items).find((item) => item.key === active)?.label;
  return (
    <nav aria-label="Dashboard" className="w-full">
      <FoldedMenu className="group rounded-md border border-hairline bg-surface md:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>
            Menu <span className="font-normal text-ink-muted">· {current}</span>
          </span>
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
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
