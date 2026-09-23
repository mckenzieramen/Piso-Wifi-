/**
 * Shared PISO WIFI financial business rules.
 * Both Admin and Customer accounts use this function so the calculation model
 * lives in one place.
 */
export function calculateFinancialRecord(record = {}, settings = {}, payments = []) {
  const gross = Math.max(0, Number(record.grossSales || 0));
  const internet = Math.max(0, Number(settings.internetCost || 0));
  const net = Math.max(0, gross - internet);

  const ownerPercent = Number(settings.ownerPercent ?? 70);
  const clientPercent = Number(settings.clientPercent ?? 30);
  const owner = net * ownerPercent / 100;
  const client = net * clientPercent / 100;

  const electricity = Math.max(0, Number(settings.electricity || 0));
  const electricityRule = String(settings.electricityRule || "ADD_TO_CLIENT");
  // Electricity is a customer earning when the business rule is ADD_TO_CLIENT.
  // It is never deducted from the customer's share under this rule.
  const electricityAdjustment = electricityRule === "SUBTRACT_FROM_CLIENT"
    ? -electricity
    : electricityRule === "SEPARATE_CHARGE"
      ? 0
      : electricity;
  // Miscellaneous fees are custom per monthly record and are deducted from
  // the customer's total earnings after the electricity adjustment.
  const miscellaneous = Math.max(0, Number(record.miscellaneousFee || 0));
  const clientTotal = Math.max(0, client + electricityAdjustment - miscellaneous);

  const paid = payments
    .filter(p => p.unitId === record.unitId && p.month === record.month)
    .reduce((sum, p) => sum + Math.max(0, Number(p.amount || 0)), 0);

  const due = Math.max(0, clientTotal);
  const balance = Math.max(0, due - paid);
  const status =
    due === 0
      ? (paid > 0 ? "Paid" : "Unpaid")
      : paid >= due
        ? "Paid"
        : paid > 0
          ? "Partial"
          : "Unpaid";

  return {
    gross,
    internet,
    net,
    owner,
    client,
    elec: electricity,
    miscellaneous,
    clientTotal: due,
    paid,
    balance,
    status
  };
}
