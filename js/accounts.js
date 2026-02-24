import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create, update } from "./data_access.js";
import { escapeHtml, formatDateTimeAR, $, toast } from "./utils.js";

const STAGES = [
  { key:"prospect", label:"Prospecto" },
  { key:"offer_sent", label:"Oferta enviada" },
  { key:"negotiation", label:"Negociación" },
  { key:"account_active", label:"Cuenta activa" },
  { key:"account_inactive", label:"Cuenta inactiva" },
  { key:"closed", label:"Cerrado" }
];

let PROFILE = null;
let ACCOUNTS = [];
let accountFilters = {
  name: "",
  stage: "",
  locality: "",
  type: "",
  subcontractor: "",
  createdDate: ""
};

function normalizeStage(stage){
  const raw = String(stage || "");
  if (raw === "contacted") return "prospect";
  if (raw === "active") return "account_active";
  if (raw === "inactive") return "account_inactive";
  if (STAGES.some(s=>s.key === raw)) return raw;
  return "prospect";
}

function stageToAccountStatus(stage){
  return stage === "account_active" ? "active" : "inactive";
}

function normalizeMailNotice(raw){
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "";
  if (["mail", "correo", "email"].includes(v)) return "mail";
  if (["cd"].includes(v)) return "cd";
  if (["sicop"].includes(v)) return "sicop";
  if (["cetronic"].includes(v)) return "cetronic";
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

function subcontractorOptions(){
  return Array.from(new Set(
    ACCOUNTS
      .map(a=> String(a?.subcontractor || "").trim())
      .filter(Boolean)
  )).sort((a,b)=> a.localeCompare(b));
}

function renderSubcontractorOptions(){
  const dl = $("a_subcontractor_options");
  if (!dl) return;
  dl.innerHTML = subcontractorOptions()
    .map(v=> `<option value="${escapeHtml(v)}"></option>`)
    .join("");
}

async function deactivateSitesForAccount(accountId){
  const sites = await list("sites", {
    filters: [
      { field:"accountId", op:"==", value: accountId },
      { field:"status", op:"==", value:"active" }
    ],
    order: null,
    max: 2000
  });
  for (const site of sites){
    await update("sites", site.id, { status:"inactive" }, auth.currentUser);
  }
}


function openModal(){
  $("modalBackdrop").style.display = "flex";
}
function closeModal(){
  $("modalBackdrop").style.display = "none";
  $("a_name").value = "";
  $("a_phone").value = "";
  $("a_notes").value = "";
  $("a_subcontractor").value = "";
  $("a_sheetCount").value = "0";
  $("a_certificateCount").value = "0";
  $("a_mailNotice").value = "";
  $("a_type").value = "bank";
  $("a_visitUnit").value = "1";
  $("a_visitPeriod").value = "week";
  $("a_stage").value = "prospect";
}

function stageLabel(k){
  return STAGES.find(s=>s.key===k)?.label || k;
}

function accountCreatedDateKey(account){
  const dt = account?.createdAt?.toDate ? account.createdAt.toDate() : null;
  if (!dt) return "";
  return dt.toISOString().slice(0, 10);
}

function normalizeText(raw){
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function filteredAccounts(){
  const name = normalizeText(accountFilters.name);
  const locality = normalizeText(accountFilters.locality);
  const subcontractor = normalizeText(accountFilters.subcontractor);
  const createdDate = accountFilters.createdDate;

  return ACCOUNTS.filter(a=>{
    if (name && !normalizeText(a.name).includes(name)) return false;
    if (accountFilters.stage && normalizeStage(a.stage) !== accountFilters.stage) return false;
    if (accountFilters.type && String(a.type || "") !== accountFilters.type) return false;
    if (locality){
      const loc = normalizeText(a.city || a.locality || a.location);
      if (!loc.includes(locality)) return false;
    }
    if (subcontractor && !normalizeText(a.subcontractor).includes(subcontractor)) return false;
    if (createdDate && accountCreatedDateKey(a) !== createdDate) return false;
    return true;
  });
}

let draggedId = null;
let justDragged = false;

function enableDragDrop(){
  document.querySelectorAll(".card").forEach(card=>{
    card.setAttribute("draggable", "true");

    card.addEventListener("dragstart", ()=>{
      draggedId = card.dataset.id;
      justDragged = true;
      card.classList.add("dragging");
    });

    card.addEventListener("dragend", ()=>{
      card.classList.remove("dragging");
      draggedId = null;
      window.setTimeout(()=>{ justDragged = false; }, 60);
    });
  });

  document.querySelectorAll("[data-drop-stage]").forEach(col=>{
    const onDragOver = ev=>{
      ev.preventDefault();
      col.classList.add("drag-over");
      col.querySelector(".cards")?.classList.add("drag-over");
    };
    const onDragLeave = ()=>{
      col.classList.remove("drag-over");
      col.querySelector(".cards")?.classList.remove("drag-over");
    };

    col.addEventListener("dragover", onDragOver);
    col.addEventListener("dragleave", onDragLeave);
    col.querySelector(".cards")?.addEventListener("dragover", onDragOver);
    col.querySelector(".cards")?.addEventListener("dragleave", onDragLeave);

    col.addEventListener("drop", async ev=>{
      ev.preventDefault();
      onDragLeave();
      if (!draggedId) return;

      const newStage = col.dataset.dropStage;
      const acc = ACCOUNTS.find(a=>a.id === draggedId);
      if (!acc) return;
      if (normalizeStage(acc.stage) === newStage) return;

      try{
        await update("accounts", draggedId, {
          stage: newStage,
          status: stageToAccountStatus(newStage)
        }, auth.currentUser);
        if (stageToAccountStatus(newStage) === "inactive"){
          await deactivateSitesForAccount(draggedId);
        }
        toast("Movido ✅");

        await loadData();
        renderBoard();
      } catch(err){
        console.error(err);
        toast("Error moviendo");
      }
    });
  });
}

function renderBoard(){
  const content = document.getElementById("pageContent");
  content.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
      <div class="section-title" style="margin:0;">Cuentas</div>
      <div class="row" style="gap:8px;">
        <input id="accountsImportFile" type="file" accept=".csv,text/csv" style="display:none;" />
        <button class="btn" id="btnImportAccounts">Importar CSV</button>
      </div>
    </div>
    <div class="panel" style="padding:12px; margin-top:10px;">
      <div class="row" style="gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div class="field">
          <label>Nombre</label>
          <input id="f_name" value="${escapeHtml(accountFilters.name)}" placeholder="Buscar por nombre..." />
        </div>
        <div class="field">
          <label>Estado</label>
          <select id="f_stage">
            <option value="">Todos</option>
            ${STAGES.map(s=>`<option value="${escapeHtml(s.key)}" ${accountFilters.stage===s.key?"selected":""}>${escapeHtml(s.label)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Localidad</label>
          <input id="f_locality" value="${escapeHtml(accountFilters.locality)}" placeholder="Ej: Rosario" />
        </div>
        <div class="field">
          <label>Tipo cliente</label>
          <select id="f_type">
            <option value="">Todos</option>
            <option value="bank" ${accountFilters.type==="bank"?"selected":""}>Banco</option>
            <option value="building" ${accountFilters.type==="building"?"selected":""}>Edificio</option>
            <option value="warehouse" ${accountFilters.type==="warehouse"?"selected":""}>Depósito</option>
            <option value="store" ${accountFilters.type==="store"?"selected":""}>Local</option>
            <option value="plant" ${accountFilters.type==="plant"?"selected":""}>Planta</option>
            <option value="business" ${accountFilters.type==="business"?"selected":""}>Empresa</option>
            <option value="commercial" ${accountFilters.type==="commercial"?"selected":""}>Comercial</option>
            <option value="residential" ${accountFilters.type==="residential"?"selected":""}>Residencial</option>
          </select>
        </div>
        <div class="field">
          <label>Sub Contratista</label>
          <input id="f_subcontractor" value="${escapeHtml(accountFilters.subcontractor)}" list="f_subcontractor_opts" placeholder="Todos" />
          <datalist id="f_subcontractor_opts">
            ${subcontractorOptions().map(v=>`<option value="${escapeHtml(v)}"></option>`).join("")}
          </datalist>
        </div>
        <div class="field">
          <label>Fecha creación</label>
          <input id="f_createdDate" type="date" value="${escapeHtml(accountFilters.createdDate)}" />
        </div>
        <button class="btn" id="btnApplyAccountFilters">Filtrar</button>
        <button class="btn" id="btnClearAccountFilters">Limpiar</button>
      </div>
    </div>
    <div class="board">
      ${STAGES.map(s=>`
        <div class="col" data-drop-stage="${s.key}">
          <div class="col-head">
            <div class="col-title">${escapeHtml(s.label)}</div>
            <div class="badge" id="count_${s.key}">0</div>
          </div>
          <div class="cards" id="col_${s.key}"></div>
        </div>
      `).join("")}
    </div>
  `;

  const fileInput = document.getElementById("accountsImportFile");
  document.getElementById("btnImportAccounts").addEventListener("click", ()=> fileInput.click());
  fileInput.addEventListener("change", async ()=>{
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try{
      await importAccountsFromCsv(file);
    } catch(err){
      console.error(err);
      toast(err?.message || "Error importando CSV");
    }
  });

  $("btnApplyAccountFilters")?.addEventListener("click", ()=>{
    accountFilters = {
      name: $("f_name").value,
      stage: $("f_stage").value,
      locality: $("f_locality").value,
      type: $("f_type").value,
      subcontractor: $("f_subcontractor").value,
      createdDate: $("f_createdDate").value
    };
    renderBoard();
  });

  $("btnClearAccountFilters")?.addEventListener("click", ()=>{
    accountFilters = { name:"", stage:"", locality:"", type:"", subcontractor:"", createdDate:"" };
    renderBoard();
  });

  // distribuir cards
  const byStage = {};
  for (const s of STAGES) byStage[s.key] = [];
  for (const a of filteredAccounts()){
    const st = normalizeStage(a.stage);
    (byStage[st] ||= []).push(a);
  }

  for (const s of STAGES){
    const arr = byStage[s.key] || [];
    document.getElementById(`count_${s.key}`).textContent = String(arr.length);

    const host = document.getElementById(`col_${s.key}`);

        host.innerHTML = arr.map(a=>{
      const upd = a.updatedAt?.toDate ? a.updatedAt.toDate() : null;
      return `
        <div class="card" draggable="true" data-id="${a.id}">
          <div class="card-title">${escapeHtml(a.name || "—")}</div>
          <div class="card-sub muted small">
            ${escapeHtml(typeLabel(a.type))}
            ${a.phone ? `· ${escapeHtml(a.phone)}` : ""}
            ${a.subcontractor ? `· Sub Contratista: ${escapeHtml(a.subcontractor)}` : ""}
            ${frequencyLabel(a) ? `· ${escapeHtml(frequencyLabel(a))}` : ""}
            · Planilla: ${escapeHtml(String(Math.max(0, Math.floor(Number(a.sheetCount || 0) || 0))))}
            · Certificado: ${escapeHtml(String(Math.max(0, Math.floor(Number(a.certificateCount || 0) || 0))))}
            · Aviso: ${escapeHtml(mailNoticeLabel(a.mailNotice))}
          </div>
          <div class="card-meta">
            ${upd ? `<span>Actualizado: ${escapeHtml(formatDateTimeAR(upd))}</span>` : `<span class="muted">—</span>`}
          </div>
        </div>
      `;
    }).join("");

    host.querySelectorAll(".card").forEach(card=>{
      card.addEventListener("click", ()=>{
        if (justDragged) return;
        const id = card.dataset.id;
        window.location.href = `../pages/account_detail.html?id=${encodeURIComponent(id)}`;
      });
    });
  }

  renderSubcontractorOptions();

    enableDragDrop();
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
  const unit = Number(account.visitFrequencyUnit || 0);
  const period = account.visitFrequencyPeriod;
  if (!unit || !period) return "";
  return `${unit} por ${periodLabel(period, unit)}`;
}


function normalizeType(raw){
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "business";
  const map = {
    banco: "bank",
    bank: "bank",
    edificio: "building",
    building: "building",
    deposito: "warehouse",
    depósito: "warehouse",
    warehouse: "warehouse",
    local: "store",
    tienda: "store",
    store: "store",
    planta: "plant",
    plant: "plant",
    empresa: "business",
    business: "business",
    comercial: "commercial",
    commercial: "commercial",
    residencial: "residential",
    residential: "residential"
  };
  return map[v] || "business";
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

function normalizeStageImport(raw){
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return 'prospect';
  const map = {
    prospecto: 'prospect',
    prospect: 'prospect',
    'oferta enviada': 'offer_sent',
    oferta_enviada: 'offer_sent',
    offer_sent: 'offer_sent',
    negociacion: 'negotiation',
    negociación: 'negotiation',
    negotiation: 'negotiation',
    'cuenta activa': 'account_active',
    account_active: 'account_active',
    'cuenta inactiva': 'account_inactive',
    account_inactive: 'account_inactive',
    inactivo: 'account_inactive',
    inactive: 'account_inactive',
    activo: 'account_active',
    active: 'account_active',
    cerrado: 'closed',
    closed: 'closed'
  };
  return map[v] || normalizeStage(v);
}

async function importAccountsFromCsv(file){
  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) return toast('CSV vacío');

  const required = ['account_name'];
  const missing = required.filter(k => !(k in rows[0]));
  if (missing.length) return toast(`Faltan columnas: ${missing.join(', ')}`);

  const existingAccounts = await list('accounts', { order:{ field:'name', dir:'asc' }, max:1000 });
  const existingSites = await list('sites', { order:null, max:2000 });

  const accountByName = new Map(existingAccounts.map(a => [String(a.name || '').trim().toLowerCase(), a]));
  const siteKeySet = new Set(existingSites.map(s => `${s.accountId || ''}::${String(s.name || '').trim().toLowerCase()}::${String(s.address || '').trim().toLowerCase()}`));

  let createdAccounts = 0;
  let createdSites = 0;

  for (const row of rows){
    const accountName = String(row.account_name || '').trim();
    if (!accountName) continue;

    let account = accountByName.get(accountName.toLowerCase());
    if (!account){
      const stage = normalizeStageImport(row.stage);
      const freq = Math.max(1, Number(row.visit_frequency_per_month || 1));
      const payload = {
        name: accountName,
        type: normalizeType(row.account_type),
        phone: String(row.phone || '').trim(),
        subcontractor: String(row.subcontractor || '').trim(),
        sheetCount: Math.max(0, Math.floor(Number(row.sheet_count || 0) || 0)),
        certificateCount: Math.max(0, Math.floor(Number(row.certificate_count || 0) || 0)),
        mailNotice: normalizeMailNotice(row.mail_notice),
        notes: String(row.notes || '').trim(),
        stage,
        status: stageToAccountStatus(stage),
        visitFrequencyUnit: freq,
        visitFrequencyPeriod: 'month'
      };
      const id = await create('accounts', payload, auth.currentUser);
      account = { id, ...payload };
      accountByName.set(accountName.toLowerCase(), account);
      createdAccounts += 1;
    }

    const siteName = String(row.site_name || '').trim();
    const siteAddress = String(row.site_address || '').trim();
    if (account.status !== 'active') continue;
    if (!siteName) continue;

    const key = `${account.id}::${siteName.toLowerCase()}::${siteAddress.toLowerCase()}`;
    if (siteKeySet.has(key)) continue;

    await create('sites', {
      accountId: account.id,
      name: siteName,
      address: siteAddress,
      city: String(row.site_city || '').trim(),
      notes: String(row.site_notes || '').trim(),
      status: 'active'
    }, auth.currentUser);
    siteKeySet.add(key);
    createdSites += 1;
  }

  toast(`Importación OK · Cuentas: ${createdAccounts} · Predios: ${createdSites}`);
  await loadData();
  renderBoard();
}

async function loadData(){
  // accounts ordenadas por updatedAt desc
  ACCOUNTS = await list("accounts", {
    order: { field:"updatedAt", dir:"desc" },
    max: 400
  });
}

function wireModal(){
  $("btnCloseModal").addEventListener("click", closeModal);
  $("btnCancel").addEventListener("click", closeModal);

  $("btnSave").addEventListener("click", async ()=>{
    const name = $("a_name").value.trim();
    if (!name) return toast("Falta el nombre");

    const stage = $("a_stage").value;
    const data = {
      name,
      type: $("a_type").value,
      visitFrequencyUnit: Math.max(1, Number($("a_visitUnit").value || 1)),
      visitFrequencyPeriod: $("a_visitPeriod").value,
      stage,
      phone: $("a_phone").value.trim(),
      subcontractor: $("a_subcontractor").value.trim(),
      sheetCount: Math.max(0, Math.floor(Number($("a_sheetCount").value || 0) || 0)),
      certificateCount: Math.max(0, Math.floor(Number($("a_certificateCount").value || 0) || 0)),
      mailNotice: normalizeMailNotice($("a_mailNotice").value),
      notes: $("a_notes").value.trim(),
      status: stageToAccountStatus(stage)
    };

    $("btnSave").disabled = true;
    try{
      const id = await create("accounts", data, auth.currentUser);
      if (data.status === "inactive") await deactivateSitesForAccount(id);
      toast("Cuenta creada");
      closeModal();
      await loadData();
      renderBoard();
      // opcional: ir al detail
      // window.location.href = `../pages/account_detail.html?id=${encodeURIComponent(id)}`;
    } catch(e){
      console.error(e);
      toast(e?.message || "Error guardando");
    } finally{
      $("btnSave").disabled = false;
    }
  });
}

async function init(){
  PROFILE = await requireRole(["admin","operator","viewer"]);
  await loadShell({
    activeNav: "accounts",
    primaryText: "+ Agregar cuenta",
    onPrimary: ()=> openModal()
  });

  wireModal();
  await loadData();
  renderBoard();
}

init();
