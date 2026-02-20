import { db } from "./firebase.js";
import { TENANT_ID } from "./auth.js";
import {
  doc,
  runTransaction,
  serverTimestamp,
  collection,
  addDoc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

function padSequence(n){
  return String(n).padStart(5, "0");
}

export async function getNextWorkOrderNumber(year){
  const yearValue = Number(year);
  const seqRef = doc(db, "tenants", TENANT_ID, "settings", `work_order_seq_${yearValue}`);

  return runTransaction(db, async (tx)=>{
    const snap = await tx.get(seqRef);
    const current = snap.exists() ? Number(snap.data().lastSeq || 0) : 0;
    const next = current + 1;
    tx.set(seqRef, {
      year: yearValue,
      lastSeq: next,
      updatedAt: serverTimestamp()
    }, { merge:true });
    return `${padSequence(next)}/${yearValue}`;
  });
}

export async function createWorkOrder({
  visit,
  visitId,
  account,
  site,
  employee,
  observations = "",
  status = "Confirmada",
  generatedBy
}){
  const visitDateSource = visit?.plannedDate || visit?.scheduledFor || visit?.date || "";
  const visitDate = typeof visitDateSource === "string"
    ? visitDateSource
    : (visitDateSource?.toDate ? visitDateSource.toDate().toISOString().slice(0, 10) : "");
  const year = Number(String(visitDate || "").slice(0, 4)) || new Date().getFullYear();
  const orderNumber = await getNextWorkOrderNumber(year);

  const payload = {
    orderNumber,
    year: Number(year),
    visitId: visitId || "",
    generatedAt: serverTimestamp(),
    visitDate,
    employeeId: employee?.id || "",
    employeeName: `${employee?.lastName || ""}${employee?.lastName && employee?.firstName ? ", " : ""}${employee?.firstName || ""}`.trim(),
    accountId: account?.id || visit?.accountId || "",
    accountName: account?.name || "",
    siteId: site?.id || visit?.siteId || "",
    siteName: site?.name || "",
    status,
    observations: String(observations || "").trim(),
    active: true,
    tenantId: TENANT_ID,
    createdBy: generatedBy?.uid || null,
    updatedBy: generatedBy?.uid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const ref = await addDoc(collection(db, "tenants", TENANT_ID, "work_orders"), payload);

  if (visitId){
    const visitRef = doc(db, "tenants", TENANT_ID, "visits", visitId);
    const visitSnap = await getDoc(visitRef);
    if (visitSnap.exists()){
      await updateDoc(visitRef, {
        assignedEmployeeId: payload.employeeId,
        assignedEmployeeName: payload.employeeName,
        workOrderId: ref.id,
        workOrderNumber: payload.orderNumber,
        updatedAt: serverTimestamp(),
        updatedBy: generatedBy?.uid || null
      });
    }
  }

  return { id: ref.id, ...payload };
}
