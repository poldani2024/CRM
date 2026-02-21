import { loadShell } from "./ui_shell.js";
import { requireRole, TENANT_ID } from "./auth.js";
import { auth, db } from "./firebase.js";
import { list, update } from "./data_access.js";
import { escapeHtml, $, toast } from "./utils.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const COLUMNS = [
  { key: "todo", title: "A Realizar" },
  { key: "doing", title: "Realizando" },
  { key: "done", title: "Realizado" }
];

let WORK_ORDERS = [];
let EMPLOYEES = [];
let SITES = [];
let draggedOrderId = null;
let justDragged = false;
let COMPANY_NAME = "Mi Empresa";
let COMPANY_LOGO = "";
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

function siteInfoForOrder(order){
  const byId = SITES.find(site=> site.id && order.siteId && site.id === order.siteId);
  const byName = SITES.find(site=> (site.name || "") === (order.siteName || ""));
  const site = byId || byName || null;
  const siteName = site?.name || order.siteName || "—";
  const serviceAddress = [site?.address || "", site?.city || ""].filter(Boolean).join(" · ") || "—";
  return { siteName, serviceAddress };
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



function openOrderModal(orderId){
  const order = WORK_ORDERS.find(o=>o.id === orderId);
  if (!order) return;

  const employee = orderEmployeeNames(order);
  const siteInfo = siteInfoForOrder(order);

  $("woModalTitle").textContent = `Orden de Trabajo ${order.orderNumber || ""}`;
  $("wo_m_number").textContent = order.orderNumber || "—";
  $("wo_m_generated").textContent = toDateKey(new Date());
  $("wo_m_visit").textContent = normalizeOrderDate(order) || "—";
  $("wo_m_employee").textContent = employee;
  $("wo_m_company").textContent = order.accountName || "—";
  $("wo_m_schedule").textContent = order.schedule || "—";
  $("wo_m_siteName").textContent = siteInfo.siteName;
  $("wo_m_site").textContent = siteInfo.serviceAddress;
  $("wo_m_status").textContent = order.status || "—";
  $("wo_m_obs").textContent = order.observations || "—";

  const pdfBtn = $("btnGenerateOrderPdf");
  pdfBtn.onclick = ()=> generateOrderPdf(order, employee, siteInfo);

  $("woModalBackdrop").style.display = "flex";
}

function closeOrderModal(){
  $("woModalBackdrop").style.display = "none";
}

function generateOrderPdf(order, employee, siteInfo){
  const generated = toDateKey(new Date());
  const visitDate = normalizeOrderDate(order) || "—";
  const logoBlock = COMPANY_LOGO ? `<div style="text-align:center;margin-bottom:4mm;"><img src="${COMPANY_LOGO}" alt="logo" style="max-height:24mm; max-width:70mm; object-fit:contain;"></div>` : "";
  const html = `
    <html>
      <head>
        <title>Orden de Trabajo ${order.orderNumber || ""}</title>
        <style>
          @page { size: A4; margin: 8mm; }
          body { font-family: Arial, sans-serif; margin:0; }
          .sheet { width: 100%; min-height: 148mm; border: 1px solid #222; padding: 10mm; box-sizing:border-box; }
          .head { text-align:center; margin-bottom: 8mm; }
          .company { font-size: 20px; font-weight: 800; }
          .title { font-size: 18px; font-weight: 700; margin-top: 2mm; }
          .row { margin: 3mm 0; font-size: 14px; }
          .label { font-weight: 700; }
          .obs { margin-top: 8mm; border: 1px solid #333; min-height: 70mm; padding: 4mm; white-space: pre-wrap; }
        </style>
      </head>
      <body>
        <div class="sheet">
          ${logoBlock}<div class="head">
            <div class="company">${COMPANY_NAME}</div>
            <div class="title">Orden de Trabajo</div>
          </div>
          <div class="row"><span class="label">Número:</span> ${order.orderNumber || "—"}</div>
          <div class="row"><span class="label">Fecha de generación:</span> ${generated}</div>
          <div class="row"><span class="label">Empleados asignados:</span> ${employee}</div>
          <div class="row"><span class="label">Horario:</span> ${order.schedule || "—"}</div>
          <div class="row"><span class="label">Empresa:</span> ${order.accountName || "—"}</div>
          <div class="row"><span class="label">Predio:</span> ${siteInfo.siteName}</div>
          <div class="row"><span class="label">Domicilio servicio:</span> ${siteInfo.serviceAddress}</div>
          <div class="row"><span class="label">Fecha de realización:</span> ${visitDate}</div>
          <div class="row"><span class="label">Estado:</span> ${order.status || "—"}</div>
          <div class="obs"><span class="label">Observaciones:</span><br>${escapeHtml(order.observations || "")}</div>
        </div>
      </body>
    </html>
  `;

  const win = window.open("", "_blank");
  if (!win) return toast("No se pudo abrir ventana para PDF");
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

function getFilteredOrders(){
  const range = getDateRangeFromFilters();

  return WORK_ORDERS
    .filter(order=> {
      if (!filters.employeeId) return true;
      const refs = orderEmployeeRefs(order);
      if (!refs.length) return filters.employeeId === "no_employee";
      return refs.some(ref=> ref.id === filters.employeeId);
    })
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
    const refs = orderEmployeeRefs(order);
    if (!refs.length){
      const noEmpId = "no_employee";
      if (!map.has(noEmpId)){
        map.set(noEmpId, { id: noEmpId, name: "Sin empleado" });
      }
      continue;
    }

    for (const ref of refs){
      if (!map.has(ref.id)){
        map.set(ref.id, { id: ref.id, name: ref.name });
      }
    }
  }

  if (!map.size && filters.employeeId === "no_employee"){
    map.set("no_employee", { id: "no_employee", name: "Sin empleado" });
  }

  return Array.from(map.values()).sort((a,b)=> a.name.localeCompare(b.name));
}

function cardsFor(employeeId, columnKey, filteredOrders){
  return filteredOrders
    .filter(order=> {
      const refs = orderEmployeeRefs(order);
      if (!refs.length) return employeeId === "no_employee";
      return refs.some(ref=> ref.id === employeeId);
    })
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
                <div class="ot-card" draggable="true" data-order-id="${escapeHtml(order.id)}" data-open-order="${escapeHtml(order.id)}" title="Click para ver detalle · Arrastrar para mover">
                  OT ${escapeHtml(order.orderNumber || "—")} · ${escapeHtml(order.accountName || "—")} · ${escapeHtml(order.siteName || "—")} · ${escapeHtml(order.status || "—")}
                </div>
              `).join("")}
            </div>
          `).join("")}
        `).join("")}
      </div>
      ${!rows.length ? `<div class="muted" style="margin-top:10px;">No hay órdenes para los filtros seleccionados.</div>` : ""}
    </div>

    <div class="modal-backdrop" id="woModalBackdrop">
      <div class="modal" style="max-width:760px;">
        <div class="modal-head">
          <div class="modal-title" id="woModalTitle">Orden de Trabajo</div>
          <button class="btn btn-ghost" id="btnCloseWoModal">✕</button>
        </div>
        <div class="spacer"></div>
        <div class="grid2">
          <div class="field"><label>Número</label><div id="wo_m_number" class="muted">—</div></div>
          <div class="field"><label>Fecha generación</label><div id="wo_m_generated" class="muted">—</div></div>
          <div class="field"><label>Fecha realización</label><div id="wo_m_visit" class="muted">—</div></div>
          <div class="field"><label>Empleados</label><div id="wo_m_employee" class="muted">—</div></div>
          <div class="field"><label>Horario</label><div id="wo_m_schedule" class="muted">—</div></div>
          <div class="field"><label>Empresa</label><div id="wo_m_company" class="muted">—</div></div>
          <div class="field"><label>Predio</label><div id="wo_m_siteName" class="muted">—</div></div>
          <div class="field"><label>Domicilio servicio</label><div id="wo_m_site" class="muted">—</div></div>
          <div class="field"><label>Estado</label><div id="wo_m_status" class="muted">—</div></div>
          <div class="field" style="grid-column:1/-1;"><label>Observaciones</label><div id="wo_m_obs" class="muted" style="white-space:pre-wrap; min-height:120px; border:1px solid var(--line); border-radius:8px; padding:8px;">—</div></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="btnCloseWoModal2">Cerrar</button>
          <button class="btn btn-primary" id="btnGenerateOrderPdf">Generar PDF</button>
        </div>
      </div>
    </div>
  `;

  wireFilterEvents();
  wireDnD();

  $("btnCloseWoModal")?.addEventListener("click", closeOrderModal);
  $("btnCloseWoModal2")?.addEventListener("click", closeOrderModal);
  c.querySelectorAll("[data-open-order]").forEach(card=>{
    card.addEventListener("click", ()=>{
      if (justDragged) return;
      openOrderModal(card.dataset.openOrder);
    });
  });
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
      justDragged = true;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", ()=>{
      card.classList.remove("dragging");
      draggedOrderId = null;
      window.setTimeout(()=>{ justDragged = false; }, 60);
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
        const nextEmployeeId = employeeId === "no_employee" ? "" : employeeId;
        const nextEmployeeName = employee ? employeeLabel(employee) : (employeeId === "no_employee" ? "Sin empleado" : order.employeeName || "");
        await update("work_orders", order.id, {
          employeeId: nextEmployeeId,
          employeeName: nextEmployeeName,
          employeeIds: nextEmployeeId ? [nextEmployeeId] : [],
          employeeNames: nextEmployeeId ? [nextEmployeeName] : [],
          assignedEmployees: nextEmployeeId ? [{ id: nextEmployeeId, name: nextEmployeeName }] : [],
          status: nextStatus,
          active: nextStatus !== "Cancelada"
        }, auth.currentUser);

        if (order.visitId){
          await update("visits", order.visitId, {
            status: mapOrderStatusToVisitStatus(nextStatus),
            assignedEmployeeId: nextEmployeeId,
            assignedEmployeeName: nextEmployeeName,
            assignedEmployeeIds: nextEmployeeId ? [nextEmployeeId] : [],
            assignedEmployeeNames: nextEmployeeId ? [nextEmployeeName] : []
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

  SITES = await list("sites", {
    order: { field:"name", dir:"asc" },
    max: 2000
  });

  WORK_ORDERS = await list("work_orders", {
    order: { field:"createdAt", dir:"desc" },
    max: 2000
  });
}


async function loadSettings(){
  try{
    const ref = doc(db, "tenants", TENANT_ID, "settings", "main");
    const snap = await getDoc(ref);
    if (snap.exists()){
      const data = snap.data();
      COMPANY_NAME = data?.companyName || COMPANY_NAME;
      COMPANY_LOGO = data?.logoPath || "";
    }
  } catch(err){
    console.warn("No se pudo cargar settings/main", err);
  }
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
  await loadSettings();
  await loadData();
  render();
}

init();
