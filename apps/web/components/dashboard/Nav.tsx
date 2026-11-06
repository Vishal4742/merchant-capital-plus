// The merchant dashboard's sections (approved gateway v2 design). Built screens are links; the rest say "Soon" and are
// not links. Plain <a>, so every screen is a full load under its own headers (security review 005 F-N4).
// At phone width the list folds into a <details> menu (no JS); from md up it is the sidebar.
const SECTIONS = [
  {
    title: null,
    items: [
      { key: "home", label: "Home", href: "/merchant" },
      { key: "payments", label: "Payments", href: "/merchant/payments" },
      { key: "links", label: "Links", href: "/merchant/links" },
      { key: "pages", label: "Pages", href: "/merchant/pages" },
      { key: "invoices", label: "Invoices", href: "/merchant#invoices" },
      { key: "vouchers", label: "Vouchers" },
    ],
  },
  {
    title: "Money",
    items: [
      { key: "reports", label: "Reports" },
      { key: "settlements", label: "Settlements" },
      { key: "capital", label: "Capital" },
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

function List({ active }: { active: NavKey }) {
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
                <a
                  href={item.href}
                  aria-current={item.key === active ? "page" : undefined}
                  className={`${row} ${item.key === active ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-sunk"}`}
                >
                  {item.label}
                </a>
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
      <details className="group rounded-md border border-hairline bg-surface md:hidden">
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
      </details>
      <div className="hidden md:block">
        <List active={active} />
      </div>
    </nav>
  );
}
