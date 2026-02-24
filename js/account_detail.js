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
let ACCOUNT_OPTIONS = [];
let CONTACTS = [];
let SITES = [];
let activeTab = "summary";

function subcontractorOptions(){
  return Array.from(new Set(
    ACCOUNT_OPTIONS
      .map(a=> String(a?.subcontractor || "").trim())
      .filter(Boolean)
  )).sort((a,b)=> a.localeCompare(b));
}

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
          ${escapeHtml(typeLabel(ACCOUNT.type))}${frequencyLabel(ACCOUNT) ? ` · ${escapeHtml(frequencyLabel(ACCOUNT))}` : ""} · ${escapeHtml(stageLabel(ACCOUNT.stage))}
          ${ACCOUNT.phone ? `· ${escapeHtml(ACCOUNT.phone)}` : ""}
          ${upd ? `· Actualizado: ${escapeHtml(formatDateTimeAR(upd))}` : ""}
        </div>

        <div class="row" style="gap:10px; flex-wrap:wrap;">
          <button class="btn" id="btnEdit">Editar</button>
          <a class="btn" href="../pages/contacts.html?accountId=${encodeURIComponent(ACCOUNT.id)}">+ Nuevo contacto</a>
          ${ACCOUNT.status === "active" ? `<a class="btn btn-primary" href="../pages/sites.html?accountId=${encodeURIComponent(ACCOUNT.id)}">+ Nuevo predio</a>` : `<button class="btn btn-primary" disabled>Cuenta inactiva</button>`}
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
            <label>Tipo de cliente</label>
            <select id="e_type">
              <option value="bank">Banco</option>
              <option value="building">Edificio</option>
              <option value="warehouse">Depósito</option>
              <option value="store">Local</option>
              <option value="plant">Planta</option>
            </select>
          </div>


          <div class="field">
            <label>Frecuencia de visita (unidad)</label>
            <input id="e_visitUnit" type="number" min="1" step="1" />
          </div>

          <div class="field">
            <label>Frecuencia de visita (período)</label>
            <select id="e_visitPeriod">
              <option value="day">Día</option>
              <option value="week">Semana</option>
              <option value="month">Mes</option>
              <option value="year">Año</option>
            </select>
          </div>

          <div class="field">
            <label>Estado (board)</label>
            <select id="e_stage">
              <option value="prospect">Prospecto</option>
              <option value="offer_sent">Oferta enviada</option>
              <option value="negotiation">Negociación</option>
              <option value="account_active">Cuenta activa</option>
              <option value="account_inactive">Cuenta inactiva</option>
              <option value="closed">Cerrado</option>
            </select>
          </div>

          <div class="field">
            <label>Teléfono</label>
            <input id="e_phone" />
          </div>

          <div class="field">
            <label>Sub Contratista</label>
            <input id="e_subcontractor" list="e_subcontractor_options" placeholder="Seleccionar o escribir..." />
            <datalist id="e_subcontractor_options">
              ${subcontractorOptions().map(v=>`<option value="${escapeHtml(v)}"></option>`).join("")}
            </datalist>
          </div>

          <div class="field">
            <label>Cantidad Planilla</label>
            <input id="e_sheetCount" type="number" min="0" step="1" />
          </div>

          <div class="field">
            <label>Cantidad Certificado</label>
            <input id="e_certificateCount" type="number" min="0" step="1" />
          </div>

          <div class="field">
            <label>Aviso</label>
            <select id="e_mailNotice">
              <option value="">Sin definir</option>
              <option value="mail">Mail</option>
              <option value="cd">CD</option>
              <option value="sicop">SICOP</option>
              <option value="cetronic">Cetronic</option>
            </select>
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
            <div class="muted small">Tipo de cliente</div>
            <div style="font-weight:700;">${escapeHtml(typeLabel(ACCOUNT.type))}</div>
          </div>
          <div>
            <div class="muted small">Sub Contratista</div>
            <div style="font-weight:700;">${escapeHtml(ACCOUNT.subcontractor || "—")}</div>
          </div>
          <div>
            <div class="muted small">Frecuencia de visita</div>
            <div style="font-weight:700;">${escapeHtml(frequencyLabel(ACCOUNT) || "—")}</div>
          </div>
          <div>
            <div class="muted small">Estado</div>
            <div style="font-weight:700;">${escapeHtml(stageLabel(ACCOUNT.stage))}</div>
          </div>
          <div>
            <div class="muted small">Cantidad Planilla</div>
            <div style="font-weight:700;">${escapeHtml(String(Math.max(0, Math.floor(Number(ACCOUNT.sheetCount || 0) || 0))))}</div>
          </div>
          <div>
            <div class="muted small">Cantidad Certificado</div>
            <div style="font-weight:700;">${escapeHtml(String(Math.max(0, Math.floor(Number(ACCOUNT.certificateCount || 0) || 0))))}</div>
          </div>
          <div>
            <div class="muted small">Aviso</div>
            <div style="font-weight:700;">${escapeHtml(mailNoticeLabel(ACCOUNT.mailNotice))}</div>
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
            <div class="row" style="justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap;">
              <div>
                <div class="card-title">${escapeHtml((ct.lastName||"") + ", " + (ct.firstName||"")).replace(", ", ct.firstName? ", ":"") || "—"}</div>
                <div class="card-sub muted small">
                  ${escapeHtml(ct.role || "")}
                  ${ct.mobile ? `· ${escapeHtml(ct.mobile)}` : ""}
                  ${ct.email ? `· ${escapeHtml(ct.email)}` : ""}
                </div>
              </div>
              <a class="btn" href="../pages/contacts.html?accountId=${encodeURIComponent(ACCOUNT.id)}&editId=${encodeURIComponent(ct.id)}">Abrir</a>
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
          <div class="row" style="justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap;">
            <div>
              <div class="card-title">${escapeHtml(site.name || "—")}</div>
              <div class="card-sub muted small">
                ${site.city ? `${escapeHtml(site.city)}` : ""}
                ${site.address ? `· ${escapeHtml(site.address)}` : ""}
              </div>
            </div>
            <a class="btn" href="../pages/sites.html?accountId=${encodeURIComponent(ACCOUNT.id)}&editId=${encodeURIComponent(site.id)}">Abrir</a>
          </div>
          ${site.notes ? `<div class="small" style="margin-top:8px;">${escapeHtml(site.notes)}</div>` : ""}
        </div>
      `).join("") : `<div class="muted">Sin predios todavía.</div>`}
    </div>
  `;
}

function typeLabel(t){
  if (t==="bank") return "Banco";
  if (t==="building") return "Edificio";
  if (t==="warehouse") return "Depósito";
  if (t==="store") return "Local";
  if (t==="plant") return "Planta";
  if (t==="business") return "Empresa";
  if (t==="commercial") return "Comercial";
  if (t==="residential") return "Residencial";
  return t || "—";
}

function periodLabel(period, unit){
  const many = Number(unit) > 1;
  if (period === "day") return many ? "días" : "día";
  if (period === "week") return many ? "semanas" : "semana";
  if (period === "month") return many ? "meses" : "mes";
  if (period === "year") return many ? "años" : "año";
  return period || "";
}

function frequencyLabel(account){
  const unit = Number(account?.visitFrequencyUnit || 0);
  const period = account?.visitFrequencyPeriod;
  if (!unit || !period) return "";
  return `${unit} por ${periodLabel(period, unit)}`;
}

function normalizeStage(s){
  if (s === "contacted") return "prospect";
  if (s === "active") return "account_active";
  if (s === "inactive") return "account_inactive";
  return s || "prospect";
}

function stageToAccountStatus(stage){
  return stage === "account_active" ? "active" : "inactive";
}

function normalizeMailNotice(raw){
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "";
  if (["mail", "correo", "email"].includes(v)) return "mail";
  if (v === "cd") return "cd";
  if (v === "sicop") return "sicop";
  if (v === "cetronic") return "cetronic";
  if (["1", "true", "si", "sí", "x", "yes"].includes(v)) return "mail";
  return "";
}

function mailNoticeLabel(raw){
  const v = normalizeMailNotice(raw);
  if (v === "mail") return "Mail";
  if (v === "cd") return "CD";
  if (v === "sicop") return "SICOP";
  if (v === "cetronic") return "Cetronic";
  return "Sin definir";
}

async function deactivateSitesForAccount(accountId){
  const activeSites = await list("sites", {
    filters: [
      { field:"accountId", op:"==", value: accountId },
      { field:"status", op:"==", value:"active" }
    ],
    order: null,
    max: 500
  });
  for (const site of activeSites){
    await update("sites", site.id, { status:"inactive" }, auth.currentUser);
  }
}

function stageLabel(s){
  const n = normalizeStage(s);
  if (n==="prospect") return "Prospecto";
  if (n==="offer_sent") return "Oferta enviada";
  if (n==="negotiation") return "Negociación";
  if (n==="account_active") return "Cuenta activa";
  if (n==="account_inactive") return "Cuenta inactiva";
  if (n==="closed") return "Cerrado";
  return n || "—";
}

function openEdit(){
  $("editBackdrop").style.display = "flex";
  $("e_name").value = ACCOUNT.name || "";
  $("e_type").value = ACCOUNT.type || "bank";
  $("e_visitUnit").value = String(Math.max(1, Number(ACCOUNT.visitFrequencyUnit || 1)));
  $("e_visitPeriod").value = ACCOUNT.visitFrequencyPeriod || "week";
  $("e_stage").value = normalizeStage(ACCOUNT.stage);
  $("e_phone").value = ACCOUNT.phone || "";
  $("e_subcontractor").value = ACCOUNT.subcontractor || "";
  $("e_sheetCount").value = String(Math.max(0, Math.floor(Number(ACCOUNT.sheetCount || 0) || 0)));
  $("e_certificateCount").value = String(Math.max(0, Math.floor(Number(ACCOUNT.certificateCount || 0) || 0)));
  $("e_mailNotice").value = normalizeMailNotice(ACCOUNT.mailNotice);
  $("e_notes").value = ACCOUNT.notes || "";
}
function closeEdit(){
  $("editBackdrop").style.display = "none";
}
async function saveEdit(){
  const stage = $("e_stage").value;
  const data = {
    name: $("e_name").value.trim(),
    type: $("e_type").value,
    visitFrequencyUnit: Math.max(1, Number($("e_visitUnit").value || 1)),
    visitFrequencyPeriod: $("e_visitPeriod").value,
    stage,
    status: stageToAccountStatus(stage),
    phone: $("e_phone").value.trim(),
    subcontractor: $("e_subcontractor").value.trim(),
    sheetCount: Math.max(0, Math.floor(Number($("e_sheetCount").value || 0) || 0)),
    certificateCount: Math.max(0, Math.floor(Number($("e_certificateCount").value || 0) || 0)),
    mailNotice: normalizeMailNotice($("e_mailNotice").value),
    notes: $("e_notes").value.trim()
  };
  if (!data.name) return toast("Falta el nombre");
  $("btnSaveEdit").disabled = true;
  try{
    await update("accounts", ACCOUNT.id, data, auth.currentUser);
    if (data.status === "inactive") await deactivateSitesForAccount(ACCOUNT.id);
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
    ACCOUNT_OPTIONS = await list("accounts", {
      order: { field:"name", dir:"asc" },
      max: 1000
    });
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
