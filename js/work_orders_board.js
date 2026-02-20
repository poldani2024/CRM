import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, update } from "./data_access.js";
import { escapeHtml, $, toast } from "./utils.js";

const COLUMNS = [
  { key: "todo", title: "A Realizar" },
  { key: "doing", title: "Realizando" },
  { key: "done", title: "Realizado" }
];

let WORK_ORDERS = [];
let EMPLOYEES = [];
let draggedOrderId = null;
let filters = {
  employeeId: "",
  account: "",
  site: "",
  dateMode: "today",
  date: ""
};

function statusToColumn(status){
  if (["Confirmada", "No realizada"].includes(status)) return "todo";
  if (status === "En ejecución") return "doing";
  if (["Concretada", "Cancelada"].includes(status)) return "done";
  return "todo";
}

function columnToStatus(columnKey, previousStatus){
  if (columnKey === "todo") return "Confirmada";
  if (columnKey === "doing") return "En ejecución";
  if (columnKey === "done") return previousStatus === "Cancelada" ? "Cancelada" : "Concretada";
  return "Confirmada";
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

function employeeLabel(employee){
  return `${employee.lastName || ""}${employee.lastName && employee.firstName ? ", " : ""}${employee.firstName || ""}`.trim() || "Sin empleado";
}


function toDateKey(d){
  const n = new Date(d);
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

function normalizeOrderDate(order){
  const source = order?.visitDate || "";
  if (typeof source === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) return "";
  return toDateKey(d);
}

function dayRange(baseDate){
  const key = toDateKey(baseDate);
  return { start:key, end:key };
}

function weekRange(baseDate, offsetWeeks = 0){
  const d = new Date(baseDate);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset + offsetWeeks * 7);
  const start = new Date(d);
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  return { start: toDateKey(start), end: toDateKey(end) };
}

function getDateRangeFromFilters(){
  const today = new Date();
  if (filters.dateMode === "yesterday"){
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return dayRange(d);
  }
  if (filters.dateMode === "tomorrow"){
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return dayRange(d);
  }
  if (filters.dateMode === "this_week") return weekRange(today, 0);
  if (filters.dateMode === "next_week") return weekRange(today, 1);

  const picked = parseDateKey(filters.date) || today;
  return dayRange(picked);
}


function getFilteredOrders(){
  const range = getDateRangeFromFilters();

  return WORK_ORDERS
    .filter(order=> !filters.employeeId || (order.employeeId || "no_employee") === filters.employeeId)
    .filter(order=> !filters.account || (order.accountName || "") === filters.account)
    .filter(order=> !filters.site || (order.siteName || "") === filters.site)
    .filter(order=>{
      const d = normalizeOrderDate(order);
      if (!d) return false;
      return d >= range.start && d <= range.end;
    });
}

function buildRows(filteredOrders){
  const map = new Map();

  if (!filters.employeeId){
    for (const employee of EMPLOYEES){
      map.set(employee.id, {
        id: employee.id,
        name: employeeLabel(employee)
      });
    }
  }

  for (const order of filteredOrders){
    const empId = order.employeeId || "no_employee";
    if (!map.has(empId)){
      map.set(empId, {
        id: empId,
        name: order.employeeName || "Sin empleado"
      });
    }
  }

  if (!map.size && filters.employeeId === "no_employee"){
    map.set("no_employee", { id: "no_employee", name: "Sin empleado" });
  }

  return Array.from(map.values()).sort((a,b)=> a.name.localeCompare(b.name));
}

function cardsFor(employeeId, columnKey, filteredOrders){
  return filteredOrders
    .filter(order=> (order.employeeId || "no_employee") === employeeId)
    .filter(order=> statusToColumn(order.status) === columnKey)
    .sort((a,b)=> String(a.orderNumber || "").localeCompare(String(b.orderNumber || "")));
}

function uniqueOrderValues(field){
  return Array.from(new Set(WORK_ORDERS.map(o=> String(o[field] || "").trim()).filter(Boolean))).sort((a,b)=> a.localeCompare(b));
}

function render(){
  const filteredOrders = getFilteredOrders();
  const rows = buildRows(filteredOrders);
  const companies = uniqueOrderValues("accountName");
  const sites = uniqueOrderValues("siteName");
  const c = $("pageContent");
  const activeRange = getDateRangeFromFilters();

  c.innerHTML = `
    <div class="section-title">Tablero OT (Drag & Drop)</div>

    <div class="panel" style="padding:12px;">
      <div class="row" style="gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div class="field">
          <label>Usuario</label>
          <select id="board_filter_employee">
            <option value="">Todos</option>
            <option value="no_employee" ${filters.employeeId==="no_employee"?"selected":""}>Sin empleado</option>
            ${EMPLOYEES.map(emp=>`<option value="${escapeHtml(emp.id)}" ${filters.employeeId===emp.id?"selected":""}>${escapeHtml(employeeLabel(emp))}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Compañía</label>
          <select id="board_filter_company">
            <option value="">Todas</option>
            ${companies.map(name=>`<option value="${escapeHtml(name)}" ${filters.account===name?"selected":""}>${escapeHtml(name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Predio</label>
          <select id="board_filter_site">
            <option value="">Todos</option>
            ${sites.map(name=>`<option value="${escapeHtml(name)}" ${filters.site===name?"selected":""}>${escapeHtml(name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Período</label>
          <select id="board_filter_date_mode">
            <option value="today" ${filters.dateMode==="today"?"selected":""}>Hoy</option>
            <option value="yesterday" ${filters.dateMode==="yesterday"?"selected":""}>Ayer</option>
            <option value="tomorrow" ${filters.dateMode==="tomorrow"?"selected":""}>Mañana</option>
            <option value="this_week" ${filters.dateMode==="this_week"?"selected":""}>Semana actual</option>
            <option value="next_week" ${filters.dateMode==="next_week"?"selected":""}>Próxima semana</option>
            <option value="custom" ${filters.dateMode==="custom"?"selected":""}>Fecha específica</option>
          </select>
        </div>
        <div class="field">
          <label>Fecha</label>
          <input id="board_filter_date" type="date" value="${escapeHtml(filters.date || toDateKey(new Date()))}" ${filters.dateMode==="custom"?"":"disabled"} />
        </div>
        <button class="btn" id="board_clear_filters">Limpiar</button>
      </div>
      <div class="muted small" style="margin-top:8px;">Mostrando OT desde ${escapeHtml(activeRange.start)} hasta ${escapeHtml(activeRange.end)}</div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:12px; overflow:auto;">
      <div class="ot-grid">
        <div class="ot-cell ot-head">Empleados</div>
        ${COLUMNS.map(col=>`<div class="ot-cell ot-head">${col.title}</div>`).join("")}

        ${rows.map(row=>`
          <div class="ot-cell ot-employee">${escapeHtml(row.name)}</div>
          ${COLUMNS.map(col=>`
            <div class="ot-cell ot-drop-zone" data-drop-employee="${escapeHtml(row.id)}" data-drop-column="${col.key}">
              ${cardsFor(row.id, col.key, filteredOrders).map(order=>`
                <div class="ot-card" draggable="true" data-order-id="${escapeHtml(order.id)}" title="Arrastrar para cambiar estado o empleado">
                  OT ${escapeHtml(order.orderNumber || "—")} · ${escapeHtml(order.accountName || "—")} · ${escapeHtml(order.siteName || "—")} · ${escapeHtml(order.status || "—")}
                </div>
              `).join("")}
            </div>
          `).join("")}
        `).join("")}
      </div>
      ${!rows.length ? `<div class="muted" style="margin-top:10px;">No hay órdenes para los filtros seleccionados.</div>` : ""}
    </div>
  `;

  wireFilterEvents();
  wireDnD();
}

function wireFilterEvents(){
  $("board_filter_employee")?.addEventListener("change", ()=>{
    filters.employeeId = $("board_filter_employee").value;
    render();
  });
  $("board_filter_company")?.addEventListener("change", ()=>{
    filters.account = $("board_filter_company").value;
    render();
  });
  $("board_filter_site")?.addEventListener("change", ()=>{
    filters.site = $("board_filter_site").value;
    render();
  });
  $("board_filter_date_mode")?.addEventListener("change", ()=>{
    filters.dateMode = $("board_filter_date_mode").value;
    if (filters.dateMode !== "custom" && !filters.date){
      filters.date = toDateKey(new Date());
    }
    render();
  });
  $("board_filter_date")?.addEventListener("change", ()=>{
    filters.date = $("board_filter_date").value;
    filters.dateMode = "custom";
    render();
  });
  $("board_clear_filters")?.addEventListener("click", ()=>{
    filters = { employeeId:"", account:"", site:"", dateMode:"today", date:toDateKey(new Date()) };
    render();
  });
}

function wireDnD(){
  document.querySelectorAll(".ot-card").forEach(card=>{
    card.addEventListener("dragstart", ()=>{
      draggedOrderId = card.dataset.orderId;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", ()=>{
      card.classList.remove("dragging");
      draggedOrderId = null;
    });
  });

  document.querySelectorAll(".ot-drop-zone").forEach(zone=>{
    zone.addEventListener("dragover", ev=>{
      ev.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", ()=> zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async ev=>{
      ev.preventDefault();
      zone.classList.remove("drag-over");
      if (!draggedOrderId) return;

      const order = WORK_ORDERS.find(w=>w.id === draggedOrderId);
      if (!order) return;

      const employeeId = zone.dataset.dropEmployee;
      const column = zone.dataset.dropColumn;
      const employee = EMPLOYEES.find(e=>e.id === employeeId);
      const nextStatus = columnToStatus(column, order.status);

      try{
        await update("work_orders", order.id, {
          employeeId: employeeId === "no_employee" ? "" : employeeId,
          employeeName: employee ? employeeLabel(employee) : (employeeId === "no_employee" ? "Sin empleado" : order.employeeName || ""),
          status: nextStatus,
          active: nextStatus !== "Cancelada"
        }, auth.currentUser);

        if (order.visitId){
          await update("visits", order.visitId, {
            status: mapOrderStatusToVisitStatus(nextStatus),
            assignedEmployeeId: employeeId === "no_employee" ? "" : employeeId,
            assignedEmployeeName: employee ? employeeLabel(employee) : (employeeId === "no_employee" ? "Sin empleado" : order.employeeName || "")
          }, auth.currentUser);
        }

        await loadData();
        render();
        toast("Orden actualizada desde tablero");
      } catch(err){
        console.error(err);
        toast(err?.message || "No se pudo mover la orden");
      }
    });
  });
}

async function loadData(){
  EMPLOYEES = await list("employees", {
    filters: [{ field:"status", op:"==", value:"active" }],
    order: { field:"lastName", dir:"asc" },
    max: 500
  });

  WORK_ORDERS = await list("work_orders", {
    order: { field:"createdAt", dir:"desc" },
    max: 2000
  });
}

async function init(){
  await requireRole(["admin", "operator", "viewer"]);
  await loadShell({
    activeNav: "work_orders_board",
    primaryText: "Refrescar",
    onPrimary: async ()=>{
      await loadData();
      render();
    }
  });

  filters.date = toDateKey(new Date());
  await loadData();
  render();
}

init();
