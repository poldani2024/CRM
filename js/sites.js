import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create, update } from "./data_access.js";
import { escapeHtml, formatDateTimeAR, $, toast } from "./utils.js";

function getParam(name){
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

let SITES = [];
let ACCOUNTS = [];
let accountIdPrefill = null;
let editingSiteId = null;

function openCreateModal(){
  editingSiteId = null;
  $("modalTitle").textContent = "Nuevo predio";
  $("btnSave").textContent = "Guardar";

  $("s_name").value = "";
  $("s_address").value = "";
  $("s_city").value = "";
  $("s_notes").value = "";
  $("s_requiresSheet").checked = false;
  $("s_requiresCertificate").checked = false;

  if (accountIdPrefill) $("s_accountId").value = accountIdPrefill;
  $("modalBackdrop").style.display = "flex";
}

function openEditModal(siteId){
  const site = SITES.find(s=>s.id===siteId);
  if (!site) return toast("No se encontró el predio");

  editingSiteId = site.id;
  $("modalTitle").textContent = "Editar predio";
  $("btnSave").textContent = "Guardar cambios";

  $("s_name").value = site.name || "";
  $("s_accountId").value = site.accountId || "";
  $("s_address").value = site.address || "";
  $("s_city").value = site.city || "";
  $("s_notes").value = site.notes || "";
  $("s_requiresSheet").checked = !!site.requiresSheet;
  $("s_requiresCertificate").checked = !!site.requiresCertificate;

  $("modalBackdrop").style.display = "flex";
}

function closeModal(){
  $("modalBackdrop").style.display = "none";
}

function render(){
  const c = document.getElementById("pageContent");
  c.innerHTML = `
    <div class="section-title">Predios</div>

    <div class="panel" style="padding:14px;">
      <div class="row" style="justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div class="muted">Total: ${SITES.length}</div>
        <button class="btn btn-primary" id="btnNew" ${ACCOUNTS.length ? "" : "disabled"}>+ Nuevo predio</button>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      ${SITES.length ? SITES.map(site=>{
        const acc = ACCOUNTS.find(a=>a.id===site.accountId);
        const upd = site.updatedAt?.toDate ? site.updatedAt.toDate() : null;
        const inactive = site.status === "inactive";
        return `
          <div class="card" style="margin-bottom:10px; ${inactive ? "opacity:.72; border-color:#d48b8b; background:#fff7f7;" : ""}">
            <div class="row" style="justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap;">
              <div>
                <div class="card-title">${escapeHtml(site.name || "—")}</div>
                <div class="card-sub muted small">
                  ${acc?.id ? `<a href="../pages/account_detail.html?id=${encodeURIComponent(acc.id)}">${escapeHtml(acc.name || "Cuenta")}</a>` : "Sin cuenta"}
                  ${site.city ? `· ${escapeHtml(site.city)}` : ""}
                  ${site.address ? `· ${escapeHtml(site.address)}` : ""}
                  ${inactive ? `· Inactivo` : ""}
                  ${site.requiresSheet ? "· Planilla" : ""}
                  ${site.requiresCertificate ? "· Certificado" : ""}
                  ${upd ? `· Actualizado: ${escapeHtml(formatDateTimeAR(upd))}` : ""}
                </div>
              </div>

              <div class="row" style="gap:8px;">
                <button class="btn" data-edit-site="${escapeHtml(site.id)}">Editar</button>
                <button class="btn" data-delete-site="${escapeHtml(site.id)}">Dar de baja</button>
              </div>
            </div>

            ${site.notes ? `<div class="small" style="margin-top:8px;">${escapeHtml(site.notes)}</div>` : ""}
          </div>
        `;
      }).join("") : `<div class="muted">Sin predios.</div>`}
    </div>

    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title" id="modalTitle">Nuevo predio</div>
          <button class="btn btn-ghost" id="btnCloseModal">✕</button>
        </div>

        <div class="spacer"></div>

        <div class="grid2">
          <div class="field">
            <label>Nombre</label>
            <input id="s_name" placeholder="Ej: Planta Norte" />
          </div>

          <div class="field">
            <label>Cuenta</label>
            <select id="s_accountId"></select>
          </div>

          <div class="field">
            <label>Dirección</label>
            <input id="s_address" placeholder="Ej: Av. Siempre Viva 123" />
          </div>

          <div class="field">
            <label>Ciudad</label>
            <input id="s_city" placeholder="Ej: Rosario" />
          </div>


          <div class="field" style="grid-column:1/-1;">
            <label>Documentación requerida</label>
            <div class="row" style="gap:16px; flex-wrap:wrap;">
              <label class="row" style="gap:8px; align-items:center;">
                <input id="s_requiresSheet" type="checkbox" />
                <span>Planilla</span>
              </label>
              <label class="row" style="gap:8px; align-items:center;">
                <input id="s_requiresCertificate" type="checkbox" />
                <span>Certificado</span>
              </label>
            </div>
          </div>

          <div class="field" style="grid-column:1/-1;">
            <label>Comentarios</label>
            <textarea id="s_notes"></textarea>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn" id="btnCancel">Cancelar</button>
          <button class="btn btn-primary" id="btnSave">Guardar</button>
        </div>
      </div>
    </div>
  `;

  $("btnNew").addEventListener("click", ()=>{
    if (!ACCOUNTS.length) return toast("No hay cuentas activas disponibles");
    openCreateModal();
  });
  $("btnCloseModal").addEventListener("click", closeModal);
  $("btnCancel").addEventListener("click", closeModal);
  $("btnSave").addEventListener("click", saveSite);

  c.querySelectorAll("[data-edit-site]").forEach(btn=>{
    btn.addEventListener("click", ()=> openEditModal(btn.dataset.editSite));
  });

  c.querySelectorAll("[data-delete-site]").forEach(btn=>{
    btn.addEventListener("click", ()=> deactivateSite(btn.dataset.deleteSite));
  });

  $("s_accountId").innerHTML = ACCOUNTS
    .map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name || "—")}</option>`)
    .join("");

  if (accountIdPrefill && !editingSiteId) $("s_accountId").value = accountIdPrefill;
}

async function saveSite(){
  const data = {
    name: $("s_name").value.trim(),
    accountId: $("s_accountId").value,
    address: $("s_address").value.trim(),
    city: $("s_city").value.trim(),
    notes: $("s_notes").value.trim(),
    requiresSheet: $("s_requiresSheet").checked,
    requiresCertificate: $("s_requiresCertificate").checked,
    status: "active"
  };

  if (!data.name) return toast("Falta el nombre del predio");
  if (!data.accountId) return toast("Falta seleccionar una cuenta");
  if (!ACCOUNTS.some(a=>a.id === data.accountId)) return toast("La cuenta seleccionada está inactiva");

  $("btnSave").disabled = true;
  try{
    if (editingSiteId){
      await update("sites", editingSiteId, data, auth.currentUser);
      toast("Predio actualizado");
    } else {
      await create("sites", data, auth.currentUser);
      toast("Predio creado");
    }

    closeModal();
    await loadData();
    render();
  } catch(e){
    console.error(e);
    toast(e?.message || "Error guardando predio");
  } finally{
    $("btnSave").disabled = false;
  }
}

async function deactivateSite(siteId){
  const site = SITES.find(s=>s.id===siteId);
  if (!site) return toast("No se encontró el predio");

  const ok = window.confirm(`¿Dar de baja el predio "${site.name || "Sin nombre"}"?`);
  if (!ok) return;

  try{
    await update("sites", siteId, { status:"inactive" }, auth.currentUser);
    toast("Predio dado de baja");
    await loadData();
    render();
  } catch(e){
    console.error(e);
    toast(e?.message || "Error dando de baja predio");
  }
}

async function loadData(){
  ACCOUNTS = await list("accounts", {
    filters: [{ field:"status", op:"==", value:"active" }],
    order:{ field:"name", dir:"asc" },
    max:500
  });

  const filters = [];
 if (accountIdPrefill) filters.push({ field:"accountId", op:"==", value: accountIdPrefill });

  SITES = await list("sites", { filters, order:null, max:500 });
  SITES.sort((a,b)=>{
    const ad = a.updatedAt?.toDate ? a.updatedAt.toDate() : (a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0));
    const bd = b.updatedAt?.toDate ? b.updatedAt.toDate() : (b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0));
    return bd - ad;
  });
}

async function init(){
  await requireRole(["admin","operator","viewer"]);
  accountIdPrefill = getParam("accountId");
  const editId = getParam("editId");

  await loadShell({
    activeNav:"sites",
    primaryText:"+ Nuevo predio",
    onPrimary: ()=> openCreateModal()
  });

  await loadData();
  render();

  if (editId){
    openEditModal(editId);
  }
}

init();
