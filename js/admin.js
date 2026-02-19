import { loadShell } from "./ui_shell.js";
import { requireRole, TENANT_ID } from "./auth.js";
import { db } from "./firebase.js";
import { $, toast, escapeHtml } from "./utils.js";

import {
  collection, doc, setDoc, updateDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

async function loadPendingRequests(){
  const qref = query(
    collection(db, "tenants", TENANT_ID, "user_requests"),
    where("status", "==", "pending")
  );
  const snap = await getDocs(qref);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function approveUser(uid, role){
  // 1) crear/actualizar perfil real
  const userRef = doc(db, "tenants", TENANT_ID, "users", uid);
  await setDoc(userRef, {
    tenantId: TENANT_ID,
    uid,
    role,
    active: true,
    updatedAt: serverTimestamp()
  }, { merge:true });

  // 2) marcar request como aprobado
  const reqRef = doc(db, "tenants", TENANT_ID, "user_requests", uid);
  await updateDoc(reqRef, {
    status: "approved",
    updatedAt: serverTimestamp()
  });

  toast("Usuario aprobado");
  window.location.reload();
}

async function saveSettings(){
  const data = {
    companyName: $("s_companyName").value.trim(),
    companySub: $("s_companySub").value.trim(),
    logoPath: $("s_logoPath").value.trim(),
    updatedAt: serverTimestamp()
  };

  try{
    const ref = doc(db, "tenants", TENANT_ID, "settings", "main");
    await setDoc(ref, data, { merge:true });
    toast("Settings guardado");
    window.location.reload();
  } catch(e){
    console.error(e);
    toast(e?.message || "Error guardando settings");
  }
}

function wireApproveButtons(){
  document.querySelectorAll("[data-approve]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const uid = btn.getAttribute("data-approve");
      const role = btn.getAttribute("data-role");
      btn.disabled = true;
      try{
        await approveUser(uid, role);
      } finally{
        btn.disabled = false;
      }
    });
  });
}

async function init(){
  await requireRole(["admin"]);

  await loadShell({
    activeNav:"admin",
    primaryText:"Guardar config",
    onPrimary: saveSettings
  });

  const pending = await loadPendingRequests();

  const c = document.getElementById("pageContent");
  c.innerHTML = `
    <div class="section-title">Administración</div>

    <div class="panel" style="padding:14px;">
      <div class="grid2">
        <div class="field">
          <label>Nombre de empresa</label>
          <input id="s_companyName" placeholder="Ej: Fumigaciones Rosario" />
        </div>
        <div class="field">
          <label>Subtítulo</label>
          <input id="s_companySub" placeholder="Ej: Gestión de clientes" />
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>Logo path (ej: /CRM/images/logo.png)</label>
          <input id="s_logoPath" placeholder="/CRM/images/logo.png" />
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-primary" id="btnSaveSettings">Guardar</button>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      <div class="row" style="justify-content:space-between; flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;">Solicitudes pendientes</div>
          <div class="muted small">Usuarios que ingresaron pero aún no tienen rol.</div>
        </div>
        <div class="badge">${pending.length}</div>
      </div>

      <div class="spacer"></div>

      ${pending.length ? pending.map(u=>`
        <div class="card" style="margin-bottom:10px;">
          <div class="card-title">${escapeHtml(u.displayName || "—")}</div>
          <div class="card-sub muted small">${escapeHtml(u.email || "")}</div>
          <div class="card-sub muted small">UID: ${escapeHtml(u.uid || u.id || "")}</div>

          <div class="row" style="margin-top:10px; justify-content:flex-end; flex-wrap:wrap;">
            <button class="btn" data-approve="${escapeHtml(u.uid || u.id)}" data-role="viewer">Aprobar viewer</button>
            <button class="btn btn-primary" data-approve="${escapeHtml(u.uid || u.id)}" data-role="operator">Aprobar operator</button>
          </div>
        </div>
      `).join("") : `<div class="muted">No hay solicitudes.</div>`}
    </div>
  `;

  $("btnSaveSettings").addEventListener("click", saveSettings);

  wireApproveButtons();
}

init();
