// Canon payment status → chip class + label (prototype paymentsStatusChip /
// paymentsStatusLabel). Chip classes resolve to the canon `.theme-admin`
// taxonomy: confirmed/paid → green, awaiting/pending/manual-review → warning,
// failed → danger, refunded/cancelled → muted, replacement → danger.
export const PAY_CHIP: Record<string, string> = {
  CONFIRMED: 'paid',
  PAID: 'paid',
  FREE: 'paid',
  AWAITING: 'awaiting',
  PENDING: 'pending',
  FAILED: 'failed',
  REFUNDED: 'expired',
  REFUND_REQUESTED: 'replacement',
  REPLACEMENT: 'replacement',
  MANUAL_REVIEW: 'pending',
  CANCELLED: 'expired',
};

export const PAY_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  PAID: 'Paid',
  FREE: 'Free',
  AWAITING: 'Awaiting',
  PENDING: 'Pending',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  REFUND_REQUESTED: 'Refund requested',
  REPLACEMENT: 'Replacement',
  MANUAL_REVIEW: 'Manual review',
  CANCELLED: 'Cancelled',
};
