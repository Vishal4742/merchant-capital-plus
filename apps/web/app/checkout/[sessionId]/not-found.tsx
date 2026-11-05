import { NotFoundSheet } from "@/components/NotFoundSheet";

export default function CheckoutNotFound() {
  return <NotFoundSheet title="This checkout link doesn't work">It may be mistyped or too old. Ask the shop for a new link. Nothing was charged from this page.</NotFoundSheet>;
}
