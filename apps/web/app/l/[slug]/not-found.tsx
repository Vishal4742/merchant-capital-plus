import { NotFoundSheet } from "@/components/NotFoundSheet";

export default function LinkNotFound() {
  return <NotFoundSheet title="This payment link doesn't work">It may be mistyped, or the shop may have removed it. Nothing was charged. Ask the shop for a new link.</NotFoundSheet>;
}
