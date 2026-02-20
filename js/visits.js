import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create, update, remove } from "./data_access.js";
import { escapeHtml, $, toast } from "./utils.js";
import { createWorkOrder } from "./work_orders_service.js";

const PERIOD_DAYS = {
  day: 1,
  week: 7,
  month: 30,
  year: 365
};

const STATUS_OPTIONS = [
  { value: "confirmed", label: "Confirmada", icon: "🟠" },
  { value: "completed", label: "Concretada", icon: "✅" },
  { value: "missed", label: "No realizada", icon: "⛔" },
  { value: "cancelled", label: "Cancelada", icon: "⚫" },
  { value: "estimated", label: "Solo estimada", icon: "🟡" }
];

let ACCOUNTS = [];
let SITES = [];
let VISITS = [];
let EMPLOYEES = [];
let rangeDays = 30;
let startDate = startOfDay(new Date());
let selectedAccountId = "";
let selectedSiteId = "";
let activeMenuCell = null;
let selectedVisitForOrder = null;

function startOfDay(d){
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function dateKey(d){
  const n = startOfDay(d);
  const yyyy = n.getFullYear();
  const mm = String(n.getMonth() + 1).padStart(2, "0");
  const dd = String(n.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateKey(raw){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw || ""))) return null;
  const [yyyy, mm, dd] = String(raw).split("-").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function fmtDate(d){
  return d.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit" });
}

function parseVisitDate(v){
  const source = v.plannedDate || v.scheduledFor || v.date;
  if (!source) return null;
  if (source?.toDate) return startOfDay(source.toDate());
  if (typeof source === "string"){
    const fromKey = parseDateKey(source);
    if (fromKey) return startOfDay(fromKey);
  }
  const d = new Date(source);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

function cadenceDays(account){
  const unit = Math.max(1, Number(account.visitFrequencyUnit || 1));
  const base = PERIOD_DAYS[account.visitFrequencyPeriod] || 7;
  return Math.max(1, base / unit);
}

function planningDatesForSite(account, endDate){
  const dates = [];
  const stepDays = cadenceDays(account);
  let cursor = new Date(startDate);

  while (cursor <= endDate){
    dates.push(dateKey(cursor));
    cursor = new Date(cursor.getTime() + stepDays * 24 * 60 * 60 * 1000);
    cursor = startOfDay(cursor);
  }

  return dates;
}

function normalizeStatus(raw){
  const s = String(raw || "").toLowerCase();
  if (["confirmed", "confirmada", "confirmado"].includes(s)) return "confirmed";
  if (["completed", "done", "concretada", "realizada"].includes(s)) return "completed";
  if (["missed", "not_done", "no_realizada", "vencida"].includes(s)) return "missed";
  if (["cancelled", "canceled", "cancelada"].includes(s)) return "cancelled";
  return "estimated";
}

function statusClass(status){
  if (status === "confirmed") return "is-confirmed";
  if (status === "completed") return "is-completed";
  if (status === "missed") return "is-missed";
  if (status === "cancelled") return "is-cancelled";
  return "is-estimated";
}

function statusLabel(status){
  if (status === "confirmed") return "Confirmada";
  if (status === "completed") return "Concretada";
  if (status === "missed") return "No realizada";
  if (status === "cancelled") return "Cancelada";
  return "Estimada";
}

function getVisitMap(){
  const map = new Map();
  for (const v of VISITS){
    const dt = parseVisitDate(v);
    if (!dt || !v.siteId) continue;
    map.set(`${v.siteId}|${dateKey(dt)}`, {
      id: v.id,
      status: normalizeStatus(v.status),
      siteId: v.siteId,
      accountId: v.accountId || ""
    });
  }
  return map;
}

function buildDateColumns(){
  const cols = [];
  for (let i = 0; i <= rangeDays; i += 1){
    cols.push(new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000));
  }
  return cols;
}

function accountFilteredSites(){
  return SITES.filter(site=> !selectedAccountId || site.accountId === selectedAccountId);
}

function hideContextMenu(){
  const menu = $("visitContextMenu");
  if (!menu) return;
  menu.style.display = "none";
  activeMenuCell = null;
}

function showContextMenu(x, y, siteId, accountId, dKey, currentStatus, existingVisitId){
  const menu = $("visitContextMenu");
  if (!menu) return;

  activeMenuCell = { siteId, accountId, dKey };

  menu.innerHTML = `
    <div class="small muted" style="margin-bottom:6px;">${escapeHtml(dKey)}</div>
    ${STATUS_OPTIONS.map(opt=>`
      <button class="visit-menu-item ${currentStatus===opt.value?"active":""}" data-status="${opt.value}">
        <span class="visit-menu-icon" aria-hidden="true">${opt.icon}</span>
        ${escapeHtml(opt.label)}
      </button>
    `).join("")}
    ${(existingVisitId && currentStatus === "confirmed") ? `
      <hr class="visit-menu-sep" />
      <button class="visit-menu-item" data-action="assign-order">
        <span class="visit-menu-icon" aria-hidden="true">🧾</span>
        Asignar empleado / generar OT
      </button>
    ` : ""}
    ${existingVisitId ? `
      <hr class="visit-menu-sep" />
      <button class="visit-menu-item danger" data-action="delete">
        <span class="visit-menu-icon" aria-hidden="true">🗑️</span>
        Borrar estado
      </button>
    ` : ""}
  `;

  menu.style.display = "block";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8){
    menu.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
  }
  if (rect.bottom > window.innerHeight - 8){
    menu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
  }

  menu.querySelectorAll("[data-status]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const status = btn.dataset.status;
      await saveVisitStatus(status);
    });
  });

  const assignBtn = menu.querySelector("[data-action='assign-order']");
  if (assignBtn){
    assignBtn.addEventListener("click", ()=>{
      openAssignOrderModal(existingVisitId);
    });
  }

  const deleteBtn = menu.querySelector("[data-action='delete']");
  if (deleteBtn){
    deleteBtn.addEventListener("click", async ()=>{
      await deleteVisitStatus();
    });
  }
}

async function saveVisitStatus(status){
  if (!activeMenuCell) return;

  const { siteId, accountId, dKey } = activeMenuCell;
  const existing = VISITS.find(v=>{
    const dt = parseVisitDate(v);
    return dt && v.siteId === siteId && dateKey(dt) === dKey;
  });

  const payload = {
    siteId,
    accountId,
    plannedDate: dKey,
    status
  };

  try{
    if (existing?.id){
      await update("visits", existing.id, payload, auth.currentUser);
    } else {
      await create("visits", payload, auth.currentUser);
    }
    hideContextMenu();
    await loadData();
    render();
    toast("Visita actualizada");
  } catch(err){
    console.error(err);
    toast(err?.message || "No se pudo guardar la visita");
  }
}

async function deleteVisitStatus(){
  if (!activeMenuCell) return;

  const { siteId, dKey } = activeMenuCell;
  const existing = VISITS.find(v=>{
    const dt = parseVisitDate(v);
    return dt && v.siteId === siteId && dateKey(dt) === dKey;
  });
  if (!existing?.id){
    hideContextMenu();
    return;
  }

  try{
    await remove("visits", existing.id);
    hideContextMenu();
    await loadData();
    render();
    toast("Estado eliminado");
  } catch(err){
    console.error(err);
    toast(err?.message || "No se pudo borrar la visita");
  }
}

function employeeLabel(emp){
  return `${emp.lastName || ""}${emp.lastName && emp.firstName ? ", " : ""}${emp.firstName || ""}`.trim() || "—";
}

function openAssignOrderModal(visitId){
  const visit = VISITS.find(v=>v.id === visitId);
  if (!visit) return toast("No se encontró la visita confirmada");
  if (!EMPLOYEES.length) return toast("No hay empleados activos para asignar");

  selectedVisitForOrder = visit;
  hideContextMenu();
  $("order_visitDate").textContent = visit.plannedDate || visit.scheduledFor || visit.date || "—";
  const account = ACCOUNTS.find(a=>a.id === visit.accountId);
  const site = SITES.find(s=>s.id === visit.siteId);
  $("order_visitAccount").textContent = account?.name || "—";
  $("order_visitSite").textContent = site?.name || "—";
  $("order_employee").innerHTML = `<option value="">Seleccionar</option>${EMPLOYEES.map(emp=>`<option value="${escapeHtml(emp.id)}">${escapeHtml(employeeLabel(emp))}</option>`).join("")}`;
  $("order_observations").value = "";
  $("orderModalBackdrop").style.display = "flex";
}

function closeAssignOrderModal(){
  $("orderModalBackdrop").style.display = "none";
  selectedVisitForOrder = null;
}

async function createOrderFromVisit(){
  if (!selectedVisitForOrder) return;
  const employeeId = $("order_employee").value;
  if (!employeeId) return toast("Seleccioná un empleado");

  const employee = EMPLOYEES.find(e=>e.id === employeeId);
  const account = ACCOUNTS.find(a=>a.id === selectedVisitForOrder.accountId);
  const site = SITES.find(s=>s.id === selectedVisitForOrder.siteId);

  try{
    const created = await createWorkOrder({
      visit: selectedVisitForOrder,
      visitId: selectedVisitForOrder.id,
      account,
      site,
      employee,
      observations: $("order_observations").value,
      generatedBy: auth.currentUser
    });
    closeAssignOrderModal();
    await loadData();
    render();
    toast(`Orden generada: ${created.orderNumber}`);
  } catch(err){
    console.error(err);
    toast(err?.message || "No se pudo generar la orden");
  }
}

function wireMenuEvents(visitMap){
  document.querySelectorAll("[data-visit-cell]").forEach(cell=>{
    cell.addEventListener("click", (ev)=>{
      ev.stopPropagation();
      const siteId = cell.dataset.siteId;
      const accountId = cell.dataset.accountId;
      const dKey = cell.dataset.date;
      const existing = visitMap.get(`${siteId}|${dKey}`);
      showContextMenu(ev.clientX + 6, ev.clientY + 6, siteId, accountId, dKey, existing?.status || "", existing?.id || "");
    });
  });

  document.addEventListener("click", hideContextMenu);
  window.addEventListener("resize", hideContextMenu);
  window.addEventListener("scroll", hideContextMenu, true);
}

function render(){
  const c = $("pageContent");
  const endDate = new Date(startDate.getTime() + rangeDays * 24 * 60 * 60 * 1000);
  const dateCols = buildDateColumns();
  const accountsById = new Map(ACCOUNTS.map(a=>[a.id, a]));
  const visitMap = getVisitMap();
  const filteredSites = accountFilteredSites();

  if (selectedSiteId && !filteredSites.some(s=>s.id === selectedSiteId)){
    selectedSiteId = "";
  }

  const rows = filteredSites
    .map(site=>({ site, account: accountsById.get(site.accountId) }))
    .filter(row=>row.account)
    .filter(row=> !selectedSiteId || row.site.id === selectedSiteId)
    .sort((a,b)=>{
      const an = (a.account.name || "").localeCompare(b.account.name || "");
      if (an !== 0) return an;
      return (a.site.name || "").localeCompare(b.site.name || "");
    });

  c.innerHTML = `
    <div class="section-title">Visitas</div>

    <div class="panel" style="padding:14px;">
      <div class="row" style="gap:12px; flex-wrap:wrap; align-items:flex-end;">
        <div class="field">
          <label>Cuenta</label>
          <select id="v_accountFilter">
            <option value="">Todas las cuentas</option>
            ${ACCOUNTS.map(account=>`
              <option value="${escapeHtml(account.id)}" ${selectedAccountId===account.id?"selected":""}>${escapeHtml(account.name || "—")}</option>
            `).join("")}
          </select>
        </div>

        <div class="field">
          <label>Predio</label>
          <select id="v_siteFilter">
            <option value="">Todos los predios</option>
            ${filteredSites.map(site=>`
              <option value="${escapeHtml(site.id)}" ${selectedSiteId===site.id?"selected":""}>${escapeHtml(site.name || "—")}</option>
            `).join("")}
          </select>
        </div>

        <div class="field">
          <label>Desde fecha</label>
          <input id="v_start" type="date" value="${dateKey(startDate)}" />
        </div>

        <div class="field">
          <label>Horizonte</label>
          <select id="v_horizon">
            <option value="7" ${rangeDays===7?"selected":""}>1 semana</option>
            <option value="30" ${rangeDays===30?"selected":""}>1 mes</option>
            <option value="90" ${rangeDays===90?"selected":""}>3 meses</option>
            <option value="365" ${rangeDays===365?"selected":""}>12 meses</option>
          </select>
        </div>

        <button class="btn btn-primary" id="btnRefreshVisits">Actualizar vista</button>

        <div class="muted small">Predios planificados: ${rows.length} · Hasta ${escapeHtml(endDate.toLocaleDateString("es-AR"))}</div>
      </div>

      <div class="spacer"></div>

      <div class="row" style="gap:14px; flex-wrap:wrap;">
        <div class="legend-item"><span class="legend-dot is-estimated"></span> Estimada</div>
        <div class="legend-item"><span class="legend-dot is-confirmed"></span> Confirmada</div>
        <div class="legend-item"><span class="legend-dot is-completed"></span> Concretada</div>
        <div class="legend-item"><span class="legend-dot is-missed"></span> No realizada</div>
        <div class="legend-item"><span class="legend-dot is-cancelled"></span> Cancelada</div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="panel gantt-wrap">
      <table class="gantt-table">
        <thead>
          <tr>
            <th class="sticky-col col-account">Cuenta</th>
            <th class="sticky-col col-site">Predio</th>
            ${dateCols.map(d=>`<th class="col-date">${fmtDate(d)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map(({ site, account })=>{
            const estimatedDates = new Set(planningDatesForSite(account, endDate));
            return `
              <tr>
                <td class="sticky-col col-account">${escapeHtml(account.name || "—")}</td>
                <td class="sticky-col col-site">${escapeHtml(site.name || "—")}</td>
                ${dateCols.map(d=>{
                  const dKey = dateKey(d);
                  const existingVisit = visitMap.get(`${site.id}|${dKey}`);
                  const status = existingVisit?.status || (estimatedDates.has(dKey) ? "estimated" : "");
                  const dot = status ? `<span class="visit-dot ${statusClass(status)}"></span>` : "";
                  const title = status ? statusLabel(status) : "Agregar estado";
                  return `<td class="visit-cell" data-visit-cell="1" data-site-id="${escapeHtml(site.id)}" data-account-id="${escapeHtml(account.id)}" data-date="${escapeHtml(dKey)}" title="${escapeHtml(title)}">${dot}</td>`;
                }).join("")}
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>

    <div id="visitContextMenu" class="visit-context-menu" style="display:none;"></div>

    <div class="modal-backdrop" id="orderModalBackdrop">
      <div class="modal" style="max-width:560px;">
        <div class="modal-head">
          <div class="modal-title">Generar orden de trabajo</div>
          <button class="btn btn-ghost" id="btnCloseOrderModal">✕</button>
        </div>
        <div class="spacer"></div>
        <div class="field"><label>Fecha visita</label><div id="order_visitDate" class="muted">—</div></div>
        <div class="field"><label>Empresa</label><div id="order_visitAccount" class="muted">—</div></div>
        <div class="field"><label>Predio</label><div id="order_visitSite" class="muted">—</div></div>
        <div class="field"><label>Empleado asignado</label><select id="order_employee"></select></div>
        <div class="field"><label>Observaciones</label><textarea id="order_observations"></textarea></div>
        <div class="modal-actions">
          <button class="btn" id="btnCancelOrderModal">Cancelar</button>
          <button class="btn btn-primary" id="btnCreateOrder">Generar OT</button>
        </div>
      </div>
    </div>
  `;

  $("v_accountFilter").addEventListener("change", ()=>{
    selectedAccountId = $("v_accountFilter").value;
    selectedSiteId = "";
    hideContextMenu();
    render();
  });

  $("v_siteFilter").addEventListener("change", ()=>{
    selectedSiteId = $("v_siteFilter").value;
    hideContextMenu();
    render();
  });

  $("btnRefreshVisits").addEventListener("click", ()=>{
    const dt = $("v_start").value;
    startDate = dt ? startOfDay(new Date(`${dt}T00:00:00`)) : startOfDay(new Date());
    rangeDays = Number($("v_horizon").value || 30);
    selectedAccountId = $("v_accountFilter").value;
    selectedSiteId = $("v_siteFilter").value;
    hideContextMenu();
    render();
  });

  $("btnCloseOrderModal")?.addEventListener("click", closeAssignOrderModal);
  $("btnCancelOrderModal")?.addEventListener("click", closeAssignOrderModal);
  $("btnCreateOrder")?.addEventListener("click", createOrderFromVisit);

  wireMenuEvents(visitMap);
}

async function loadData(){
  ACCOUNTS = await list("accounts", {
    filters: [{ field:"status", op:"==", value:"active" }],
    order: { field:"name", dir:"asc" },
    max: 500
  });

  SITES = await list("sites", {
    filters: [{ field:"status", op:"==", value:"active" }],
    order: { field:"name", dir:"asc" },
    max: 1000
  });

  try{
    VISITS = await list("visits", {
      order: null,
      max: 4000
    });
  } catch(err){
    console.warn("No se pudo leer 'visits' (permisos o colección inexistente)", err);
    VISITS = [];
  }

  try{
    EMPLOYEES = await list("employees", {
      filters: [{ field:"status", op:"==", value:"active" }],
      order: { field:"lastName", dir:"asc" },
      max: 1000
    });
  } catch(err){
    console.warn("No se pudo leer 'employees'", err);
    EMPLOYEES = [];
  }
}

async function init(){
  await requireRole(["admin", "operator", "viewer"]);
  await loadShell({
    activeNav: "visits",
    primaryText: "Hoy",
    onPrimary: ()=>{
      startDate = startOfDay(new Date());
      hideContextMenu();
      render();
    }
  });

  await loadData();
  render();
}

init();
