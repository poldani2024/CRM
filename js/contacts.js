import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create, update } from "./data_access.js";
import { escapeHtml, $, toast } from "./utils.js";

function getParam(name){
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

let CONTACTS = [];
let ACCOUNTS = [];
let accountIdPrefill = null;
let editContactId = null;

function parseCsv(text){
  const rows = [];
  let row = [];
  let current = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length){
    const ch = text[i];

    if (inQuotes){
      if (ch === '"'){
        if (text[i + 1] === '"'){
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (ch === '"'){
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === '\n'){
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      i += 1;
      continue;
    }
    if (ch === '\r'){
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  if (current.length || row.length){
    row.push(current);
    rows.push(row);
  }

  if (!rows.length) return [];

  const delimiter = (rows[0].join('').match(/;/g) || []).length > (rows[0].join('').match(/,/g) || []).length ? ';' : ',';
  const splitRows = rows.map(r=> r.length === 1 ? r[0].split(delimiter) : r);
  const headers = splitRows[0].map(h => String(h || '').trim());
  return splitRows.slice(1)
    .filter(r => r.some(c => String(c || '').trim()))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx)=>{ obj[h] = String(r[idx] || '').trim(); });
      return obj;
    });
}

function normalizeStatus(raw){
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "active";
  if (["inactive", "inactivo", "baja", "0", "false"].includes(v)) return "inactive";
  return "active";
}

async function importContactsFromCsv(file){
  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) return toast("CSV vacío");

  const required = ["account_name"];
  const missing = required.filter(k => !(k in rows[0]));
  if (missing.length) return toast(`Faltan columnas: ${missing.join(", ")}`);

  const accountByName = new Map(ACCOUNTS.map(a=>[String(a.name || "").trim().toLowerCase(), a]));
  const existingContacts = await list("contacts", { order:null, max:4000 });
  const keySet = new Set(existingContacts.map(c=>[
    c.accountId || "",
    String(c.firstName || "").trim().toLowerCase(),
    String(c.lastName || "").trim().toLowerCase(),
    String(c.email || "").trim().toLowerCase(),
    String(c.mobile || "").trim().toLowerCase()
  ].join("::")));

  let created = 0;
  let skipped = 0;

  for (const row of rows){
    const accountName = String(row.account_name || "").trim();
    const firstName = String(row.first_name || row.name || "").trim();
    const lastName = String(row.last_name || row.surname || "").trim();
    const email = String(row.email || "").trim();
    const mobile = String(row.mobile || row.whatsapp || "").trim();
    if (!accountName) { skipped += 1; continue; }
    if (!firstName && !lastName) { skipped += 1; continue; }

    const account = accountByName.get(accountName.toLowerCase());
    if (!account){ skipped += 1; continue; }

    const key = [account.id, firstName.toLowerCase(), lastName.toLowerCase(), email.toLowerCase(), mobile.toLowerCase()].join("::");
    if (keySet.has(key)){ skipped += 1; continue; }

    await create("contacts", {
      accountId: account.id,
      firstName,
      lastName,
      role: String(row.role || "").trim(),
      email,
      mobile,
      notes: String(row.notes || "").trim(),
      status: normalizeStatus(row.status)
    }, auth.currentUser);
    keySet.add(key);
    created += 1;
  }

  toast(`Importación contactos OK · Creados: ${created} · Omitidos: ${skipped}`);
  await loadData();
  render();
}

function openCreateModal(){
  editContactId = null;
  $("modalTitle").textContent = "Nuevo contacto";
  $("btnSave").textContent = "Guardar";

  $("c_firstName").value = "";
  $("c_lastName").value = "";
  $("c_role").value = "";
  $("c_email").value = "";
  $("c_mobile").value = "";
  $("c_notes").value = "";

  $("modalBackdrop").style.display = "flex";
  if (accountIdPrefill) $("c_accountId").value = accountIdPrefill;
}

function openEditModal(contactId){
  const contact = CONTACTS.find(c=>c.id===contactId);
  if (!contact) return toast("No se encontró el contacto");

  editContactId = contact.id;
  $("modalTitle").textContent = "Editar contacto";
  $("btnSave").textContent = "Guardar cambios";

  $("c_firstName").value = contact.firstName || "";
  $("c_lastName").value = contact.lastName || "";
  $("c_accountId").value = contact.accountId || "";
  $("c_role").value = contact.role || "";
  $("c_email").value = contact.email || "";
  $("c_mobile").value = contact.mobile || "";
  $("c_notes").value = contact.notes || "";

  $("modalBackdrop").style.display = "flex";
}

function closeModal(){
  $("modalBackdrop").style.display = "none";
}

function render(){
  const c = document.getElementById("pageContent");
  c.innerHTML = `
    <div class="section-title">Contactos</div>

    <div class="panel" style="padding:14px;">
      <div class="row" style="justify-content:space-between; flex-wrap:wrap;">
        <div class="muted">Total: ${CONTACTS.length}</div>
        <div class="row" style="gap:8px;">
          <input id="contactsImportFile" type="file" accept=".csv,text/csv" style="display:none;" />
          <button class="btn" id="btnImportContacts">Importar CSV</button>
          <button class="btn btn-primary" id="btnNew">+ Nuevo contacto</button>
        </div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      ${CONTACTS.length ? CONTACTS.map(ct=>{
        const acc = ACCOUNTS.find(a=>a.id===ct.accountId);
        return `
          <div class="card" style="margin-bottom:10px;">
            <div class="row" style="justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap;">
              <div>
                <div class="card-title">${escapeHtml((ct.lastName||"") + ", " + (ct.firstName||"")).replace(", ", ct.firstName? ", ":"") || "—"}</div>
                <div class="card-sub muted small">
                  ${escapeHtml(acc?.name || "")}
                  ${ct.role ? `· ${escapeHtml(ct.role)}` : ""}
                  ${ct.mobile ? `· ${escapeHtml(ct.mobile)}` : ""}
                  ${ct.email ? `· ${escapeHtml(ct.email)}` : ""}
                </div>
              </div>
              <div class="row" style="gap:8px;">
                <button class="btn" data-edit-contact="${escapeHtml(ct.id)}">Editar</button>
              </div>
            </div>
          </div>
        `;
      }).join("") : `<div class="muted">Sin contactos.</div>`}
    </div>

    <!-- modal -->
    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title" id="modalTitle">Nuevo contacto</div>
          <button class="btn btn-ghost" id="btnCloseModal">✕</button>
        </div>

        <div class="spacer"></div>

        <div class="grid2">
          <div class="field">
            <label>Nombre</label>
            <input id="c_firstName" />
          </div>
          <div class="field">
            <label>Apellido</label>
            <input id="c_lastName" />
          </div>

          <div class="field">
            <label>Cuenta</label>
            <select id="c_accountId"></select>
          </div>

          <div class="field">
            <label>Rol</label>
            <input id="c_role" placeholder="Ej: Encargado" />
          </div>

          <div class="field">
            <label>Email</label>
            <input id="c_email" />
          </div>
          <div class="field">
            <label>WhatsApp / Móvil</label>
            <input id="c_mobile" placeholder="+549..." />
          </div>

          <div class="field" style="grid-column:1/-1;">
            <label>Comentarios</label>
            <textarea id="c_notes"></textarea>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn" id="btnCancel">Cancelar</button>
          <button class="btn btn-primary" id="btnSave">Guardar</button>
        </div>
      </div>
    </div>
  `;

  // wire
  $("btnNew").addEventListener("click", openCreateModal);
  $("btnImportContacts").addEventListener("click", ()=> $("contactsImportFile").click());
  $("contactsImportFile").addEventListener("change", async ()=>{
    const file = $("contactsImportFile").files?.[0];
    $("contactsImportFile").value = "";
    if (!file) return;
    try{
      await importContactsFromCsv(file);
    } catch(err){
      console.error(err);
      toast(err?.message || "Error importando contactos");
    }
  });
  $("btnCloseModal").addEventListener("click", closeModal);
  $("btnCancel").addEventListener("click", closeModal);
  $("btnSave").addEventListener("click", saveContact);

  c.querySelectorAll("[data-edit-contact]").forEach(btn=>{
    btn.addEventListener("click", ()=> openEditModal(btn.dataset.editContact));
  });

  // fill accounts select
  $("c_accountId").innerHTML = ACCOUNTS
    .map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name||"—")}</option>`)
    .join("");
  if (editContactId){
    const contact = CONTACTS.find(c=>c.id===editContactId);
    if (contact) $("c_accountId").value = contact.accountId || "";
  } else if (accountIdPrefill) {
    $("c_accountId").value = accountIdPrefill;
  }
}

async function saveContact(){
  const data = {
    firstName: $("c_firstName").value.trim(),
    lastName: $("c_lastName").value.trim(),
    accountId: $("c_accountId").value,
    role: $("c_role").value.trim(),
    email: $("c_email").value.trim(),
    mobile: $("c_mobile").value.trim(),
    notes: $("c_notes").value.trim(),
    status: "active"
  };
  if (!data.firstName && !data.lastName) return toast("Falta nombre o apellido");

  $("btnSave").disabled = true;
  try{
    if (editContactId){
      await update("contacts", editContactId, data, auth.currentUser);
      toast("Contacto actualizado");
    } else {
      await create("contacts", data, auth.currentUser);
      toast("Contacto creado");
    }

    closeModal();
    await loadData();
    render();
  } catch(e){
    console.error(e);
    toast(e?.message || "Error guardando contacto");
  } finally{
    $("btnSave").disabled = false;
  }
}

async function loadData(){
  ACCOUNTS = await list("accounts", {
    filters: [{ field:"status", op:"==", value:"active" }],
    order:{ field:"name", dir:"asc" },
    max: 500
  });

  const filters = [{ field:"status", op:"==", value:"active" }];
  if (accountIdPrefill) filters.push({ field:"accountId", op:"==", value: accountIdPrefill });

  CONTACTS = await list("contacts", { filters, order:{ field:"updatedAt", dir:"desc" }, max: 500 });
}

async function init(){
  await requireRole(["admin","operator","viewer"]);
  accountIdPrefill = getParam("accountId");
  editContactId = getParam("editId");

  await loadShell({
    activeNav:"contacts",
    primaryText:"+ Nuevo contacto",
    onPrimary: ()=> openCreateModal()
  });

  await loadData();
  render();

  if (editContactId){
    openEditModal(editContactId);
    editContactId = null;
  }
}

init();
