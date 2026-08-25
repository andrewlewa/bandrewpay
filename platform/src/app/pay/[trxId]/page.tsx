import { notFound } from "next/navigation";
import { getTransaction } from "@/lib/payments/transactions-repo";
import { activeViewerCount } from "@/lib/monitor/coordinator";
import PaymentClient from "./PaymentClient.tsx";

export const dynamic = "force-dynamic";

const TRX_ID_RE = /^TRX-[0-9a-fA-F]{16}$/;

export default async function PayPage({ params }: { params: Promise<{ trxId: string }> }) {
  const { trxId } = await params;
  if (!TRX_ID_RE.test(trxId)) notFound();

  const tx = getTransaction(trxId);
  if (!tx) notFound();

  // Field publik sengaja dibatasi: tanpa email/callback internals.
  return (
    <PaymentClient
      initial={{
        transactionId: tx.id,
        status: tx.status,
        amount: tx.amount,
        payableAmount: tx.payable_amount || tx.amount,
        expiresAtMs: tx.expires_at,
        serverNowMs: Date.now(),
        redirectUrl: tx.status === "PAID" ? tx.redirect_url : null,
        customerName: tx.customer_name,
        viewers: activeViewerCount(tx.id),
      }}
    />
  );
}
