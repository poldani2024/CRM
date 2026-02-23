import { create, list } from "./data_access.js";

export async function createAutoSiteFromAccount(account, user){
  const siteName = String(account?.name || "").trim() || `Predio ${String(account?.id || "").slice(0, 6)}`;
  const payload = {
    accountId: account.id,
    name: siteName,
    address: String(account?.address || "").trim(),
    city: String(account?.city || "").trim(),
    notes: String(account?.notes || "").trim() || "Generado automáticamente desde reproceso de cuentas.",
    requiresSheet: false,
    requiresCertificate: false,
    status: account?.status === "inactive" ? "inactive" : "active"
  };
  const id = await create("sites", payload, user);
  return { id, ...payload };
}

export async function ensureSiteForAccount(account, user){
  if (!account?.id) return null;
  const existing = await list("sites", {
    filters: [{ field:"accountId", op:"==", value: account.id }],
    order: null,
    max: 1
  });
  if (existing.length) return existing[0];
  return createAutoSiteFromAccount(account, user);
}
