import { NotFoundSheet } from "@/components/NotFoundSheet";

export default function ReceiptNotFound() {
  return <NotFoundSheet title="No receipt here yet">A receipt appears once a payment is confirmed. If you just paid, open your checkout link again to see where it stands.</NotFoundSheet>;
}
