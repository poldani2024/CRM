import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, update } from "./data_access.js";
import { escapeHtml, $, toast } from "./utils.js";

const ORDER_STATUSES = ["Confirmada", "En ejecución", "Postergada", "Concretada", "No realizada", "Cancelada"];

let PROFILE = null;
let WORK_ORDERS = [];
let EMPLOYEES = [];
let SITES = [];
let ACCOUNTS = [];

const filters = {
  employeeId: "",
  accountName: "",
  siteName: "",
  dateMode: "today",
  date: ""
};

function toDateKey(d){
  const n = new Date(d);
  const yyyy = n.getFullYear();
  const mm = String(n.getMonth() + 1).padStart(2, "0");
  const dd = String(n.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeDate(raw){
  if (!raw) return "";
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (raw?.toDate) return toDateKey(raw.toDate());
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : toDateKey(d);
}

function employeeLabel(e){
  return `${e.lastName || ""}${e.lastName && e.firstName ? ", " : ""}${e.firstName || ""}`.trim() || "—";
}

function orderEmployeeRefs(order){
  if (Array.isArray(order?.assignedEmployees) && order.assignedEmployees.length){
    return order.assignedEmployees
      .map(emp=> ({ id: String(emp?.id || "").trim(), name: String(emp?.name || "").trim() || "Sin empleado" }))
      .filter(emp=> emp.id);
  }

  if (Array.isArray(order?.employeeIds) && order.employeeIds.length){
    return order.employeeIds
      .map((id, idx)=> ({
        id: String(id || "").trim(),
        name: String(order?.employeeNames?.[idx] || "").trim() || "Sin empleado"
      }))
      .filter(emp=> emp.id);
  }

  if (order?.employeeId){
    return [{ id: order.employeeId, name: order.employeeName || "Sin empleado" }];
  }

  return [];
}

function orderEmployeesText(order){
  const refs = orderEmployeeRefs(order);
  return refs.length ? refs.map(ref=> ref.name).join(" · ") : "Sin empleado";
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

function detectCurrentEmployeeId(){
  const currentEmail = String(auth.currentUser?.email || "").trim().toLowerCase();
  const currentName = String(PROFILE?.displayName || auth.currentUser?.displayName || "").trim().toLowerCase();

  const exactByEmail = EMPLOYEES.find(emp=> String(emp.email || "").trim().toLowerCase() === currentEmail);
  if (exactByEmail?.id) return exactByEmail.id;

  const exactByName = EMPLOYEES.find(emp=> employeeLabel(emp).trim().toLowerCase() === currentName);
  if (exactByName?.id) return exactByName.id;

  return "";
}

function filteredOrders(){
  const today = toDateKey(new Date());

  return WORK_ORDERS
    .filter(order=>{
      const refs = orderEmployeeRefs(order);
      if (PROFILE.role === "admin" && !filters.employeeId) return true;
      if (!refs.length) return false;
      return refs.some(ref=> ref.id === filters.employeeId);
    })
    .filter(order=> !filters.accountName || (order.accountName || "") === filters.accountName)
    .filter(order=> !filters.siteName || (order.siteName || "") === filters.siteName)
    .filter(order=>{
      const d = normalizeDate(order.visitDate || order.generatedAt);
      if (!d) return false;
      if (filters.dateMode === "upcoming") return d >= today;
      if (filters.dateMode === "custom") return !filters.date || d === filters.date;
      return d === today;
    })
    .sort((a,b)=> normalizeDate(a.visitDate || a.generatedAt).localeCompare(normalizeDate(b.visitDate || b.generatedAt)));
}

function render(){
  const c = $("pageContent");
  const accountNames = Array.from(new Set(WORK_ORDERS.map(o=> String(o.accountName || "")).filter(Boolean))).sort((a,b)=> a.localeCompare(b));
  const siteNames = Array.from(new Set(WORK_ORDERS.map(o=> String(o.siteName || "")).filter(Boolean))).sort((a,b)=> a.localeCompare(b));
  const orders = filteredOrders();

  c.innerHTML = `
    <div class="section-title">Mis órdenes de trabajo</div>

    <div class="panel mobile-sticky-filters" style="padding:12px;">
      <div class="grid2" style="gap:10px;">
        ${PROFILE.role === "admin" ? `
          <div class="field" style="grid-column:1/-1;">
            <label>Empleado</label>
            <select id="mywo_employee">
              <option value="">Todos</option>
              ${EMPLOYEES.map(e=>`<option value="${escapeHtml(e.id)}" ${filters.employeeId===e.id?"selected":""}>${escapeHtml(employeeLabel(e))}</option>`).join("")}
            </select>
          </div>
        ` : `
          <div class="field" style="grid-column:1/-1;">
            <label>Empleado</label>
            <div class="muted">${escapeHtml(employeeLabel(EMPLOYEES.find(e=>e.id===filters.employeeId) || {}))}</div>
          </div>
        `}

        <div class="field">
          <label>Empresa</label>
          <select id="mywo_account">
            <option value="">Todas</option>
            ${accountNames.map(name=>`<option value="${escapeHtml(name)}" ${filters.accountName===name?"selected":""}>${escapeHtml(name)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label>Predio</label>
          <select id="mywo_site">
            <option value="">Todos</option>
            ${siteNames.map(name=>`<option value="${escapeHtml(name)}" ${filters.siteName===name?"selected":""}>${escapeHtml(name)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label>Periodo</label>
          <select id="mywo_date_mode">
            <option value="today" ${filters.dateMode==="today"?"selected":""}>Hoy</option>
            <option value="upcoming" ${filters.dateMode==="upcoming"?"selected":""}>Próximas</option>
            <option value="custom" ${filters.dateMode==="custom"?"selected":""}>Fecha específica</option>
          </select>
        </div>

        <div class="field">
          <label>Fecha</label>
          <input id="mywo_date" type="date" value="${escapeHtml(filters.date)}" ${filters.dateMode==="custom"?"":"disabled"} />
        </div>
      </div>
    </div>

    <div class="spacer"></div>

    ${orders.length ? orders.map(order=>`
      <article class="card mywo-card">
        <div class="card-title">OT ${escapeHtml(order.orderNumber || "—")}</div>
        <div class="card-sub muted small">${escapeHtml(normalizeDate(order.visitDate || order.generatedAt) || "—")} · ${escapeHtml(order.accountName || "Sin empresa")} · ${escapeHtml(order.siteName || "Sin predio")}</div>
        <div class="card-sub muted small">Empleados: ${escapeHtml(orderEmployeesText(order))}</div>
        <div class="field" style="margin-top:8px;">
          <label>Estado</label>
          <select data-mywo-status="${escapeHtml(order.id)}">
            ${ORDER_STATUSES.map(st=>`<option value="${escapeHtml(st)}" ${order.status===st?"selected":""}>${escapeHtml(st)}</option>`).join("")}
          </select>
        </div>
        <div class="field" style="margin-top:8px;">
          <label>Observaciones</label>
          <textarea data-mywo-obs="${escapeHtml(order.id)}">${escapeHtml(order.observations || "")}</textarea>
        </div>
        <div class="row" style="justify-content:flex-end; margin-top:8px;">
          <button class="btn btn-primary" data-mywo-save="${escapeHtml(order.id)}">Guardar cambios</button>
        </div>
      </article>
    `).join("") : `<div class="panel" style="padding:12px;"><div class="muted">No hay órdenes para los filtros seleccionados.</div></div>`}
  `;

  $("mywo_employee")?.addEventListener("change", ()=>{
    filters.employeeId = $("mywo_employee").value;
    render();
  });
  $("mywo_account").addEventListener("change", ()=>{
    filters.accountName = $("mywo_account").value;
    render();
  });
  $("mywo_site").addEventListener("change", ()=>{
    filters.siteName = $("mywo_site").value;
    render();
  });
  $("mywo_date_mode").addEventListener("change", ()=>{
    filters.dateMode = $("mywo_date_mode").value;
    render();
  });

  $("mywo_date").addEventListener("change", ()=>{
    filters.date = $("mywo_date").value;
    filters.dateMode = "custom";
    render();
  });

  c.querySelectorAll("[data-mywo-save]").forEach(btn=>{
    btn.addEventListener("click", ()=> saveOrder(btn.dataset.mywoSave));
  });
}

async function saveOrder(orderId){
  const status = document.querySelector(`[data-mywo-status='${orderId}']`)?.value;
  const observations = document.querySelector(`[data-mywo-obs='${orderId}']`)?.value || "";
  if (!status) return;

  try{
    await update("work_orders", orderId, {
      status,
      observations,
      active: status !== "Cancelada"
    }, auth.currentUser);

    const order = WORK_ORDERS.find(o=>o.id === orderId);
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

async function loadData(){
  [WORK_ORDERS, EMPLOYEES, SITES, ACCOUNTS] = await Promise.all([
    list("work_orders", { order:{ field:"createdAt", dir:"desc" }, max:3000 }),
    list("employees", { filters:[{ field:"status", op:"==", value:"active" }], order:{ field:"lastName", dir:"asc" }, max:600 }),
    list("sites", { order:{ field:"name", dir:"asc" }, max:2000 }),
    list("accounts", { order:{ field:"name", dir:"asc" }, max:1000 })
  ]);
}

async function init(){
  PROFILE = await requireRole(["admin", "operator", "viewer"]);
  await loadShell({
    activeNav: "my_work_orders",
    primaryText: "Refrescar",
    onPrimary: async ()=>{
      await loadData();
      render();
    }
  });

  await loadData();
  filters.date = toDateKey(new Date());

  if (PROFILE.role === "admin"){
    filters.employeeId = "";
  } else {
    filters.employeeId = detectCurrentEmployeeId();
    if (!filters.employeeId){
      toast("No se encontró una vinculación automática con empleado. Contactá al administrador.");
    }
  }

  render();
}

init();
