import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create, update } from "./data_access.js";
import { escapeHtml, $, toast, normalizeInputDateToKey, keyToDisplayDate } from "./utils.js";

const EMPLOYEE_ROLES = ["Gerente", "Supervisor", "Administrativo", "Operario", "Otro"];
const WORKING_DAY_OPTIONS = [
  { value: "monday_friday", label: "Lunes a Viernes" },
  { value: "monday_saturday", label: "Lunes a Sábados" }
];
const AVAILABILITY_OPTIONS = ["Activo", "Vacaciones", "Enfermedad", "Licencia"];

let EMPLOYEES = [];
let editEmployeeId = null;

function toDateLabel(raw){
  if (!raw) return "—";
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR");
}

function formatWorkingDays(value){
  return WORKING_DAY_OPTIONS.find(opt=>opt.value === value)?.label || "—";
}

function openCreateModal(){
  editEmployeeId = null;
  $("modalTitle").textContent = "Nuevo empleado";
  $("btnSave").textContent = "Guardar";

  $("e_firstName").value = "";
  $("e_lastName").value = "";
  $("e_address").value = "";
  $("e_phone").value = "";
  $("e_dni").value = "";
  $("e_birthDate").value = "";
  $("e_workingDays").value = "monday_friday";
  $("e_workStart").value = "08:00";
  $("e_workEnd").value = "18:00";
  $("e_hireDate").value = "";
  $("e_terminationDate").value = "";
  $("e_role").value = EMPLOYEE_ROLES[0];
  $("e_comments").value = "";
  $("e_availability").value = "Activo";
  $("e_availabilityFrom").value = "";
  $("e_availabilityTo").value = "";

  $("modalBackdrop").style.display = "flex";
}

function openEditModal(employeeId){
  const employee = EMPLOYEES.find(e=>e.id === employeeId);
  if (!employee) return toast("No se encontró el empleado");

  editEmployeeId = employee.id;
  $("modalTitle").textContent = "Editar empleado";
  $("btnSave").textContent = "Guardar cambios";

  $("e_firstName").value = employee.firstName || "";
  $("e_lastName").value = employee.lastName || "";
  $("e_address").value = employee.address || "";
  $("e_phone").value = employee.phone || "";
  $("e_dni").value = employee.dni || "";
  $("e_birthDate").value = keyToDisplayDate(employee.birthDate || "");
  $("e_workingDays").value = employee.workingDays || "monday_friday";
  $("e_workStart").value = employee.workStart || "08:00";
  $("e_workEnd").value = employee.workEnd || "18:00";
  $("e_hireDate").value = keyToDisplayDate(employee.hireDate || "");
  $("e_terminationDate").value = keyToDisplayDate(employee.terminationDate || "");
  $("e_role").value = employee.employeeRole || EMPLOYEE_ROLES[0];
  $("e_comments").value = employee.comments || "";
  $("e_availability").value = employee.availabilityStatus || "Activo";
  $("e_availabilityFrom").value = keyToDisplayDate(employee.availabilityFrom || "");
  $("e_availabilityTo").value = keyToDisplayDate(employee.availabilityTo || "");

  $("modalBackdrop").style.display = "flex";
}

function closeModal(){
  $("modalBackdrop").style.display = "none";
}

function render(){
  const c = $("pageContent");
  c.innerHTML = `
    <div class="section-title">Empleados</div>

    <div class="panel" style="padding:14px;">
      <div class="row" style="justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div class="muted">Total: ${EMPLOYEES.length}</div>
        <button class="btn btn-primary" id="btnNew">+ Nuevo empleado</button>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      ${EMPLOYEES.length ? EMPLOYEES.map(employee=>`
        <div class="card" style="margin-bottom:10px;">
          <div class="row" style="justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
            <div>
              <div class="card-title">${escapeHtml(`${employee.lastName || ""}${employee.lastName && employee.firstName ? ", " : ""}${employee.firstName || ""}` || "—")}</div>
              <div class="card-sub muted small">
                DNI: ${escapeHtml(employee.dni || "—")}
                ${employee.phone ? ` · Tel: ${escapeHtml(employee.phone)}` : ""}
                ${employee.employeeRole ? ` · Rol: ${escapeHtml(employee.employeeRole)}` : ""}
              </div>
              <div class="card-sub muted small">
                Jornada: ${escapeHtml(formatWorkingDays(employee.workingDays))} · ${escapeHtml(employee.workStart || "08:00")} a ${escapeHtml(employee.workEnd || "18:00")}
              </div>
              <div class="card-sub muted small">
                Estado: ${escapeHtml(employee.availabilityStatus || "Activo")}
                ${(employee.availabilityFrom || employee.availabilityTo) ? ` (${escapeHtml(toDateLabel(employee.availabilityFrom))} a ${escapeHtml(toDateLabel(employee.availabilityTo))})` : ""}
              </div>
            </div>
            <div class="row" style="gap:8px;">
              <button class="btn" data-edit-employee="${escapeHtml(employee.id)}">Editar</button>
            </div>
          </div>
        </div>
      `).join("") : `<div class="muted">Sin empleados.</div>`}
    </div>

    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal" style="max-width:820px;">
        <div class="modal-head">
          <div class="modal-title" id="modalTitle">Nuevo empleado</div>
          <button class="btn btn-ghost" id="btnCloseModal">✕</button>
        </div>

        <div class="spacer"></div>

        <div class="grid2">
          <div class="field">
            <label>Nombre</label>
            <input id="e_firstName" />
          </div>
          <div class="field">
            <label>Apellido</label>
            <input id="e_lastName" />
          </div>

          <div class="field" style="grid-column:1/-1;">
            <label>Domicilio</label>
            <input id="e_address" />
          </div>

          <div class="field">
            <label>Teléfono</label>
            <input id="e_phone" />
          </div>
          <div class="field">
            <label>DNI</label>
            <input id="e_dni" />
          </div>

          <div class="field">
            <label>Fecha de nacimiento</label>
            <input id="e_birthDate" placeholder="DD/MM/YYYY" inputmode="numeric" />
          </div>
          <div class="field">
            <label>Rol</label>
            <select id="e_role">
              ${EMPLOYEE_ROLES.map(role=>`<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`).join("")}
            </select>
          </div>

          <div class="field">
            <label>Días laborales</label>
            <select id="e_workingDays">
              ${WORKING_DAY_OPTIONS.map(option=>`<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Horario</label>
            <div class="row" style="gap:8px; align-items:center;">
              <input id="e_workStart" type="time" value="08:00" style="max-width:150px;" />
              <span class="muted small">a</span>
              <input id="e_workEnd" type="time" value="18:00" style="max-width:150px;" />
            </div>
          </div>

          <div class="field">
            <label>Fecha ingreso</label>
            <input id="e_hireDate" placeholder="DD/MM/YYYY" inputmode="numeric" />
          </div>
          <div class="field">
            <label>Fecha egreso</label>
            <input id="e_terminationDate" placeholder="DD/MM/YYYY" inputmode="numeric" />
          </div>

          <div class="field">
            <label>Estado</label>
            <select id="e_availability">
              ${AVAILABILITY_OPTIONS.map(status=>`<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Estado desde / hasta</label>
            <div class="row" style="gap:8px; align-items:center;">
              <input id="e_availabilityFrom" placeholder="DD/MM/YYYY" inputmode="numeric" style="max-width:180px;" />
              <span class="muted small">a</span>
              <input id="e_availabilityTo" placeholder="DD/MM/YYYY" inputmode="numeric" style="max-width:180px;" />
            </div>
          </div>

          <div class="field" style="grid-column:1/-1;">
            <label>Comentarios</label>
            <textarea id="e_comments"></textarea>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn" id="btnCancel">Cancelar</button>
          <button class="btn btn-primary" id="btnSave">Guardar</button>
        </div>
      </div>
    </div>
  `;

  $("btnNew").addEventListener("click", openCreateModal);
  $("btnCloseModal").addEventListener("click", closeModal);
  $("btnCancel").addEventListener("click", closeModal);
  $("btnSave").addEventListener("click", saveEmployee);

  c.querySelectorAll("[data-edit-employee]").forEach(btn=>{
    btn.addEventListener("click", ()=> openEditModal(btn.dataset.editEmployee));
  });
}

async function saveEmployee(){
  const firstName = $("e_firstName").value.trim();
  const lastName = $("e_lastName").value.trim();
  const workStart = $("e_workStart").value || "08:00";
  const workEnd = $("e_workEnd").value || "18:00";

  if (!firstName || !lastName) return toast("Nombre y apellido son obligatorios");
  if (workStart >= workEnd) return toast("El horario de fin debe ser mayor al de inicio");

  const dateFields = ["e_birthDate", "e_hireDate", "e_terminationDate", "e_availabilityFrom", "e_availabilityTo"];
  for (const id of dateFields){
    const raw = $(id).value;
    if (raw && !normalizeInputDateToKey(raw)) return toast("Fecha inválida. Usar formato DD/MM/YYYY");
  }

  const payload = {
    firstName,
    lastName,
    address: $("e_address").value.trim(),
    phone: $("e_phone").value.trim(),
    dni: $("e_dni").value.trim(),
    birthDate: normalizeInputDateToKey($("e_birthDate").value),
    workingDays: $("e_workingDays").value,
    workStart,
    workEnd,
    hireDate: normalizeInputDateToKey($("e_hireDate").value),
    terminationDate: normalizeInputDateToKey($("e_terminationDate").value),
    employeeRole: $("e_role").value,
    comments: $("e_comments").value.trim(),
    availabilityStatus: $("e_availability").value,
    availabilityFrom: normalizeInputDateToKey($("e_availabilityFrom").value),
    availabilityTo: normalizeInputDateToKey($("e_availabilityTo").value),
    status: "active"
  };

  $("btnSave").disabled = true;
  try{
    if (editEmployeeId){
      await update("employees", editEmployeeId, payload, auth.currentUser);
      toast("Empleado actualizado");
    } else {
      await create("employees", payload, auth.currentUser);
      toast("Empleado creado");
    }

    closeModal();
    await loadData();
    render();
  } catch(err){
    console.error(err);
    toast(err?.message || "No se pudo guardar el empleado");
  } finally{
    $("btnSave").disabled = false;
  }
}

async function loadData(){
  EMPLOYEES = await list("employees", {
    filters: [{ field:"status", op:"==", value:"active" }],
    order: { field:"lastName", dir:"asc" },
    max: 500
  });
}

async function init(){
  await requireRole(["admin", "operator", "viewer"]);

  await loadShell({
    activeNav: "employees",
    primaryText: "+ Nuevo empleado",
    onPrimary: ()=> openCreateModal()
  });

  await loadData();
  render();
}

init();
