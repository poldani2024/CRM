import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create } from "./data_access.js";
import { escapeHtml, $, toast } from "./utils.js";

function getParam(name){
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

let CONTACTS = [];
let ACCOUNTS = [];
let accountIdPrefill = null;

function openModal(){
  $("modalBackdrop").style.display = "flex";
  if (accountIdPrefill) $("c_accountId").value = accountIdPrefill;
}
function closeModal(){
  $("modalBackdrop").style.display = "none";
  $("c_firstName").value = "";
  $("c_lastName").value = "";
  $("c_role").value = "";
  $("c_email").value = "";
  $("c_mobile").value = "";
  $("c_notes").value = "";
}

function render(){
  const c = document.getElementById("pageContent");
  c.innerHTML = `
    <div class="section-title">Contactos</div>

    <div class="panel" style="padding:14px;">
      <div class="row" style="justify-content:space-between; flex-wrap:wrap;">
        <div class="muted">Total: ${CONTACTS.length}</div>
        <button class="btn btn-primary" id="btnNew">+ Nuevo contacto</button>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      ${CONTACTS.length ? CONTACTS.map(ct=>{
        const acc = ACCOUNTS.find(a=>a.id===ct.accountId);
        return `
          <div class="card" style="margin-bottom:10px;">
            <div class="card-title">${escapeHtml((ct.lastName||"") + ", " + (ct.firstName||"")).replace(", ", ct.firstName? ", ":"") || "—"}</div>
            <div class="card-sub muted small">
              ${escapeHtml(acc?.name || "")}
              ${ct.role ? `· ${escapeHtml(ct.role)}` : ""}
              ${ct.mobile ? `· ${escapeHtml(ct.mobile)}` : ""}
              ${ct.email ? `· ${escapeHtml(ct.email)}` : ""}
            </div>
          </div>
        `;
      }).join("") : `<div class="muted">Sin contactos.</div>`}
    </div>

    <!-- modal -->
    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">Nuevo contacto</div>
          <button class="btn btn-ghost" id="btnCloseModal">✕</button>
        </div>

        <div class="spacer"></div>

        <div class="grid2">
          <div class="field">
            <label>Nombre</label>
            <input id="c_firstName" />
          </div>
          <div class="field">
            <label>Apellido</label>
            <input id="c_lastName" />
          </div>

          <div class="field">
            <label>Cuenta</label>
            <select id="c_accountId"></select>
          </div>

          <div class="field">
            <label>Rol</label>
            <input id="c_role" placeholder="Ej: Encargado" />
          </div>

          <div class="field">
            <label>Email</label>
            <input id="c_email" />
          </div>
          <div class="field">
            <label>WhatsApp / Móvil</label>
            <input id="c_mobile" placeholder="+549..." />
          </div>

          <div class="field" style="grid-column:1/-1;">
            <label>Comentarios</label>
            <textarea id="c_notes"></textarea>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn" id="btnCancel">Cancelar</button>
          <button class="btn btn-primary" id="btnSave">Guardar</button>
        </div>
      </div>
    </div>
  `;

  // wire
  $("btnNew").addEventListener("click", openModal);
  $("btnCloseModal").addEventListener("click", closeModal);
  $("btnCancel").addEventListener("click", closeModal);
  $("btnSave").addEventListener("click", saveContact);

  // fill accounts select
  $("c_accountId").innerHTML = ACCOUNTS
    .map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name||"—")}</option>`)
    .join("");
  if (accountIdPrefill) $("c_accountId").value = accountIdPrefill;
}

async function saveContact(){
  const data = {
    firstName: $("c_firstName").value.trim(),
    lastName: $("c_lastName").value.trim(),
    accountId: $("c_accountId").value,
    role: $("c_role").value.trim(),
    email: $("c_email").value.trim(),
    mobile: $("c_mobile").value.trim(),
    notes: $("c_notes").value.trim(),
    status: "active"
  };
  if (!data.firstName && !data.lastName) return toast("Falta nombre o apellido");

  $("btnSave").disabled = true;
  try{
    await create("contacts", data, auth.currentUser);
    toast("Contacto creado");
    closeModal();
    await loadData();
    render();
  } catch(e){
    console.error(e);
    toast(e?.message || "Error guardando contacto");
  } finally{
    $("btnSave").disabled = false;
  }
}

async function loadData(){
  ACCOUNTS = await list("accounts", { order:{ field:"name", dir:"asc" }, max: 500 });

  const filters = [];
  if (accountIdPrefill) filters.push({ field:"accountId", op:"==", value: accountIdPrefill });

  CONTACTS = await list("contacts", { filters, order:{ field:"updatedAt", dir:"desc" }, max: 500 });
}

async function init(){
  await requireRole(["admin","operator","viewer"]);
  accountIdPrefill = getParam("accountId");

  await loadShell({
    activeNav:"contacts",
    primaryText:"+ Nuevo contacto",
    onPrimary: ()=> openModal()
  });

  await loadData();
  render();
}

init();
