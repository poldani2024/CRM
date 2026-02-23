import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, update } from "./data_access.js";
import { createWorkOrder } from "./work_orders_service.js";
import { escapeHtml, $, toast } from "./utils.js";

const ORDER_STATUSES = ["Confirmada", "En ejecución", "Postergada", "Concretada", "No realizada", "Cancelada"];

const KANBAN_COLUMNS = [
  { key: "todo", title: "A Realizar" },
  { key: "doing", title: "Realizando" },
  { key: "done", title: "Realizado" }
];

let ACCOUNTS = [];
let SITES = [];
let EMPLOYEES = [];
let VISITS = [];
let WORK_ORDERS = [];
let selectedVisitId = "";
let kanbanViewMode = "employee";

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

function orderEmployeeRefs(order){
  if (Array.isArray(order?.assignedEmployees) && order.assignedEmployees.length){
    return order.assignedEmployees
      .map(emp=> ({ id: String(emp?.id || "").trim(), name: String(emp?.name || "").trim() }))
      .filter(emp=> emp.id)
      .map(emp=> ({ ...emp, name: emp.name || "Sin empleado" }));
  }

  if (Array.isArray(order?.employeeIds) && order.employeeIds.length){
    return order.employeeIds
      .map((id, idx)=> ({ id: String(id || "").trim(), name: String(order?.employeeNames?.[idx] || "").trim() }))
      .filter(emp=> emp.id)
      .map(emp=> ({ ...emp, name: emp.name || "Sin empleado" }));
  }

  if (order?.employeeId){
    return [{ id: order.employeeId, name: order.employeeName || "Sin empleado" }];
  }

  return [];
}

function orderEmployeeNames(order){
  const refs = orderEmployeeRefs(order);
  if (!refs.length) return "Sin empleado";
  return refs.map(ref=> ref.name).join(" · ");
}

function selectedEmployeeIdsFrom(containerSelector){
  return Array.from(document.querySelectorAll(`${containerSelector} input[type='checkbox']:checked`))
    .map(input=> String(input.value || ""))
    .filter(Boolean);
}

function renderEmployeeChecklist(id){
  return `
    <div id="${id}" class="employee-checklist">
      ${EMPLOYEES.map(emp=>`
        <label class="employee-check-item">
          <input type="checkbox" value="${escapeHtml(emp.id)}" />
          <span>${escapeHtml(employeeLabel(emp))}</span>
        </label>
      `).join("")}
    </div>
  `;
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

function kanbanColumnForStatus(status){
  if (["Confirmada", "No realizada"].includes(status)) return "todo";
  if (status === "En ejecución") return "doing";
  if (["Concretada", "Cancelada"].includes(status)) return "done";
  return null;
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

function buildKanbanBuckets(){
  const buckets = { todo: [], doing: [], done: [] };

  if (kanbanViewMode === "employee"){
    for (const order of WORK_ORDERS){
      const col = kanbanColumnForStatus(order.status);
      if (!col) continue;
      const refs = orderEmployeeRefs(order);
      if (!refs.length){
        const key = `no_emp_${order.id}`;
        let card = buckets[col].find(c=>c.key === key);
        if (!card){
          card = { key, title: "Sin empleado", subtitle: "", lines: [] };
          buckets[col].push(card);
        }
        card.lines.push(`OT ${order.orderNumber || "—"} · ${order.accountName || "—"} · ${order.siteName || "—"} · ${order.status || "—"}`);
        continue;
      }
      for (const ref of refs){
        const key = ref.id;
        let card = buckets[col].find(c=>c.key === key);
        if (!card){
          card = { key, title: ref.name, subtitle: "", lines: [] };
          buckets[col].push(card);
        }
        card.lines.push(`OT ${order.orderNumber || "—"} · ${order.accountName || "—"} · ${order.siteName || "—"} · ${order.status || "—"}`);
      }
    }
  } else {
    for (const order of WORK_ORDERS){
      const col = kanbanColumnForStatus(order.status);
      if (!col) continue;
      const key = `${order.accountId || order.accountName || "acc"}|${order.siteId || order.siteName || "site"}|${orderEmployeeNames(order) || "no_emp"}`;
      const title = `${order.accountName || "Sin empresa"} · ${order.siteName || "Sin predio"}`;
      const subtitle = `Empleado: ${orderEmployeeNames(order)}`;
      let card = buckets[col].find(c=>c.key === key);
      if (!card){
        card = { key, title, subtitle, lines: [] };
        buckets[col].push(card);
      }
      card.lines.push(`OT ${order.orderNumber || "—"} · ${order.status || "—"} · ${order.visitDate || "—"}`);
    }
  }

  for (const col of Object.keys(buckets)){
    buckets[col].sort((a,b)=> a.title.localeCompare(b.title));
  }

  return buckets;
}

function renderKanban(){
  const buckets = buildKanbanBuckets();
  return `
    <div class="panel" style="padding:14px;">
      <div class="row" style="justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div>
          <div style="font-weight:700;">Tablero Kanban de órdenes</div>
          <div class="muted small">Vista por empleado o por empresa/predio (separando por empleado cuando corresponda).</div>
        </div>
        <div class="field" style="min-width:260px;">
          <label>Ver por</label>
          <select id="kanban_view_mode">
            <option value="employee" ${kanbanViewMode === "employee" ? "selected" : ""}>Empleado</option>
            <option value="site" ${kanbanViewMode === "site" ? "selected" : ""}>Empresa y Predio</option>
          </select>
        </div>
      </div>

      <div class="spacer"></div>

      <div class="board" style="grid-template-columns:repeat(3, minmax(260px, 1fr));">
        ${KANBAN_COLUMNS.map(col=>`
          <section class="col">
            <div class="col-head">
              <div class="col-title">${col.title}</div>
              <div class="badge">${buckets[col.key].length}</div>
            </div>
            <div class="cards">
              ${buckets[col.key].length ? buckets[col.key].map(card=>`
                <article class="card">
                  <div class="card-title">${escapeHtml(card.title)}</div>
                  ${card.subtitle ? `<div class="card-sub muted small">${escapeHtml(card.subtitle)}</div>` : ""}
                  <div class="card-sub muted small">${card.lines.map(line=>escapeHtml(line)).join("<br>")}</div>
                </article>
              `).join("") : `<div class="muted small">Sin órdenes en esta columna.</div>`}
            </div>
          </section>
        `).join("")}
      </div>
    </div>
  `;
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
        <div class="field" style="min-width:280px;">
          <label>Empleados asignados</label>
          ${renderEmployeeChecklist("wo_employees")}
        </div>
        <div class="field">
          <label>Horario</label>
          <input id="wo_schedule" type="time" />
        </div>
        <div class="field" style="min-width:300px; flex:1;">
          <label>Observaciones</label>
          <input id="wo_observations" placeholder="Notas de la orden..." />
        </div>
        <button class="btn btn-primary" id="btnCreateWorkOrder">Generar orden</button>
      </div>
    </div>

    <div class="spacer"></div>

    ${renderKanban()}

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
              <div class="card-sub muted small">Empleados: ${escapeHtml(orderEmployeeNames(order))}</div>
              <div class="card-sub muted small">Horario: ${escapeHtml(order.schedule || "—")}</div>
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

  $("kanban_view_mode")?.addEventListener("change", ()=>{
    kanbanViewMode = $("kanban_view_mode").value || "employee";
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
  const employeeIds = selectedEmployeeIdsFrom("#wo_employees");
  if (!employeeIds.length) return toast("Seleccioná al menos un empleado");

  const visit = VISITS.find(v=>v.id === selectedVisitId);
  if (!visit) return toast("No se encontró la visita seleccionada");

  const account = ACCOUNTS.find(a=>a.id === visit.accountId);
  const site = SITES.find(s=>s.id === visit.siteId);
  const employees = employeeIds
    .map(id=> EMPLOYEES.find(e=>e.id === id))
    .filter(Boolean);

  try{
    const created = await createWorkOrder({
      visit: { ...visit, plannedDate: parseVisitDate(visit) },
      visitId: visit.id,
      account,
      site,
      employees,
      schedule: $("wo_schedule").value,
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
  const activeAccountIds = new Set(ACCOUNTS.map(a=>a.id));
  SITES = SITES.filter(site=> activeAccountIds.has(site.accountId));
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
