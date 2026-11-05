import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "glass" | "quiet";

const base =
  "relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-pill text-base font-medium " +
  "transition-[background-color,box-shadow,transform] duration-300 ease-spring hover:-translate-y-px active:scale-[.97] active:duration-75 " +
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:translate-y-0 aria-disabled:shadow-none";

const variants: Record<Variant, string> = {
  // Each variant owns its size: a shared px-6 would beat the quiet variant's px-2 in Tailwind's order.
  primary: "h-12 px-6 bg-accent text-on-accent hover:bg-accent-hover hover:shadow-glow",
  glass: "h-12 px-6 border border-glass-edge bg-glass-fill text-glass-ink backdrop-blur-[20px]",
  quiet: "min-h-11 px-2 bg-transparent text-ink-muted underline underline-offset-4 hover:text-ink hover:translate-y-0",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** The same classes for a link that should look like a button (e.g. a Next <Link>). */
export function buttonClasses(variant: Variant = "primary", className = ""): string {
  return `${base} ${variants[variant]} ${className}`;
}

/** A pill button: primary for the one action a screen asks for, glass over a scene, quiet for secondary text actions. */
export function Button({ variant = "primary", className = "", type = "button", onClick, ...props }: ButtonProps) {
  const disabled = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  // aria-disabled keeps focus (unlike disabled), so the click has to be ignored here.
  return <button type={type} className={buttonClasses(variant, className)} onClick={disabled ? undefined : onClick} {...props} />;
}
