import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { getById, list, update } from "./data_access.js";
import { escapeHtml, formatDateTimeAR, $, toast } from "./utils.js";

function getParam(name){
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

let ACCOUNT = null;
let CONTACTS = [];
let SITES = [];
let activeTab = "summary";

function render(){
  const c = document.getElementById("pageContent");
  if (!ACCOUNT){
    c.innerHTML = `<div class="panel" style="padding:14px;">No se encontró la cuenta.</div>`;
    return;
  }

  const upd = ACCOUNT.updatedAt?.toDate ? ACCOUNT.updatedAt.toDate() : null;

  c.innerHTML = `
    <div class="section-title">${escapeHtml(ACCOUNT.name || "Cuenta")}</div>

    <div class="panel" style="padding:14px;">
      <div class="row" style="justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div class="muted">
          ${escapeHtml(typeLabel(ACCOUNT.type))} · ${escapeHtml(stageLabel(ACCOUNT.stage))}
          ${ACCOUNT.phone ? `· ${escapeHtml(ACCOUNT.phone)}` : ""}
          ${upd ? `· Actualizado: ${escapeHtml(formatDateTimeAR(upd))}` : ""}
        </div>

        <div class="row" style="gap:10px; flex-wrap:wrap;">
          <button class="btn" id="btnEdit">Editar</button>
          <a class="btn" href="../pages/contacts.html?accountId=${encodeURIComponent(ACCOUNT.id)}">+ Nuevo contacto</a>
          <a class="btn btn-primary" href="../pages/sites.html?accountId=${encodeURIComponent(ACCOUNT.id)}">+ Nuevo predio</a>
        </div>
      </div>

      <div class="spacer"></div>

      <div class="tabs">
        <button class="tab ${activeTab==="summary"?"active":""}" data-tab="summary">Resumen</button>
        <button class="tab ${activeTab==="contacts"?"active":""}" data-tab="contacts">Contactos</button>
        <button class="tab ${activeTab==="sites"?"active":""}" data-tab="sites">Predios</button>
      </div>
    </div>

    <div class="spacer"></div>
    <div id="tabHost"></div>

    <!-- Modal editar -->
    <div class="modal-backdrop" id="editBackdrop">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">Editar cuenta</div>
          <button class="btn btn-ghost" id="btnCloseEdit">✕</button>
        </div>

        <div class="spacer"></div>

        <div class="grid2">
          <div class="field">
            <label>Nombre</label>
            <input id="e_name" />
          </div>

          <div class="field">
            <label>Tipo</label>
            <select id="e_type">
              <option value="business">Empresa</option>
              <option value="commercial">Comercial</option>
              <option value="residential">Residencial</option>
            </select>
          </div>

          <div class="field">
            <label>Estado (board)</label>
            <select id="e_stage">
              <option value="contacted">Contactado</option>
              <option value="negotiation">Negociación</option>
              <option value="offer_sent">Oferta enviada</option>
              <option value="closed">Cerrado</option>
            </select>
          </div>

          <div class="field">
            <label>Teléfono</label>
            <input id="e_phone" />
          </div>

          <div class="field" style="grid-column:1/-1;">
            <label>Comentarios</label>
            <textarea id="e_notes"></textarea>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn" id="btnCancelEdit">Cancelar</button>
          <button class="btn btn-primary" id="btnSaveEdit">Guardar</button>
        </div>
      </div>
    </div>
  `;

  // tabs render
  renderTab();

  // wire tabs
  c.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      activeTab = btn.dataset.tab;
      render();
    });
  });

  // wire edit
  $("btnEdit").addEventListener("click", openEdit);
  $("btnCloseEdit").addEventListener("click", closeEdit);
  $("btnCancelEdit").addEventListener("click", closeEdit);
  $("btnSaveEdit").addEventListener("click", saveEdit);
}

function renderTab(){
  const host = document.getElementById("tabHost");

  if (activeTab === "summary"){
    host.innerHTML = `
      <div class="panel" style="padding:14px;">
        <div class="grid2">
          <div>
            <div class="muted small">Nombre</div>
            <div style="font-weight:700;">${escapeHtml(ACCOUNT.name||"—")}</div>
          </div>
          <div>
            <div class="muted small">Teléfono</div>
            <div style="font-weight:700;">${escapeHtml(ACCOUNT.phone||"—")}</div>
          </div>
          <div>
            <div class="muted small">Tipo</div>
            <div style="font-weight:700;">${escapeHtml(typeLabel(ACCOUNT.type))}</div>
          </div>
          <div>
            <div class="muted small">Estado</div>
            <div style="font-weight:700;">${escapeHtml(stageLabel(ACCOUNT.stage))}</div>
          </div>
          <div style="grid-column:1/-1;">
            <div class="muted small">Comentarios</div>
            <div>${escapeHtml(ACCOUNT.notes||"—")}</div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  if (activeTab === "contacts"){
    host.innerHTML = `
      <div class="panel" style="padding:14px;">
        ${CONTACTS.length ? CONTACTS.map(ct=>`
          <div class="card" style="margin-bottom:10px;">
            <div class="card-title">${escapeHtml((ct.lastName||"") + ", " + (ct.firstName||"")).replace(", ", ct.firstName? ", ":"") || "—"}</div>
            <div class="card-sub muted small">
              ${escapeHtml(ct.role || "")}
              ${ct.mobile ? `· ${escapeHtml(ct.mobile)}` : ""}
              ${ct.email ? `· ${escapeHtml(ct.email)}` : ""}
            </div>
          </div>
        `).join("") : `<div class="muted">Sin contactos todavía.</div>`}
      </div>
    `;
    return;
  }

  host.innerHTML = `
    <div class="panel" style="padding:14px;">
      ${SITES.length ? SITES.map(site=>`
        <div class="card" style="margin-bottom:10px;">
          <div class="card-title">${escapeHtml(site.name || "—")}</div>
          <div class="card-sub muted small">
            ${site.city ? `${escapeHtml(site.city)}` : ""}
            ${site.address ? `· ${escapeHtml(site.address)}` : ""}
          </div>
          ${site.notes ? `<div class="small" style="margin-top:8px;">${escapeHtml(site.notes)}</div>` : ""}
        </div>
      `).join("") : `<div class="muted">Sin predios todavía.</div>`}
    </div>
  `;
}

function typeLabel(t){
  if (t==="business") return "Empresa";
  if (t==="commercial") return "Comercial";
  if (t==="residential") return "Residencial";
  return t || "—";
}
function stageLabel(s){
  if (s==="contacted") return "Contactado";
  if (s==="negotiation") return "Negociación";
  if (s==="offer_sent") return "Oferta enviada";
  if (s==="closed") return "Cerrado";
  return s || "—";
}

function openEdit(){
  $("editBackdrop").style.display = "flex";
  $("e_name").value = ACCOUNT.name || "";
  $("e_type").value = ACCOUNT.type || "business";
  $("e_stage").value = ACCOUNT.stage || "contacted";
  $("e_phone").value = ACCOUNT.phone || "";
  $("e_notes").value = ACCOUNT.notes || "";
}
function closeEdit(){
  $("editBackdrop").style.display = "none";
}
async function saveEdit(){
  const data = {
    name: $("e_name").value.trim(),
    type: $("e_type").value,
    stage: $("e_stage").value,
    phone: $("e_phone").value.trim(),
    notes: $("e_notes").value.trim()
  };
  if (!data.name) return toast("Falta el nombre");
  $("btnSaveEdit").disabled = true;
  try{
    await update("accounts", ACCOUNT.id, data, auth.currentUser);
    toast("Guardado");
    ACCOUNT = await getById("accounts", ACCOUNT.id);
    closeEdit();
    render();
  } catch(e){
    console.error(e);
    toast(e?.message || "Error guardando");
  } finally{
    $("btnSaveEdit").disabled = false;
  }
}

async function init(){
  await requireRole(["admin","operator","viewer"]);
  await loadShell({ activeNav:"accounts", primaryText:"+ Agregar cuenta", onPrimary: ()=>{ window.location.href="../pages/accounts.html"; } });

  const id = getParam("id");
  ACCOUNT = id ? await getById("accounts", id) : null;
  if (ACCOUNT){
    CONTACTS = await list("contacts", {
      filters: [{ field:"accountId", op:"==", value: ACCOUNT.id }],
      order: { field:"updatedAt", dir:"desc" },
      max: 200
    });
    SITES = await list("sites", {
      filters: [
        { field:"accountId", op:"==", value: ACCOUNT.id },
        { field:"status", op:"==", value:"active" }
      ],
      order: { field:"updatedAt", dir:"desc" },
      max: 200
    });
  }
  render();
}

init();
