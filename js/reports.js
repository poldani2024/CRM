import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { list } from "./data_access.js";
import { escapeHtml, $ } from "./utils.js";

let ACCOUNTS = [];
let SITES = [];
let VISITS = [];
let WORK_ORDERS = [];
let EMPLOYEES = [];

let reportLevel = "managerial";
let dateMode = "this_month";
let customFrom = "";
let customTo = "";

function toDateKey(d){
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function parseDateLike(source){
  if (!source) return null;
  if (source?.toDate) return source.toDate();
  if (typeof source === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source)){
    const [y, m, d] = source.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const dt = new Date(source);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function periodRange(){
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = today.getFullYear();
  const m = today.getMonth();

  if (dateMode === "this_month"){
    return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) };
  }
  if (dateMode === "last_month"){
    return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0) };
  }
  if (dateMode === "this_quarter"){
    const qStart = Math.floor(m / 3) * 3;
    return { from: new Date(y, qStart, 1), to: new Date(y, qStart + 3, 0) };
  }
  if (dateMode === "this_year"){
    return { from: new Date(y, 0, 1), to: new Date(y, 11, 31) };
  }

  const from = parseDateLike(customFrom) || today;
  const to = parseDateLike(customTo) || from;
  return { from, to };
}

function inRange(source, from, to){
  const d = parseDateLike(source);
  if (!d) return false;
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return n >= from && n <= to;
}

function pct(part, total){
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function managerialData(from, to){
  const activeAccounts = ACCOUNTS.filter(a=>a.status === "active").length;
  const pipeline = {
    prospect: ACCOUNTS.filter(a=>a.stage === "prospect").length,
    offer_sent: ACCOUNTS.filter(a=>a.stage === "offer_sent").length,
    negotiation: ACCOUNTS.filter(a=>a.stage === "negotiation").length,
    account_active: ACCOUNTS.filter(a=>a.stage === "account_active").length,
    closed: ACCOUNTS.filter(a=>a.stage === "closed").length
  };

  const ordersInRange = WORK_ORDERS.filter(o=> inRange(o.visitDate || o.generatedAt, from, to));
  const done = ordersInRange.filter(o=>o.status === "Concretada").length;
  const failed = ordersInRange.filter(o=>["No realizada", "Cancelada"].includes(o.status)).length;
  const inProgress = ordersInRange.filter(o=>o.status === "En ejecución").length;

  const serviceTotal = done + failed + inProgress;

  const byCompany = new Map();
  for (const order of ordersInRange){
    const key = order.accountName || "Sin empresa";
    if (!byCompany.has(key)) byCompany.set(key, { company: key, total: 0, done: 0, issues: 0 });
    const row = byCompany.get(key);
    row.total += 1;
    if (order.status === "Concretada") row.done += 1;
    if (["No realizada", "Cancelada", "Postergada"].includes(order.status)) row.issues += 1;
  }

  const topCompanyIssues = [...byCompany.values()]
    .sort((a, b)=> b.issues - a.issues || b.total - a.total)
    .slice(0, 8);

  return {
    activeAccounts,
    totalAccounts: ACCOUNTS.length,
    conversion: pct(pipeline.account_active, ACCOUNTS.length),
    pipeline,
    service: { done, failed, inProgress, total: serviceTotal, compliance: pct(done, serviceTotal) },
    topCompanyIssues
  };
}

function operationalData(from, to){
  const ordersInRange = WORK_ORDERS.filter(o=> inRange(o.visitDate || o.generatedAt, from, to));

  const byEmployee = new Map();
  for (const e of EMPLOYEES){
    byEmployee.set(e.id, {
      employee: `${e.lastName || ""}${e.lastName && e.firstName ? ", " : ""}${e.firstName || ""}`.trim() || "—",
      total: 0,
      confirmed: 0,
      doing: 0,
      done: 0,
      issues: 0
    });
  }

  for (const order of ordersInRange){
    const refs = Array.isArray(order?.assignedEmployees) && order.assignedEmployees.length
      ? order.assignedEmployees
      : (Array.isArray(order?.employeeIds) && order.employeeIds.length
        ? order.employeeIds.map((id, idx)=> ({ id, name: order?.employeeNames?.[idx] || "" }))
        : (order.employeeId ? [{ id: order.employeeId, name: order.employeeName || "" }] : []));

    const normalizedRefs = refs.length
      ? refs.map(ref=> ({
          id: String(ref?.id || "").trim(),
          name: String(ref?.name || "").trim() || "Sin empleado"
        })).filter(ref=> ref.id)
      : [{ id: "__none__", name: "Sin empleado" }];

    for (const ref of normalizedRefs){
      if (!byEmployee.has(ref.id)){
        byEmployee.set(ref.id, { employee: ref.name, total: 0, confirmed: 0, doing: 0, done: 0, issues: 0 });
      }
      const row = byEmployee.get(ref.id);
      row.total += 1;
      if (order.status === "Confirmada") row.confirmed += 1;
      if (order.status === "En ejecución") row.doing += 1;
      if (order.status === "Concretada") row.done += 1;
      if (["No realizada", "Cancelada", "Postergada"].includes(order.status)) row.issues += 1;
    }
  }

  const employeesTable = [...byEmployee.values()]
    .filter(r=>r.total > 0)
    .sort((a, b)=> b.total - a.total || a.employee.localeCompare(b.employee));

  const visitsInRange = VISITS.filter(v=> inRange(v.plannedDate || v.date || v.scheduledFor, from, to));
  const visitsByStatus = {
    confirmed: visitsInRange.filter(v=>String(v.status || "").toLowerCase() === "confirmed").length,
    in_progress: visitsInRange.filter(v=>String(v.status || "").toLowerCase() === "in_progress").length,
    postponed: visitsInRange.filter(v=>String(v.status || "").toLowerCase() === "postponed").length,
    completed: visitsInRange.filter(v=>String(v.status || "").toLowerCase() === "completed").length,
    missed: visitsInRange.filter(v=>String(v.status || "").toLowerCase() === "missed").length,
    cancelled: visitsInRange.filter(v=>String(v.status || "").toLowerCase() === "cancelled").length
  };

  const bySite = new Map();
  for (const order of ordersInRange){
    const key = `${order.accountName || "—"} · ${order.siteName || "—"}`;
    if (!bySite.has(key)) bySite.set(key, { site: key, total: 0, done: 0, pending: 0 });
    const row = bySite.get(key);
    row.total += 1;
    if (order.status === "Concretada") row.done += 1;
    if (["Confirmada", "En ejecución", "Postergada", "No realizada"].includes(order.status)) row.pending += 1;
  }

  const topSites = [...bySite.values()].sort((a,b)=>b.total-a.total).slice(0,10);

  return { employeesTable, visitsByStatus, topSites, totalOrders: ordersInRange.length };
}

function renderManagerial(from, to){
  const m = managerialData(from, to);
  return `
    <div class="grid2" style="grid-template-columns: repeat(4,minmax(180px,1fr)); gap:10px;">
      <div class="card"><div class="muted small">Cuentas activas</div><div class="card-title">${m.activeAccounts}</div></div>
      <div class="card"><div class="muted small">Total cuentas</div><div class="card-title">${m.totalAccounts}</div></div>
      <div class="card"><div class="muted small">Conversión a activa</div><div class="card-title">${m.conversion}</div></div>
      <div class="card"><div class="muted small">Cumplimiento servicio</div><div class="card-title">${m.service.compliance}</div></div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      <div style="font-weight:700; margin-bottom:8px;">Pipeline Comercial</div>
      <div class="row" style="gap:10px; flex-wrap:wrap;">
        <div class="badge">Prospecto: ${m.pipeline.prospect}</div>
        <div class="badge">Oferta enviada: ${m.pipeline.offer_sent}</div>
        <div class="badge">Negociación: ${m.pipeline.negotiation}</div>
        <div class="badge">Cuenta activa: ${m.pipeline.account_active}</div>
        <div class="badge">Cerrado: ${m.pipeline.closed}</div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      <div style="font-weight:700; margin-bottom:8px;">Clientes con mayor desvío operativo</div>
      ${m.topCompanyIssues.length ? `
      <table class="gantt-table" style="min-width:100%; width:100%;">
        <thead><tr><th>Empresa</th><th>OT total</th><th>Concretadas</th><th>Desvíos</th></tr></thead>
        <tbody>
          ${m.topCompanyIssues.map(r=>`<tr><td>${escapeHtml(r.company)}</td><td>${r.total}</td><td>${r.done}</td><td>${r.issues}</td></tr>`).join("")}
        </tbody>
      </table>` : `<div class="muted">Sin datos para el período.</div>`}
    </div>
  `;
}

function renderOperational(from, to){
  const op = operationalData(from, to);
  return `
    <div class="grid2" style="grid-template-columns: repeat(4,minmax(180px,1fr)); gap:10px;">
      <div class="card"><div class="muted small">OT en período</div><div class="card-title">${op.totalOrders}</div></div>
      <div class="card"><div class="muted small">Visitas confirmadas</div><div class="card-title">${op.visitsByStatus.confirmed}</div></div>
      <div class="card"><div class="muted small">Visitas en ejecución</div><div class="card-title">${op.visitsByStatus.in_progress}</div></div>
      <div class="card"><div class="muted small">Visitas no realizadas/canceladas</div><div class="card-title">${op.visitsByStatus.missed + op.visitsByStatus.cancelled}</div></div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      <div style="font-weight:700; margin-bottom:8px;">Carga por empleado</div>
      ${op.employeesTable.length ? `
      <table class="gantt-table" style="min-width:100%; width:100%;">
        <thead><tr><th>Empleado</th><th>Total OT</th><th>Confirmadas</th><th>En ejecución</th><th>Concretadas</th><th>Desvíos</th></tr></thead>
        <tbody>
          ${op.employeesTable.map(r=>`<tr><td>${escapeHtml(r.employee)}</td><td>${r.total}</td><td>${r.confirmed}</td><td>${r.doing}</td><td>${r.done}</td><td>${r.issues}</td></tr>`).join("")}
        </tbody>
      </table>` : `<div class="muted">Sin órdenes para el período.</div>`}
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      <div style="font-weight:700; margin-bottom:8px;">Predios con mayor actividad</div>
      ${op.topSites.length ? `
      <table class="gantt-table" style="min-width:100%; width:100%;">
        <thead><tr><th>Empresa · Predio</th><th>Total OT</th><th>Concretadas</th><th>Pendientes</th></tr></thead>
        <tbody>
          ${op.topSites.map(r=>`<tr><td>${escapeHtml(r.site)}</td><td>${r.total}</td><td>${r.done}</td><td>${r.pending}</td></tr>`).join("")}
        </tbody>
      </table>` : `<div class="muted">Sin datos para el período.</div>`}
    </div>
  `;
}

function render(){
  const c = $("pageContent");
  const { from, to } = periodRange();

  c.innerHTML = `
    <div class="section-title">Reportes</div>

    <div class="panel" style="padding:14px;">
      <div class="row" style="gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div class="field">
          <label>Nivel</label>
          <select id="r_level">
            <option value="managerial" ${reportLevel === "managerial" ? "selected" : ""}>Gerencial</option>
            <option value="operational" ${reportLevel === "operational" ? "selected" : ""}>Operativo</option>
          </select>
        </div>

        <div class="field">
          <label>Período</label>
          <select id="r_period">
            <option value="this_month" ${dateMode === "this_month" ? "selected" : ""}>Mes actual</option>
            <option value="last_month" ${dateMode === "last_month" ? "selected" : ""}>Mes anterior</option>
            <option value="this_quarter" ${dateMode === "this_quarter" ? "selected" : ""}>Trimestre actual</option>
            <option value="this_year" ${dateMode === "this_year" ? "selected" : ""}>Año actual</option>
            <option value="custom" ${dateMode === "custom" ? "selected" : ""}>Personalizado</option>
          </select>
        </div>

        <div class="field">
          <label>Desde</label>
          <input id="r_from" type="date" value="${escapeHtml(customFrom || toDateKey(from))}" ${dateMode === "custom" ? "" : "disabled"} />
        </div>

        <div class="field">
          <label>Hasta</label>
          <input id="r_to" type="date" value="${escapeHtml(customTo || toDateKey(to))}" ${dateMode === "custom" ? "" : "disabled"} />
        </div>

        <button class="btn btn-primary" id="btnRefreshReports">Actualizar</button>

        <div class="muted small">Rango: ${escapeHtml(toDateKey(from))} a ${escapeHtml(toDateKey(to))}</div>
      </div>
    </div>

    <div class="spacer"></div>

    ${reportLevel === "managerial" ? renderManagerial(from, to) : renderOperational(from, to)}
  `;

  $("r_level").addEventListener("change", ()=>{
    reportLevel = $("r_level").value;
    render();
  });

  $("r_period").addEventListener("change", ()=>{
    dateMode = $("r_period").value;
    if (dateMode !== "custom"){
      customFrom = "";
      customTo = "";
    }
    render();
  });

  $("r_from").addEventListener("change", ()=>{
    customFrom = $("r_from").value;
    dateMode = "custom";
    render();
  });

  $("r_to").addEventListener("change", ()=>{
    customTo = $("r_to").value;
    dateMode = "custom";
    render();
  });

  $("btnRefreshReports").addEventListener("click", render);
}

async function loadData(){
  [ACCOUNTS, SITES, VISITS, WORK_ORDERS, EMPLOYEES] = await Promise.all([
    list("accounts", { order: { field:"name", dir:"asc" }, max: 3000 }),
    list("sites", { order: { field:"name", dir:"asc" }, max: 5000 }),
    list("visits", { order: null, max: 8000 }),
    list("work_orders", { order: { field:"createdAt", dir:"desc" }, max: 8000 }),
    list("employees", { order: { field:"lastName", dir:"asc" }, max: 2000 })
  ]);
}

async function init(){
  await requireRole(["admin", "operator", "viewer"]);
  await loadShell({
    activeNav: "reports",
    primaryText: "Refrescar",
    onPrimary: async ()=>{
      await loadData();
      render();
    }
  });

  await loadData();
  render();
}

init();
