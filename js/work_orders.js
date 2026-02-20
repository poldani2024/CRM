import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, update } from "./data_access.js";
import { createWorkOrder } from "./work_orders_service.js";
import { escapeHtml, $, toast } from "./utils.js";

const ORDER_STATUSES = ["Confirmada", "En ejecución", "Postergada", "Concretada", "No realizada", "Cancelada"];

let ACCOUNTS = [];
let SITES = [];
let EMPLOYEES = [];
let VISITS = [];
let WORK_ORDERS = [];
let selectedVisitId = "";

function parseVisitDate(v){
  const source = v.plannedDate || v.scheduledFor || v.date;
  if (!source) return "";
  if (source?.toDate) return source.toDate().toISOString().slice(0, 10);
  if (typeof source === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function employeeLabel(emp){
  return `${emp.lastName || ""}${emp.lastName && emp.firstName ? ", " : ""}${emp.firstName || ""}`.trim() || "—";
}

function mapOrderStatusToVisitStatus(status){
  if (status === "Confirmada") return "confirmed";
  if (status === "En ejecución") return "in_progress";
  if (status === "Postergada") return "postponed";
  if (status === "Concretada") return "completed";
  if (status === "No realizada") return "missed";
  if (status === "Cancelada") return "cancelled";
  return "confirmed";
}

function filteredConfirmedVisits(){
  const accountId = $("f_account")?.value || "";
  const siteId = $("f_site")?.value || "";
  const date = $("f_date")?.value || "";

  const visitsWithActiveOrder = new Set(
    WORK_ORDERS
      .filter(order=> order?.visitId)
      .filter(order=> (order.status || "") !== "Cancelada" && order.active !== false)
      .map(order=> order.visitId)
  );

  return VISITS
    .filter(v=> String(v.status || "").toLowerCase() === "confirmed")
    .filter(v=> !visitsWithActiveOrder.has(v.id))
    .filter(v=> !accountId || v.accountId === accountId)
    .filter(v=> !siteId || v.siteId === siteId)
    .filter(v=> !date || parseVisitDate(v) === date)
    .sort((a,b)=> parseVisitDate(a).localeCompare(parseVisitDate(b)));
}

function render(){
  const c = $("pageContent");
  const visits = filteredConfirmedVisits();

  c.innerHTML = `
    <div class="section-title">Órdenes de trabajo</div>

    <div class="panel" style="padding:14px;">
      <div style="font-weight:700;">Generar desde visitas confirmadas</div>
      <div class="row" style="gap:10px; margin-top:8px; flex-wrap:wrap; align-items:flex-end;">
        <div class="field">
          <label>Cuenta</label>
          <select id="f_account">
            <option value="">Todas</option>
            ${ACCOUNTS.map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name || "—")}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Predio</label>
          <select id="f_site">
            <option value="">Todos</option>
            ${SITES.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name || "—")}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Fecha visita</label>
          <input id="f_date" type="date" />
        </div>
        <button class="btn" id="btnApplyFilters">Filtrar</button>
      </div>

      <div class="spacer"></div>

      <div class="panel" style="padding:10px; border:1px dashed var(--line);">
        ${visits.length ? visits.map(v=>{
          const site = SITES.find(s=>s.id===v.siteId);
          const account = ACCOUNTS.find(a=>a.id===v.accountId);
          const selected = selectedVisitId === v.id ? "style=\"border-color:#1a73e8;background:#f1f6ff;\"" : "";
          return `<button class="btn" data-pick-visit="${escapeHtml(v.id)}" ${selected}>
            ${escapeHtml(parseVisitDate(v) || "—")} · ${escapeHtml(account?.name || "Sin cuenta")} · ${escapeHtml(site?.name || "Sin predio")}
          </button>`;
        }).join("<div class='spacer'></div>") : `<div class="muted">No hay visitas confirmadas con esos filtros.</div>`}
      </div>

      <div class="spacer"></div>

      <div class="row" style="gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div class="field">
          <label>Empleado</label>
          <select id="wo_employee">
            <option value="">Seleccionar empleado</option>
            ${EMPLOYEES.map(emp=>`<option value="${escapeHtml(emp.id)}">${escapeHtml(employeeLabel(emp))}</option>`).join("")}
          </select>
        </div>
        <div class="field" style="min-width:300px; flex:1;">
          <label>Observaciones</label>
          <input id="wo_observations" placeholder="Notas de la orden..." />
        </div>
        <button class="btn btn-primary" id="btnCreateWorkOrder">Generar orden</button>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      <div style="font-weight:700;">Órdenes registradas</div>
      <div class="spacer"></div>
      ${WORK_ORDERS.length ? WORK_ORDERS.map(order=>`
        <div class="card" style="margin-bottom:10px;">
          <div class="row" style="justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start;">
            <div>
              <div class="card-title">OT ${escapeHtml(order.orderNumber || "—")}</div>
              <div class="card-sub muted small">Visita: ${escapeHtml(order.visitDate || "—")} · ${escapeHtml(order.accountName || "—")} · ${escapeHtml(order.siteName || "—")}</div>
              <div class="card-sub muted small">Empleado: ${escapeHtml(order.employeeName || "—")}</div>
            </div>
            <div class="row" style="gap:8px; flex-wrap:wrap;">
              <select data-order-status="${escapeHtml(order.id)}">
                ${ORDER_STATUSES.map(st=>`<option value="${escapeHtml(st)}" ${order.status===st?"selected":""}>${escapeHtml(st)}</option>`).join("")}
              </select>
              <button class="btn" data-save-order="${escapeHtml(order.id)}">Guardar</button>
              <button class="btn" data-cancel-order="${escapeHtml(order.id)}">Anular</button>
            </div>
          </div>
          <div class="field" style="margin-top:8px;">
            <label>Observaciones</label>
            <textarea data-order-obs="${escapeHtml(order.id)}">${escapeHtml(order.observations || "")}</textarea>
          </div>
        </div>
      `).join("") : `<div class="muted">Sin órdenes todavía.</div>`}
    </div>
  `;

  $("btnApplyFilters")?.addEventListener("click", ()=>{
    selectedVisitId = "";
    render();
  });

  c.querySelectorAll("[data-pick-visit]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      selectedVisitId = btn.dataset.pickVisit;
      render();
    });
  });

  $("btnCreateWorkOrder")?.addEventListener("click", createOrderFromSelectedVisit);

  c.querySelectorAll("[data-save-order]").forEach(btn=>{
    btn.addEventListener("click", ()=> saveOrder(btn.dataset.saveOrder));
  });

  c.querySelectorAll("[data-cancel-order]").forEach(btn=>{
    btn.addEventListener("click", ()=> cancelOrder(btn.dataset.cancelOrder));
  });
}

async function createOrderFromSelectedVisit(){
  if (!selectedVisitId) return toast("Seleccioná una visita confirmada");
  const employeeId = $("wo_employee").value;
  if (!employeeId) return toast("Seleccioná un empleado");

  const visit = VISITS.find(v=>v.id === selectedVisitId);
  if (!visit) return toast("No se encontró la visita seleccionada");

  const account = ACCOUNTS.find(a=>a.id === visit.accountId);
  const site = SITES.find(s=>s.id === visit.siteId);
  const employee = EMPLOYEES.find(e=>e.id === employeeId);

  try{
    const created = await createWorkOrder({
      visit: { ...visit, plannedDate: parseVisitDate(visit) },
      visitId: visit.id,
      account,
      site,
      employee,
      observations: $("wo_observations").value,
      generatedBy: auth.currentUser
    });
    toast(`Orden generada: ${created.orderNumber}`);
    selectedVisitId = "";
    await loadData();
    render();
  } catch(err){
    console.error(err);
    toast(err?.message || "No se pudo generar la orden");
  }
}

async function saveOrder(orderId){
  const status = document.querySelector(`[data-order-status='${orderId}']`)?.value;
  const observations = document.querySelector(`[data-order-obs='${orderId}']`)?.value || "";
  if (!status) return;

  try{
    await update("work_orders", orderId, {
      status,
      observations,
      active: status !== "Cancelada"
    }, auth.currentUser);

    const order = WORK_ORDERS.find(w=>w.id === orderId);
    if (order?.visitId){
      await update("visits", order.visitId, {
        status: mapOrderStatusToVisitStatus(status)
      }, auth.currentUser);
    }

    toast("Orden actualizada");
    await loadData();
    render();
  } catch(err){
    console.error(err);
    toast(err?.message || "No se pudo actualizar la orden");
  }
}

async function cancelOrder(orderId){
  try{
    await update("work_orders", orderId, {
      status: "Cancelada",
      active: false
    }, auth.currentUser);

    const order = WORK_ORDERS.find(w=>w.id === orderId);
    if (order?.visitId){
      await update("visits", order.visitId, {
        status: "cancelled"
      }, auth.currentUser);
    }

    toast("Orden anulada");
    await loadData();
    render();
  } catch(err){
    console.error(err);
    toast(err?.message || "No se pudo anular la orden");
  }
}

async function loadData(){
  ACCOUNTS = await list("accounts", { filters:[{ field:"status", op:"==", value:"active" }], order:{ field:"name", dir:"asc" }, max:500 });
  SITES = await list("sites", { filters:[{ field:"status", op:"==", value:"active" }], order:{ field:"name", dir:"asc" }, max:1000 });
  EMPLOYEES = await list("employees", { filters:[{ field:"status", op:"==", value:"active" }], order:{ field:"lastName", dir:"asc" }, max:500 });
  VISITS = await list("visits", { order:null, max:4000 });
  WORK_ORDERS = await list("work_orders", { order:{ field:"createdAt", dir:"desc" }, max:2000 });
}

async function init(){
  await requireRole(["admin", "operator", "viewer"]);
  await loadShell({
    activeNav: "work_orders",
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
