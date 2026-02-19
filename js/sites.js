import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create } from "./data_access.js";
import { escapeHtml, formatDateTimeAR, $, toast } from "./utils.js";

function getParam(name){
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

let SITES = [];
let ACCOUNTS = [];
let accountIdPrefill = null;

function openModal(){
  $("modalBackdrop").style.display = "flex";
  if (accountIdPrefill) $("s_accountId").value = accountIdPrefill;
}

function closeModal(){
  $("modalBackdrop").style.display = "none";
  $("s_name").value = "";
  $("s_address").value = "";
  $("s_city").value = "";
  $("s_notes").value = "";
}

function render(){
  const c = document.getElementById("pageContent");
  c.innerHTML = `
    <div class="section-title">Predios</div>

    <div class="panel" style="padding:14px;">
      <div class="row" style="justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div class="muted">Total: ${SITES.length}</div>
        <button class="btn btn-primary" id="btnNew">+ Nuevo predio</button>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      ${SITES.length ? SITES.map(site=>{
        const acc = ACCOUNTS.find(a=>a.id===site.accountId);
        const upd = site.updatedAt?.toDate ? site.updatedAt.toDate() : null;
        return `
          <div class="card" style="margin-bottom:10px;">
            <div class="card-title">${escapeHtml(site.name || "—")}</div>
            <div class="card-sub muted small">
              ${acc?.id ? `<a href="../pages/account_detail.html?id=${encodeURIComponent(acc.id)}">${escapeHtml(acc.name || "Cuenta")}</a>` : "Sin cuenta"}
              ${site.city ? `· ${escapeHtml(site.city)}` : ""}
              ${site.address ? `· ${escapeHtml(site.address)}` : ""}
              ${upd ? `· Actualizado: ${escapeHtml(formatDateTimeAR(upd))}` : ""}
            </div>
            ${site.notes ? `<div class="small" style="margin-top:8px;">${escapeHtml(site.notes)}</div>` : ""}
          </div>
        `;
      }).join("") : `<div class="muted">Sin predios.</div>`}
    </div>

    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">Nuevo predio</div>
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

  $("btnNew").addEventListener("click", openModal);
  $("btnCloseModal").addEventListener("click", closeModal);
  $("btnCancel").addEventListener("click", closeModal);
  $("btnSave").addEventListener("click", saveSite);

  $("s_accountId").innerHTML = ACCOUNTS
    .map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name || "—")}</option>`)
    .join("");

  if (accountIdPrefill) $("s_accountId").value = accountIdPrefill;
}

async function saveSite(){
  const data = {
    name: $("s_name").value.trim(),
    accountId: $("s_accountId").value,
    address: $("s_address").value.trim(),
    city: $("s_city").value.trim(),
    notes: $("s_notes").value.trim(),
    status: "active"
  };

  if (!data.name) return toast("Falta el nombre del predio");
  if (!data.accountId) return toast("Falta seleccionar una cuenta");

  $("btnSave").disabled = true;
  try{
    await create("sites", data, auth.currentUser);
    toast("Predio creado");
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

async function loadData(){
  ACCOUNTS = await list("accounts", { order:{ field:"name", dir:"asc" }, max:500 });

  const filters = [];
  if (accountIdPrefill) filters.push({ field:"accountId", op:"==", value: accountIdPrefill });

  SITES = await list("sites", { filters, order:{ field:"updatedAt", dir:"desc" }, max:500 });
}

async function init(){
  await requireRole(["admin","operator","viewer"]);
  accountIdPrefill = getParam("accountId");

  await loadShell({
    activeNav:"sites",
    primaryText:"+ Nuevo predio",
    onPrimary: ()=> openModal()
  });

  await loadData();
  render();
}

init();
