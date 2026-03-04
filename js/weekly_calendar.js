import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, update } from "./data_access.js";
import { escapeHtml, $, toast } from "./utils.js";

const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const HOUR_START = 6;
const HOUR_END = 21;

let EMPLOYEES = [];
let WORK_ORDERS = [];
let SITES = [];
let selectedDate = new Date();
let selectedEmployeeId = "all";
let dragOrderId = "";

function employeeLabel(emp){
  return `${emp.lastName || ""}${emp.lastName && emp.firstName ? ", " : ""}${emp.firstName || ""}`.trim() || "Sin nombre";
}

function toDateKey(value){
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value?.toDate) return value.toDate().toISOString().slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseScheduleToMinutes(raw){
  const value = String(raw || "").trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return Number.POSITIVE_INFINITY;
  return hh * 60 + mm;
}

function scheduleMinutesPart(raw){
  const value = String(raw || "").trim();
  const match = value.match(/^\d{1,2}:(\d{2})$/);
  return match ? match[1] : "00";
}

function mondayOfWeek(baseDate){
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(base, days){
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(date){
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toShortDate(date){
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function weekLabel(startDate, endDate){
  const monthText = startDate.toLocaleDateString("es-AR", { month: "long" });
  const sameMonth = startDate.getMonth() === endDate.getMonth();
  const sameYear = startDate.getFullYear() === endDate.getFullYear();

  if (sameMonth && sameYear){
    return `${startDate.getFullYear()} · ${monthText} ${String(startDate.getDate()).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  }

  const startText = `${startDate.toLocaleDateString("es-AR", { month: "short" })} ${String(startDate.getDate()).padStart(2, "0")}`;
  const endText = `${endDate.toLocaleDateString("es-AR", { month: "short" })} ${String(endDate.getDate()).padStart(2, "0")}`;
  return `${startDate.getFullYear()} · ${startText} - ${endText}`;
}

function orderEmployeeIds(order){
  if (Array.isArray(order?.assignedEmployees) && order.assignedEmployees.length){
    return order.assignedEmployees.map(emp=> String(emp?.id || "").trim()).filter(Boolean);
  }
  if (Array.isArray(order?.employeeIds) && order.employeeIds.length){
    return order.employeeIds.map(id=> String(id || "").trim()).filter(Boolean);
  }
  if (order?.employeeId) return [String(order.employeeId).trim()];
  return [];
}

function resolveSite(order){
  if (!order.siteId) return null;
  return SITES.find(site=> site.id === order.siteId) || null;
}

function statusClass(status){
  if (status === "Confirmada") return "is-confirmed";
  if (status === "En ejecución") return "is-in-progress";
  if (status === "Postergada") return "is-postponed";
  if (status === "Concretada") return "is-completed";
  if (status === "No realizada") return "is-missed";
  if (status === "Cancelada") return "is-cancelled";
  return "is-estimated";
}

function orderItemsInWeek(){
  const weekStart = mondayOfWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, idx)=> addDays(weekStart, idx));
  const dayKeys = new Set(days.map(dateKey));

  const filtered = WORK_ORDERS
    .filter(order=> order.active !== false)
    .map(order=> ({ ...order, visitDateKey: toDateKey(order.visitDate) }))
    .filter(order=> order.visitDateKey && dayKeys.has(order.visitDateKey))
    .filter(order=> {
      if (selectedEmployeeId === "all") return true;
      const employeeIds = orderEmployeeIds(order);
      return employeeIds.includes(selectedEmployeeId);
    })
    .sort((a, b)=> {
      const byDate = a.visitDateKey.localeCompare(b.visitDateKey);
      if (byDate !== 0) return byDate;
      const bySchedule = parseScheduleToMinutes(a.schedule) - parseScheduleToMinutes(b.schedule);
      if (bySchedule !== 0) return bySchedule;
      return String(a.accountName || "").localeCompare(String(b.accountName || ""));
    });

  return filtered.map(order=> {
    const site = resolveSite(order);
    const scheduleMinutes = parseScheduleToMinutes(order.schedule);
    return {
      ...order,
      taskStatusClass: statusClass(order.status),
      hourSlot: Number.isFinite(scheduleMinutes)
        ? Math.max(HOUR_START, Math.min(HOUR_END, Math.floor(scheduleMinutes / 60)))
        : HOUR_START,
      siteAddress: site?.address || "Sin domicilio",
      siteCity: site?.city || "Sin localidad"
    };
  });
}

function render(){
  const c = $("pageContent");
  const weekStart = mondayOfWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, idx)=> addDays(weekStart, idx));
  const weekEnd = days[6];
  const orders = orderItemsInWeek();

  const byDayHour = new Map();
  for (const order of orders){
    const key = `${order.visitDateKey}|${order.hourSlot}`;
    if (!byDayHour.has(key)) byDayHour.set(key, []);
    byDayHour.get(key).push(order);
  }

  c.innerHTML = `
    <div class="section-title">Calendario semanal</div>

    <div class="panel weekly-calendar-panel">
      <div class="weekly-calendar-toolbar">
        <div class="row" style="gap:8px; flex-wrap:wrap;">
          <button class="btn" id="btnWeekPrev">◀</button>
          <button class="btn" id="btnWeekToday">Hoy</button>
          <button class="btn" id="btnWeekNext">▶</button>
          <div class="weekly-calendar-range">${escapeHtml(weekLabel(weekStart, weekEnd))}</div>
        </div>

        <div class="row" style="gap:10px; flex-wrap:wrap;">
          <div class="field">
            <label>Fecha de referencia</label>
            <input id="weekDate" type="date" value="${dateKey(selectedDate)}" />
          </div>
          <div class="field" style="min-width:240px;">
            <label>Empleado</label>
            <select id="employeeFilter">
              <option value="all">Todos los empleados</option>
              ${EMPLOYEES.map(emp=>`
                <option value="${escapeHtml(emp.id)}" ${selectedEmployeeId === emp.id ? "selected" : ""}>${escapeHtml(employeeLabel(emp))}</option>
              `).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="weekly-calendar-grid-wrap">
        <div class="weekly-calendar-grid">
          <div class="weekly-cell weekly-cell-corner"></div>
          ${days.map((day, idx)=>`
            <div class="weekly-cell weekly-day-header">
              <div class="weekly-day-number">${String(day.getDate()).padStart(2, "0")}</div>
              <div class="muted">${DAY_NAMES[idx]} · ${toShortDate(day)}</div>
            </div>
          `).join("")}

          ${Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, hourOffset)=> {
            const hour = HOUR_START + hourOffset;
            return `
              <div class="weekly-cell weekly-hour-label">${String(hour).padStart(2, "0")}:00</div>
              ${days.map(day=> {
                const dayKey = dateKey(day);
                const key = `${dayKey}|${hour}`;
                const cellOrders = byDayHour.get(key) || [];
                return `
                  <div class="weekly-cell weekly-slot" data-drop-date="${dayKey}" data-drop-hour="${hour}">
                    ${cellOrders.map(order=>`
                      <article class="weekly-task-card ${escapeHtml(order.taskStatusClass)}" draggable="true" data-order-id="${escapeHtml(order.id)}">
                        <div class="weekly-task-time">${escapeHtml(order.schedule || "Sin horario")}</div>
                        <div class="weekly-task-title">${escapeHtml(order.accountName || "Sin empresa")}</div>
                        <div class="weekly-task-meta">${escapeHtml(order.siteAddress)}</div>
                        <div class="weekly-task-meta">${escapeHtml(order.siteCity)}</div>
                      </article>
                    `).join("")}
                  </div>
                `;
              }).join("")}
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;

  $("weekDate").addEventListener("change", ()=>{
    const value = $("weekDate").value;
    if (!value) return;
    selectedDate = new Date(`${value}T00:00:00`);
    render();
  });

  $("employeeFilter").addEventListener("change", ()=>{
    selectedEmployeeId = $("employeeFilter").value || "all";
    render();
  });

  $("btnWeekToday").addEventListener("click", ()=>{
    selectedDate = new Date();
    render();
  });

  $("btnWeekPrev").addEventListener("click", ()=>{
    selectedDate = addDays(mondayOfWeek(selectedDate), -7);
    render();
  });

  $("btnWeekNext").addEventListener("click", ()=>{
    selectedDate = addDays(mondayOfWeek(selectedDate), 7);
    render();
  });

  wireDragAndDrop();
}

function wireDragAndDrop(){
  document.querySelectorAll(".weekly-task-card").forEach(card=>{
    card.addEventListener("dragstart", ev=>{
      dragOrderId = String(card.dataset.orderId || "");
      card.classList.add("dragging");
      ev.dataTransfer?.setData("text/plain", dragOrderId);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
    });

    card.addEventListener("dragend", ()=>{
      card.classList.remove("dragging");
      dragOrderId = "";
      document.querySelectorAll(".weekly-slot.drop-hover").forEach(el=> el.classList.remove("drop-hover"));
    });
  });

  document.querySelectorAll(".weekly-slot").forEach(slot=>{
    slot.addEventListener("dragover", ev=>{
      ev.preventDefault();
      slot.classList.add("drop-hover");
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    });

    slot.addEventListener("dragleave", ()=> slot.classList.remove("drop-hover"));

    slot.addEventListener("drop", async ev=>{
      ev.preventDefault();
      slot.classList.remove("drop-hover");
      const orderId = ev.dataTransfer?.getData("text/plain") || dragOrderId;
      if (!orderId) return;

      const newDate = String(slot.dataset.dropDate || "");
      const newHour = Number(slot.dataset.dropHour || "");
      if (!newDate || !Number.isFinite(newHour)) return;

      const order = WORK_ORDERS.find(item=> item.id === orderId);
      if (!order) return;

      const minutes = scheduleMinutesPart(order.schedule);
      const newSchedule = `${String(newHour).padStart(2, "0")}:${minutes}`;
      const sameDate = toDateKey(order.visitDate) === newDate;
      const sameTime = String(order.schedule || "") === newSchedule;
      if (sameDate && sameTime) return;

      try{
        await update("work_orders", orderId, {
          visitDate: newDate,
          schedule: newSchedule
        }, auth.currentUser);

        WORK_ORDERS = WORK_ORDERS.map(item=> item.id === orderId
          ? { ...item, visitDate: newDate, schedule: newSchedule }
          : item);

        render();
        toast("Horario de OT actualizado");
      } catch (err){
        console.error(err);
        toast("No se pudo mover la OT");
      }
    });
  });
}

async function loadData(){
  EMPLOYEES = await list("employees", {
    filters: [{ field: "status", op: "==", value: "active" }],
    order: { field: "lastName", dir: "asc" },
    max: 500
  });

  WORK_ORDERS = await list("work_orders", {
    order: { field: "visitDate", dir: "asc" },
    max: 1500
  });

  SITES = await list("sites", {
    order: { field: "name", dir: "asc" },
    max: 2000
  });
}

async function init(){
  const profile = await requireRole(["admin", "operator", "viewer"]);
  if (!profile) return;

  await loadShell({
    activeNav: "weekly_calendar",
    primaryText: "Actualizar",
    onPrimary: async ()=>{
      try{
        await loadData();
        render();
        toast("Calendario actualizado");
      } catch (err){
        console.error(err);
        toast("No se pudo actualizar el calendario");
      }
    }
  });

  await loadData();
  render();
}

init();
