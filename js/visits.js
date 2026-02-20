import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { list } from "./data_access.js";
import { escapeHtml, $ } from "./utils.js";

const PERIOD_DAYS = {
  day: 1,
  week: 7,
  month: 30,
  year: 365
};

let ACCOUNTS = [];
let SITES = [];
let VISITS = [];
let rangeDays = 30;
let startDate = startOfDay(new Date());

function startOfDay(d){
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function dateKey(d){
  return startOfDay(d).toISOString().slice(0, 10);
}

function fmtDate(d){
  return d.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit" });
}

function parseVisitDate(v){
  const source = v.plannedDate || v.scheduledFor || v.date;
  if (!source) return null;
  if (source?.toDate) return startOfDay(source.toDate());
  const d = new Date(source);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

function cadenceDays(account){
  const unit = Math.max(1, Number(account.visitFrequencyUnit || 1));
  const base = PERIOD_DAYS[account.visitFrequencyPeriod] || 7;
  return Math.max(1, base / unit);
}

function planningDatesForSite(site, account, endDate){
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

function getStatusMap(){
  const map = new Map();
  for (const v of VISITS){
    const dt = parseVisitDate(v);
    if (!dt || !v.siteId) continue;
    map.set(`${v.siteId}|${dateKey(dt)}`, normalizeStatus(v.status));
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

function render(){
  const c = $("pageContent");
  const endDate = new Date(startDate.getTime() + rangeDays * 24 * 60 * 60 * 1000);
  const dateCols = buildDateColumns();
  const accountsById = new Map(ACCOUNTS.map(a=>[a.id, a]));
  const statusMap = getStatusMap();

  const rows = SITES
    .map(site=>({ site, account: accountsById.get(site.accountId) }))
    .filter(row=>row.account)
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
            const estimatedDates = new Set(planningDatesForSite(site, account, endDate));
            return `
              <tr>
                <td class="sticky-col col-account">${escapeHtml(account.name || "—")}</td>
                <td class="sticky-col col-site">${escapeHtml(site.name || "—")}</td>
                ${dateCols.map(d=>{
                  const key = dateKey(d);
                  const maybeStatus = statusMap.get(`${site.id}|${key}`);
                  const status = maybeStatus || (estimatedDates.has(key) ? "estimated" : "");
                  if (!status) return `<td class="visit-cell"></td>`;
                  return `<td class="visit-cell" title="${escapeHtml(statusLabel(status))}"><span class="visit-dot ${statusClass(status)}"></span></td>`;
                }).join("")}
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  $("btnRefreshVisits").addEventListener("click", ()=>{
    const dt = $("v_start").value;
    startDate = dt ? startOfDay(new Date(`${dt}T00:00:00`)) : startOfDay(new Date());
    rangeDays = Number($("v_horizon").value || 30);
    render();
  });
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
}

async function init(){
  await requireRole(["admin", "operator", "viewer"]);
  await loadShell({
    activeNav: "visits",
    primaryText: "Hoy",
    onPrimary: ()=>{
      startDate = startOfDay(new Date());
      render();
    }
  });

  await loadData();
  render();
}

init();
