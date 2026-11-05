import { NotFoundSheet } from "@/components/NotFoundSheet";

export default function CheckoutNotFound() {
  return <NotFoundSheet title="This checkout link doesn't work">It may be mistyped or too old. If you already paid, don&apos;t pay again: ask the shop to check its payments. Otherwise ask the shop for a new link.</NotFoundSheet>;
}
