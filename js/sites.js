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

const VISIT_WEEKDAYS = ["L","M","X","J","V","S","D"];
function normalizeVisitWeekdays(raw){
  const source = Array.isArray(raw) ? raw : (typeof raw === "string" ? String(raw).split(/[;,|\s]+/) : []);
  return Array.from(new Set(source.map(d=> String(d || "").trim().toUpperCase()).filter(d=> VISIT_WEEKDAYS.includes(d))));
}
function collectVisitWeekdays(containerId){
  return normalizeVisitWeekdays(Array.from(document.querySelectorAll(`#${containerId} [data-weekday]:checked`)).map(i=> i.dataset.weekday));
}
function setVisitWeekdays(containerId, days){
  const selected = new Set(normalizeVisitWeekdays(days));
  document.querySelectorAll(`#${containerId} [data-weekday]`).forEach(input=>{
    input.checked = selected.has(String(input.dataset.weekday || "").toUpperCase());
  });
}
function applyAccountVisitDefaults(accountId){
  const account = ACCOUNTS.find(a=>a.id === accountId);
  if (!account) return;
  $("s_visitUnit").value = String(Math.max(1, Number(account.visitFrequencyUnit || 1)));
  $("s_visitPeriod").value = account.visitFrequencyPeriod || "month";
  setVisitWeekdays("s_visitWeekdays", account.visitWeekdays || []);
}


function parseCsv(text){
  const rows = [];
  let row = [];
  let current = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length){
    const ch = text[i];
    if (inQuotes){
      if (ch === '"'){
        if (text[i + 1] === '"'){
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"'){
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === '\n'){
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      i += 1;
      continue;
    }
    if (ch === '\r'){
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.length || row.length){
    row.push(current);
    rows.push(row);
  }
  if (!rows.length) return [];
  const delimiter = (rows[0].join('').match(/;/g) || []).length > (rows[0].join('').match(/,/g) || []).length ? ';' : ',';
  const splitRows = rows.map(r=> r.length === 1 ? r[0].split(delimiter) : r);
  const headers = splitRows[0].map(h => String(h || '').trim());
  return splitRows.slice(1)
    .filter(r => r.some(c => String(c || '').trim()))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx)=>{ obj[h] = String(r[idx] || '').trim(); });
      return obj;
    });
}

function parseBool(raw){
  const v = String(raw || "").trim().toLowerCase();
  return ["1", "true", "si", "sí", "x", "yes"].includes(v);
}

function normalizeStatus(raw){
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "active";
  if (["inactive", "inactivo", "baja", "0", "false"].includes(v)) return "inactive";
  return "active";
}

async function importSitesFromCsv(file){
  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) return toast("CSV vacío");

  const required = ["account_name", "site_name"];
  const missing = required.filter(k => !(k in rows[0]));
  if (missing.length) return toast(`Faltan columnas: ${missing.join(", ")}`);

  const accountByName = new Map(ACCOUNTS.map(a=>[String(a.name || "").trim().toLowerCase(), a]));
  const existingSites = await list("sites", { order:null, max:3000 });
  const keySet = new Set(existingSites.map(s=>`${s.accountId || ""}::${String(s.name || "").trim().toLowerCase()}::${String(s.address || "").trim().toLowerCase()}`));

  let created = 0;
  let skipped = 0;

  for (const row of rows){
    const accountName = String(row.account_name || "").trim();
    const siteName = String(row.site_name || "").trim();
    const address = String(row.site_address || row.address || "").trim();
    if (!accountName || !siteName){ skipped += 1; continue; }

    const account = accountByName.get(accountName.toLowerCase());
    if (!account){ skipped += 1; continue; }

    const key = `${account.id}::${siteName.toLowerCase()}::${address.toLowerCase()}`;
    if (keySet.has(key)){ skipped += 1; continue; }

    await create("sites", {
      accountId: account.id,
      name: siteName,
      address,
      city: String(row.site_city || row.city || "").trim(),
      notes: String(row.site_notes || row.notes || "").trim(),
      requiresSheet: parseBool(row.requires_sheet),
      requiresCertificate: parseBool(row.requires_certificate),
      visitFrequencyUnit: Math.max(1, Number(account.visitFrequencyUnit || 1)),
      visitFrequencyPeriod: account.visitFrequencyPeriod || "month",
      visitWeekdays: normalizeVisitWeekdays(account.visitWeekdays || []),
      status: normalizeStatus(row.status)
    }, auth.currentUser);
    keySet.add(key);
    created += 1;
  }

  toast(`Importación predios OK · Creados: ${created} · Omitidos: ${skipped}`);
  await loadData();
  render();
}

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
  $("s_visitUnit").value = "1";
  $("s_visitPeriod").value = "month";
  setVisitWeekdays("s_visitWeekdays", []);

  if (accountIdPrefill) $("s_accountId").value = accountIdPrefill;
  applyAccountVisitDefaults($("s_accountId").value);
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
  $("s_visitUnit").value = String(Math.max(1, Number(site.visitFrequencyUnit || 1)));
  $("s_visitPeriod").value = site.visitFrequencyPeriod || "month";
  setVisitWeekdays("s_visitWeekdays", site.visitWeekdays || []);

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
        <div class="row" style="gap:8px;">
          <input id="sitesImportFile" type="file" accept=".csv,text/csv" style="display:none;" />
          <button class="btn" id="btnImportSites">Importar CSV</button>
          <button class="btn btn-primary" id="btnNew" ${ACCOUNTS.length ? "" : "disabled"}>+ Nuevo predio</button>
        </div>
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

          <div class="field">
            <label>Frecuencia visita (unidad mensual)</label>
            <input id="s_visitUnit" type="number" min="1" step="1" value="1" />
          </div>

          <div class="field">
            <label>Frecuencia visita (período)</label>
            <select id="s_visitPeriod">
              <option value="month">Mes</option>
              <option value="week">Semana</option>
              <option value="day">Día</option>
              <option value="year">Año</option>
            </select>
          </div>

          <div class="field" style="grid-column:1/-1;">
            <label>Días posibles de visita</label>
            <div id="s_visitWeekdays" class="row" style="gap:12px; flex-wrap:wrap;">
              <label class="row" style="gap:6px; align-items:center;"><input type="checkbox" data-weekday="L" /> <span>L</span></label>
              <label class="row" style="gap:6px; align-items:center;"><input type="checkbox" data-weekday="M" /> <span>M</span></label>
              <label class="row" style="gap:6px; align-items:center;"><input type="checkbox" data-weekday="X" /> <span>X</span></label>
              <label class="row" style="gap:6px; align-items:center;"><input type="checkbox" data-weekday="J" /> <span>J</span></label>
              <label class="row" style="gap:6px; align-items:center;"><input type="checkbox" data-weekday="V" /> <span>V</span></label>
              <label class="row" style="gap:6px; align-items:center;"><input type="checkbox" data-weekday="S" /> <span>S</span></label>
              <label class="row" style="gap:6px; align-items:center;"><input type="checkbox" data-weekday="D" /> <span>D</span></label>
            </div>
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
  $("btnImportSites").addEventListener("click", ()=> $("sitesImportFile").click());
  $("sitesImportFile").addEventListener("change", async ()=>{
    const file = $("sitesImportFile").files?.[0];
    $("sitesImportFile").value = "";
    if (!file) return;
    try{
      await importSitesFromCsv(file);
    } catch(err){
      console.error(err);
      toast(err?.message || "Error importando predios");
    }
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
  $("s_accountId").addEventListener("change", ()=>{ if (!editingSiteId) applyAccountVisitDefaults($("s_accountId").value); });
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
    visitFrequencyUnit: Math.max(1, Number($("s_visitUnit").value || 1)),
    visitFrequencyPeriod: $("s_visitPeriod").value,
    visitWeekdays: collectVisitWeekdays("s_visitWeekdays"),
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
