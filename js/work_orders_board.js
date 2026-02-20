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

function buildRows(){
  const map = new Map();

  for (const employee of EMPLOYEES){
    map.set(employee.id, {
      id: employee.id,
      name: employeeLabel(employee)
    });
  }

  for (const order of WORK_ORDERS){
    const empId = order.employeeId || "no_employee";
    if (!map.has(empId)){
      map.set(empId, {
        id: empId,
        name: order.employeeName || "Sin empleado"
      });
    }
  }

  return Array.from(map.values()).sort((a,b)=> a.name.localeCompare(b.name));
}

function cardsFor(employeeId, columnKey){
  return WORK_ORDERS
    .filter(order=> (order.employeeId || "no_employee") === employeeId)
    .filter(order=> statusToColumn(order.status) === columnKey)
    .sort((a,b)=> String(a.orderNumber || "").localeCompare(String(b.orderNumber || "")));
}

function render(){
  const rows = buildRows();
  const c = $("pageContent");

  c.innerHTML = `
    <div class="section-title">Tablero OT (Drag & Drop)</div>

    <div class="panel" style="padding:12px; overflow:auto;">
      <div class="ot-grid">
        <div class="ot-cell ot-head">Empleados</div>
        ${COLUMNS.map(col=>`<div class="ot-cell ot-head">${col.title}</div>`).join("")}

        ${rows.map(row=>`
          <div class="ot-cell ot-employee">${escapeHtml(row.name)}</div>
          ${COLUMNS.map(col=>`
            <div class="ot-cell ot-drop-zone" data-drop-employee="${escapeHtml(row.id)}" data-drop-column="${col.key}">
              ${cardsFor(row.id, col.key).map(order=>`
                <div class="ot-card" draggable="true" data-order-id="${escapeHtml(order.id)}" title="Arrastrar para cambiar estado o empleado">
                  OT ${escapeHtml(order.orderNumber || "—")} · ${escapeHtml(order.accountName || "—")} · ${escapeHtml(order.siteName || "—")} · ${escapeHtml(order.status || "—")}
                </div>
              `).join("")}
            </div>
          `).join("")}
        `).join("")}
      </div>
    </div>
  `;

  wireDnD();
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
    zone.addEventListener("dragover", ev=> ev.preventDefault());
    zone.addEventListener("drop", async ev=>{
      ev.preventDefault();
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

  await loadData();
  render();
}

init();
