/**
 * Shared PISO WIFI financial business rules.
 * Admin and Customer portals use this function so calculations stay consistent.
 * Baseline: gross ₱10,000 => Admin 70% ₱7,000; Customer 30% ₱3,000;
 * internet fee is reported separately; fixed electricity adds ₱100 to customer earnings.
 */
export function calculateFinancialRecord(record = {}, settings = {}, payments = []) {
  const gross = Math.max(0, Number(record.grossSales || 0));
  const internet = Math.max(0, Number(settings.internetCost ?? 1000));
  const net = Math.max(0, gross - internet);

  const ownerPercent = Number(settings.ownerPercent ?? 70);
  const clientPercent = Number(settings.clientPercent ?? 30);
  // Shares are calculated from GROSS sales. Internet is a separate fee.
  const owner = gross * ownerPercent / 100;
  const client = gross * clientPercent / 100;

  const electricity = Math.max(0, Number(settings.electricity ?? 100));
  const electricityRule = String(settings.electricityRule || "ADD_TO_CLIENT");
  const electricityAdjustment = electricityRule === "SUBTRACT_FROM_CLIENT"
    ? -electricity
    : electricityRule === "SEPARATE_CHARGE"
      ? 0
      : electricity;

  const miscellaneous = Math.max(0, Number(record.miscellaneousFee || 0));
  const clientTotal = Math.max(0, client + electricityAdjustment - miscellaneous);

  const paid = payments
    .filter(p => p.unitId === record.unitId && p.month === record.month)
    .reduce((sum, p) => sum + Math.max(0, Number(p.amount || 0)), 0);

  const due = Math.max(0, clientTotal);
  const balance = Math.max(0, due - paid);
  const status = due === 0
    ? (paid > 0 ? "Paid" : "Unpaid")
    : paid >= due
      ? "Paid"
      : paid > 0
        ? "Partial"
        : "Unpaid";

  return { gross, internet, net, owner, client, elec: electricity, miscellaneous, clientTotal: due, paid, balance, status };
}
