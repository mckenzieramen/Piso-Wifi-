/**
 * Shared PISO WIFI financial business rules.
 * Both Admin and Client portals use this function so the calculation model
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
  let clientTotal = client;

  if (settings.electricityRule === "ADD_TO_CLIENT") clientTotal = client + electricity;
  if (settings.electricityRule === "SUBTRACT_FROM_CLIENT") clientTotal = Math.max(0, client - electricity);
  if (settings.electricityRule === "SEPARATE_CHARGE") clientTotal = client;

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
    clientTotal: due,
    paid,
    balance,
    status
  };
}
