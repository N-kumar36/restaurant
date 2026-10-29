/**
 * Authoritative financial calculations using integer cents/paise (scaled by 100)
 * to eliminate IEEE-754 floating point inaccuracies.
 */

export function roundToTwoDecimals(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function toCents(amount: number | string): number {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return Math.round(num * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export interface CalculatedOrderTotals {
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  totalAmount: number;
}

export function calculateOrderTotals(
  itemsSubtotalCents: number,
  taxRatePercent: number,
  serviceChargePercent: number = 0
): CalculatedOrderTotals {
  const subtotalCents = Math.max(0, Math.round(itemsSubtotalCents));
  
  // Tax calculation: (subtotal * taxRate) / 100
  const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);

  // Service charge: (subtotal * serviceRate) / 100
  const serviceChargeCents = Math.round((subtotalCents * serviceChargePercent) / 100);

  const totalCents = subtotalCents + taxCents + serviceChargeCents;

  return {
    subtotal: fromCents(subtotalCents),
    taxAmount: fromCents(taxCents),
    serviceCharge: fromCents(serviceChargeCents),
    totalAmount: fromCents(totalCents),
  };
}

