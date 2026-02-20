import { db } from "./firebase.js";
import { TENANT_ID } from "./auth.js";
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

export function colRef(name){
  return collection(db, "tenants", TENANT_ID, name);
}

export async function getById(colName, id){
  const ref = doc(db, "tenants", TENANT_ID, colName, id);
  const snap = await getDoc(ref);
  return snap.exists() ? ({ id: snap.id, ...snap.data() }) : null;
}

export async function list(colName, opts={}){
  const {
    filters = [], // [{field, op, value}]
    order = { field: "updatedAt", dir: "desc" },
    max = 200
  } = opts;

  let qref = query(colRef(colName));
  for (const f of filters){
    qref = query(qref, where(f.field, f.op, f.value));
  }
  if (order?.field) qref = query(qref, orderBy(order.field, order.dir || "desc"));
  qref = query(qref, limit(max));

  const snaps = await getDocs(qref);
  return snaps.docs.map(d=>({ id:d.id, ...d.data() }));
}

export async function create(colName, data, user){
  const payload = {
    ...data,
    tenantId: TENANT_ID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user?.uid || null,
    updatedBy: user?.uid || null
  };
  const ref = await addDoc(colRef(colName), payload);
  return ref.id;
}

export async function update(colName, id, data, user){
  const ref = doc(db, "tenants", TENANT_ID, colName, id);
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: user?.uid || null
  }, { merge:true });
}

export async function remove(colName, id){
  const ref = doc(db, "tenants", TENANT_ID, colName, id);
  await deleteDoc(ref);
}
