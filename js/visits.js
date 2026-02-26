import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create, update, remove } from "./data_access.js";
import { escapeHtml, $, toast, normalizeInputDateToKey, keyToDisplayDate, formatDateAR } from "./utils.js";
import { createWorkOrder } from "./work_orders_service.js";
import { ensureSiteForAccount } from "./account_site_reprocess.js";

const MISSING_SITE_PREFIX = "__missing_site__:";

const PERIOD_DAYS = {
  day: 1,
  week: 7,
  month: 30,
  year: 365
};

const WEEKDAY_TO_INDEX = { L:1, M:2, X:3, J:4, V:5, S:6, D:0 };

const STATUS_OPTIONS = [
  { value: "estimated", label: "Estimada", icon: "🟡" },
  { value: "confirmed", label: "Confirmada", icon: "🟠" },
  { value: "in_progress", label: "En ejecución", icon: "🔵" },
  { value: "postponed", label: "Postergada", icon: "🟣" },
  { value: "completed", label: "Concretada", icon: "✅" },
  { value: "missed", label: "No realizada", icon: "⛔" },
  { value: "cancelled", label: "Cancelada", icon: "⚫" }
];

let ACCOUNTS = [];
let SITES = [];
let VISITS = [];
let EMPLOYEES = [];
let rangeDays = 30;
let startDate = mondayOfWeek(new Date());
let selectedAccountId = "";
let selectedSiteId = "";
let activeMenuCell = null;
let selectedVisitForOrder = null;
let bulkSelectedSiteIds = new Set();
let showPendingOnly = false;

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
  const key = normalizeInputDateToKey(raw);
  if (!key) return null;
  const [yyyy, mm, dd] = key.split("-").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function mondayOfWeek(d){
  const n = startOfDay(d);
  const day = n.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  n.setDate(n.getDate() + diff);
  return n;
}

function weekdayLetter(d){
  const letters = ["D", "L", "M", "X", "J", "V", "S"];
  return letters[d.getDay()] || "?";
}

function fmtDate(d){
  const day = d.getDate();
  const month = d.getMonth() + 1;
  return `${weekdayLetter(d)} ${day}/${month}`;
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

function normalizeVisitWeekdays(days){
  if (!Array.isArray(days)) return [];
  return Array.from(new Set(days.map(d=> String(d || "").trim().toUpperCase()).filter(d=> d in WEEKDAY_TO_INDEX)));
}

function resolveVisitConfig(site, account){
  const unit = Math.max(1, Number(site?.visitFrequencyUnit || account?.visitFrequencyUnit || 1));
  const period = String(site?.visitFrequencyPeriod || account?.visitFrequencyPeriod || "week");
  const days = normalizeVisitWeekdays(site?.visitWeekdays?.length ? site.visitWeekdays : account?.visitWeekdays);
  return { unit, period, days };
}

function cadenceDays(site, account){
  const cfg = resolveVisitConfig(site, account);
  const base = PERIOD_DAYS[cfg.period] || 7;
  return Math.max(1, base / cfg.unit);
}

function planningDatesForSite(site, account, endDate){
  const dates = [];
  const cfg = resolveVisitConfig(site, account);
  const stepDays = cadenceDays(site, account);
  const allowedDays = new Set(cfg.days.map(d=> WEEKDAY_TO_INDEX[d]));
  let cursor = new Date(startDate);

  while (cursor <= endDate){
    let planned = startOfDay(cursor);
    if (allowedDays.size){
      let moved = 0;
      while (moved < 7 && !allowedDays.has(planned.getDay())){
        planned = new Date(planned.getTime() + 24 * 60 * 60 * 1000);
        moved += 1;
      }
    }

    if (planned <= endDate) dates.push(dateKey(planned));
    cursor = new Date(cursor.getTime() + stepDays * 24 * 60 * 60 * 1000);
    cursor = startOfDay(cursor);
  }

  return Array.from(new Set(dates)).sort();
}

function normalizeStatus(raw){
  const s = String(raw || "").toLowerCase();
  if (["confirmed", "confirmada", "confirmado"].includes(s)) return "confirmed";
  if (["in_progress", "en_ejecucion", "en ejecución", "ejecucion", "ejecución"].includes(s)) return "in_progress";
  if (["postponed", "postergada", "postergado"].includes(s)) return "postponed";
  if (["completed", "done", "concretada", "realizada"].includes(s)) return "completed";
  if (["missed", "not_done", "no_realizada", "vencida", "no realizada"].includes(s)) return "missed";
  if (["cancelled", "canceled", "cancelada"].includes(s)) return "cancelled";
  return "estimated";
}

function statusClass(status){
  if (status === "confirmed") return "is-confirmed";
  if (status === "in_progress") return "is-in-progress";
  if (status === "postponed") return "is-postponed";
  if (status === "completed") return "is-completed";
  if (status === "missed") return "is-missed";
  if (status === "cancelled") return "is-cancelled";
  return "is-estimated";
}

function statusLabel(status){
  if (status === "confirmed") return "Confirmada";
  if (status === "in_progress") return "En ejecución";
  if (status === "postponed") return "Postergada";
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
      accountId: v.accountId || "",
      manualEstimated: !!v.estimatedManual
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

function hasAnyVisitInRange(siteId, dateCols, visitMap){
  return dateCols.some(d=> visitMap.has(`${siteId}|${dateKey(d)}`));
}

function hasEstimatedInRange(site, account, endDate, dateCols, visitMap){
  const estimatedDates = new Set(planningDatesForSite(site, account, endDate));
  return dateCols.some(d=>{
    const dKey = dateKey(d);
    return estimatedDates.has(dKey) && !visitMap.has(`${site.id}|${dKey}`);
  });
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
  let finalSiteId = siteId;

  if (String(siteId || "").startsWith(MISSING_SITE_PREFIX)){
    const account = ACCOUNTS.find(a=>a.id === accountId);
    if (!account){
      hideContextMenu();
      return toast("No se encontró la cuenta para autogenerar predio");
    }

    const ok = window.confirm("Esta cuenta no tiene predio. ¿Querés autogenerar el predio ahora para registrar la visita?");
    if (!ok){
      hideContextMenu();
      return toast("Operación cancelada");
    }

    const generatedSite = await ensureSiteForAccount(account, auth.currentUser);
    if (!generatedSite?.id){
      hideContextMenu();
      return toast("No se pudo generar el predio automáticamente");
    }
    finalSiteId = generatedSite.id;
  }

  const existing = VISITS.find(v=>{
    const dt = parseVisitDate(v);
    return dt && v.siteId === finalSiteId && dateKey(dt) === dKey;
  });

  const payload = {
    siteId: finalSiteId,
    accountId,
    plannedDate: dKey,
    status,
    estimatedManual: status === "estimated"
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

function selectedOrderEmployeeIds(){
  return Array.from(document.querySelectorAll("#order_employees input[type='checkbox']:checked"))
    .map(input=> String(input.value || ""))
    .filter(Boolean);
}

function renderOrderEmployeesChecklist(){
  return EMPLOYEES.map(emp=>`
    <label class="employee-check-item">
      <input type="checkbox" value="${escapeHtml(emp.id)}" />
      <span>${escapeHtml(employeeLabel(emp))}</span>
    </label>
  `).join("");
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
  $("order_employees").innerHTML = renderOrderEmployeesChecklist();
  $("order_schedule").value = "";
  $("order_observations").value = "";
  $("orderModalBackdrop").style.display = "flex";
}

function closeAssignOrderModal(){
  $("orderModalBackdrop").style.display = "none";
  selectedVisitForOrder = null;
}

async function createOrderFromVisit(){
  if (!selectedVisitForOrder) return;
  const employeeIds = selectedOrderEmployeeIds();
  if (!employeeIds.length) return toast("Seleccioná al menos un empleado");

  const employees = employeeIds
    .map(id=> EMPLOYEES.find(e=>e.id === id))
    .filter(Boolean);
  const account = ACCOUNTS.find(a=>a.id === selectedVisitForOrder.accountId);
  const site = SITES.find(s=>s.id === selectedVisitForOrder.siteId);

  try{
    const created = await createWorkOrder({
      visit: selectedVisitForOrder,
      visitId: selectedVisitForOrder.id,
      account,
      site,
      employees,
      schedule: $("order_schedule").value,
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

function updateBulkSelectionUI(visibleRows){
  const selectedVisible = visibleRows.filter(r=>bulkSelectedSiteIds.has(r.site.id)).length;
  const countEl = $("bulkSelectedCount");
  if (countEl) countEl.textContent = String(selectedVisible);

  const btn = $("btnBulkPlan");
  if (btn) btn.disabled = selectedVisible === 0;

  const allCheckbox = $("bulkSelectAll");
  if (allCheckbox){
    allCheckbox.checked = visibleRows.length > 0 && selectedVisible === visibleRows.length;
    allCheckbox.indeterminate = selectedVisible > 0 && selectedVisible < visibleRows.length;
  }
}

function openBulkPlanModal(){
  const selectedCount = [...bulkSelectedSiteIds].length;
  if (!selectedCount) return toast("Seleccioná al menos un predio");
  $("bulk_visitDate").value = keyToDisplayDate(dateKey(new Date()));
  $("bulk_visitStatus").value = "confirmed";
  $("bulk_selectedInfo").textContent = `${selectedCount} predios seleccionados`;
  $("bulkPlanBackdrop").style.display = "flex";
}

function closeBulkPlanModal(){
  $("bulkPlanBackdrop").style.display = "none";
}

async function saveBulkPlannedVisits(){
  const plannedDate = normalizeInputDateToKey($("bulk_visitDate").value);
  const status = $("bulk_visitStatus").value;
  if (!plannedDate) return toast("Seleccioná la fecha");
  if (!status) return toast("Seleccioná un estado");

  const selectedIds = [...bulkSelectedSiteIds];
  if (!selectedIds.length) return toast("No hay predios seleccionados");

  const sitesById = new Map(SITES.map(s=>[s.id, s]));
  const existingByKey = new Map();
  for (const visit of VISITS){
    const dt = parseVisitDate(visit);
    if (!dt || !visit.siteId) continue;
    existingByKey.set(`${visit.siteId}|${dateKey(dt)}`, visit);
  }

  $("btnBulkSave").disabled = true;
  try{
    for (const siteId of selectedIds){
      const site = sitesById.get(siteId);
      if (!site?.accountId) continue;
      const key = `${siteId}|${plannedDate}`;
      const payload = {
        siteId,
        accountId: site.accountId,
        plannedDate,
        status
      };
      const existing = existingByKey.get(key);
      if (existing?.id){
        await update("visits", existing.id, payload, auth.currentUser);
      } else {
        await create("visits", payload, auth.currentUser);
      }
    }

    closeBulkPlanModal();
    hideContextMenu();
    await loadData();
    render();
    toast(`Visitas actualizadas: ${selectedIds.length}`);
  } catch(err){
    console.error(err);
    toast(err?.message || "No se pudo guardar la planificación masiva");
  } finally {
    $("btnBulkSave").disabled = false;
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
  const latestManualEstimatedBySite = new Map();
  for (const visit of VISITS){
    if (normalizeStatus(visit?.status) !== "estimated" || !visit?.estimatedManual || !visit?.siteId) continue;
    const dt = parseVisitDate(visit);
    if (!dt) continue;
    const key = dateKey(dt);
    const current = latestManualEstimatedBySite.get(visit.siteId);
    if (!current || key > current) latestManualEstimatedBySite.set(visit.siteId, key);
  }
  const filteredSites = accountFilteredSites();

  if (selectedSiteId && !filteredSites.some(s=>s.id === selectedSiteId)){
    selectedSiteId = "";
  }

  const rows = filteredSites
    .map(site=>({ site, account: accountsById.get(site.accountId) }))
    .filter(row=>row.account)
    .filter(row=>{
      if (!showPendingOnly) return true;
      const hasVisit = hasAnyVisitInRange(row.site.id, dateCols, visitMap);
      const hasEstimated = hasEstimatedInRange(row.site, row.account, endDate, dateCols, visitMap);
      return !hasVisit && hasEstimated;
    })
    .filter(row=> !selectedSiteId || row.site.id === selectedSiteId)
    .sort((a,b)=>{
      const an = (a.account.name || "").localeCompare(b.account.name || "");
      if (an !== 0) return an;
      return (a.site.name || "").localeCompare(b.site.name || "");
    });

  if (selectedAccountId && !rows.length){
    const account = accountsById.get(selectedAccountId);
    if (account){
      rows.push({
        account,
        site: {
          id: `${MISSING_SITE_PREFIX}${account.id}`,
          accountId: account.id,
          name: "Sin predio generado",
          address: "",
          city: "",
          isVirtualMissing: true
        }
      });
    }
  }

  const rowIds = new Set(rows.map(r=>r.site.id));
  bulkSelectedSiteIds = new Set([...bulkSelectedSiteIds].filter(id=>rowIds.has(id)));

  c.innerHTML = `
    <div class="section-title">Visitas</div>

    <div class="panel visits-toolbar-sticky" style="padding:14px;">
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
          <input id="v_start" value="${keyToDisplayDate(dateKey(startDate))}" placeholder="DD/MM/YYYY" inputmode="numeric" />
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

        <button class="btn" id="btnBulkPlan" ${bulkSelectedSiteIds.size?"":"disabled"}>Planificar selección</button>

        <label class="row" style="gap:8px; align-items:center; margin-left:6px;">
          <input type="checkbox" id="v_pendingOnly" ${showPendingOnly?"checked":""} />
          <span class="small">Pendientes de programar</span>
        </label>

        <div class="muted small">Predios planificados: ${rows.length} · Seleccionados: <span id="bulkSelectedCount">0</span> · Hasta ${escapeHtml(endDate.toLocaleDateString("es-AR"))}</div>
      </div>

      <div class="spacer"></div>

      <div class="row" style="gap:14px; flex-wrap:wrap;">
        <div class="legend-item"><span class="legend-dot is-estimated"></span> Estimada</div>
        <div class="legend-item"><span class="legend-dot is-confirmed"></span> Confirmada</div>
        <div class="legend-item"><span class="legend-dot is-in-progress"></span> En ejecución</div>
        <div class="legend-item"><span class="legend-dot is-postponed"></span> Postergada</div>
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
            <th class="sticky-col col-select"><input type="checkbox" id="bulkSelectAll" title="Seleccionar todo" /></th>
            <th class="sticky-col col-account">Cuenta</th>
            <th class="sticky-col col-site">Predio</th>
            <th class="col-address">Domicilio</th>
            <th class="col-city">Ciudad</th>
            ${dateCols.map(d=>`<th class="col-date">${fmtDate(d)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map(({ site, account })=>{
            const estimatedDates = new Set(planningDatesForSite(site, account, endDate));
            return `
              <tr>
                <td class="sticky-col col-select"><input type="checkbox" class="visit-row-check" data-site-select="${escapeHtml(site.id)}" ${site.isVirtualMissing?"disabled":""} ${bulkSelectedSiteIds.has(site.id)?"checked":""} /></td>
                <td class="sticky-col col-account">${escapeHtml(account.name || "—")}</td>
                <td class="sticky-col col-site">${site.isVirtualMissing ? "⚠ " : ""}${escapeHtml(site.name || "—")}</td>
                <td class="col-address">${escapeHtml(site.address || "—")}</td>
                <td class="col-city">${escapeHtml(site.city || "—")}</td>
                ${dateCols.map(d=>{
                  const dKey = dateKey(d);
                  const existingVisit = visitMap.get(`${site.id}|${dKey}`);
                  const latestManual = latestManualEstimatedBySite.get(site.id) || "";
                  const autoEstimated = estimatedDates.has(dKey) && (!latestManual || dKey > latestManual);
                  const status = existingVisit?.status || (autoEstimated ? "estimated" : "");
                  const manualMark = existingVisit?.status === "estimated" && existingVisit?.manualEstimated
                    ? `<span class="visit-manual-mark">M</span>`
                    : "";
                  const dot = status ? `<span class="visit-dot ${statusClass(status)}"></span>${manualMark}` : "";
                  const title = existingVisit?.status === "estimated" && existingVisit?.manualEstimated
                    ? "Estimada (manual)"
                    : (status ? statusLabel(status) : "Agregar estado");
                  return `<td class="visit-cell" data-visit-cell="1" data-site-id="${escapeHtml(site.id)}" data-account-id="${escapeHtml(account.id)}" data-date="${escapeHtml(dKey)}" title="${escapeHtml(title)}">${dot}</td>`;
                }).join("")}
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>

    <div id="visitContextMenu" class="visit-context-menu" style="display:none;"></div>

    <div class="modal-backdrop" id="bulkPlanBackdrop">
      <div class="modal" style="max-width:520px;">
        <div class="modal-head">
          <div class="modal-title">Planificar visitas en lote</div>
          <button class="btn btn-ghost" id="btnCloseBulkModal">✕</button>
        </div>
        <div class="spacer"></div>
        <div class="muted small" id="bulk_selectedInfo">0 predios seleccionados</div>
        <div class="spacer"></div>
        <div class="field"><label>Fecha para todos</label><input id="bulk_visitDate" value="${keyToDisplayDate(dateKey(new Date()))}" placeholder="DD/MM/YYYY" inputmode="numeric" /></div>
        <div class="field">
          <label>Estado para todos</label>
          <select id="bulk_visitStatus">${STATUS_OPTIONS.map(opt=>`<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join("")}</select>
        </div>
        <div class="modal-actions">
          <button class="btn" id="btnCancelBulkModal">Cancelar</button>
          <button class="btn btn-primary" id="btnBulkSave">Procesar selección</button>
        </div>
      </div>
    </div>

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
        <div class="field"><label>Empleados asignados</label><div id="order_employees" class="employee-checklist"></div></div>
        <div class="field"><label>Horario</label><input id="order_schedule" type="time" /></div>
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

  $("v_pendingOnly")?.addEventListener("change", ()=>{
    showPendingOnly = !!$("v_pendingOnly").checked;
    selectedSiteId = "";
    hideContextMenu();
    render();
  });

  $("btnRefreshVisits").addEventListener("click", ()=>{
    const dt = normalizeInputDateToKey($("v_start").value);
    if ($("v_start").value && !dt){
      toast("Fecha inválida. Usar formato DD/MM/YYYY");
      return;
    }
    startDate = dt ? mondayOfWeek(new Date(`${dt}T00:00:00`)) : mondayOfWeek(new Date());
    rangeDays = Number($("v_horizon").value || 30);
    selectedAccountId = $("v_accountFilter").value;
    selectedSiteId = $("v_siteFilter").value;
    showPendingOnly = !!$("v_pendingOnly")?.checked;
    hideContextMenu();
    render();
  });

  const allCheck = $("bulkSelectAll");
  allCheck?.addEventListener("click", ev=> ev.stopPropagation());
  allCheck?.addEventListener("change", ()=>{
    const checked = !!allCheck.checked;
    rows.forEach(({site})=>{
      if (checked) bulkSelectedSiteIds.add(site.id);
      else bulkSelectedSiteIds.delete(site.id);
    });
    document.querySelectorAll("[data-site-select]").forEach(input=>{
      input.checked = checked;
    });
    updateBulkSelectionUI(rows);
  });

  document.querySelectorAll("[data-site-select]").forEach(input=>{
    input.addEventListener("click", ev=> ev.stopPropagation());
    input.addEventListener("change", ()=>{
      const siteId = input.dataset.siteSelect;
      if (!siteId) return;
      if (input.checked) bulkSelectedSiteIds.add(siteId);
      else bulkSelectedSiteIds.delete(siteId);
      updateBulkSelectionUI(rows);
    });
  });

  $("btnBulkPlan")?.addEventListener("click", openBulkPlanModal);
  $("btnCloseBulkModal")?.addEventListener("click", closeBulkPlanModal);
  $("btnCancelBulkModal")?.addEventListener("click", closeBulkPlanModal);
  $("btnBulkSave")?.addEventListener("click", saveBulkPlannedVisits);

  $("btnCloseOrderModal")?.addEventListener("click", closeAssignOrderModal);
  $("btnCancelOrderModal")?.addEventListener("click", closeAssignOrderModal);
  $("btnCreateOrder")?.addEventListener("click", createOrderFromVisit);

  wireMenuEvents(visitMap);
  updateBulkSelectionUI(rows);
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
  const activeAccountIds = new Set(ACCOUNTS.map(a=>a.id));
  SITES = SITES.filter(site=> activeAccountIds.has(site.accountId));

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
