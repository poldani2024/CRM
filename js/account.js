import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create } from "./data_access.js";
import { escapeHtml, formatDateTimeAR, $, toast } from "./utils.js";

const STAGES = [
  { key:"contacted", label:"Contactado" },
  { key:"negotiation", label:"Negociación" },
  { key:"offer_sent", label:"Oferta enviada" },
  { key:"closed", label:"Cerrado" },
];

let PROFILE = null;
let ACCOUNTS = [];

function openModal(){
  $("modalBackdrop").style.display = "flex";
}
function closeModal(){
  $("modalBackdrop").style.display = "none";
  $("a_name").value = "";
  $("a_phone").value = "";
  $("a_notes").value = "";
  $("a_type").value = "business";
  $("a_stage").value = "contacted";
}

function stageLabel(k){
  return STAGES.find(s=>s.key===k)?.label || k;
}

function renderBoard(){
  const content = document.getElementById("pageContent");
  content.innerHTML = `
    <div class="section-title">Cuentas</div>
    <div class="board">
      ${STAGES.map(s=>`
        <div class="col">
          <div class="col-head">
            <div class="col-title">${escapeHtml(s.label)}</div>
            <div class="badge" id="count_${s.key}">0</div>
          </div>
          <div class="cards" id="col_${s.key}"></div>
        </div>
      `).join("")}
    </div>
  `;

  // distribuir cards
  const byStage = {};
  for (const s of STAGES) byStage[s.key] = [];
  for (const a of ACCOUNTS){
    const st = a.stage || "contacted";
    (byStage[st] ||= []).push(a);
  }

  for (const s of STAGES){
    const arr = byStage[s.key] || [];
    document.getElementById(`count_${s.key}`).textContent = String(arr.length);

    const host = document.getElementById(`col_${s.key}`);
    host.innerHTML = arr.map(a=>{
      const upd = a.updatedAt?.toDate ? a.updatedAt.toDate() : null;
      return `
        <a class="card" href="../pages/account_detail.html?id=${encodeURIComponent(a.id)}">
          <div class="card-title">${escapeHtml(a.name || "—")}</div>
          <div class="card-sub muted small">${escapeHtml(typeLabel(a.type))} · ${escapeHtml(a.phone || "")}</div>
          <div class="card-meta">
            ${upd ? `<span>Actualizado: ${escapeHtml(formatDateTimeAR(upd))}</span>` : `<span class="muted">—</span>`}
          </div>
        </a>
      `;
    }).join("");
  }
}

function typeLabel(t){
  if (t==="business") return "Empresa";
  if (t==="commercial") return "Comercial";
  if (t==="residential") return "Residencial";
  return t || "—";
}

async function loadData(){
  // accounts ordenadas por updatedAt desc
  ACCOUNTS = await list("accounts", {
    order: { field:"updatedAt", dir:"desc" },
    max: 400
  });
}

function wireModal(){
  $("btnCloseModal").addEventListener("click", closeModal);
  $("btnCancel").addEventListener("click", closeModal);

  $("btnSave").addEventListener("click", async ()=>{
    const name = $("a_name").value.trim();
    if (!name) return toast("Falta el nombre");

    const data = {
      name,
      type: $("a_type").value,
      stage: $("a_stage").value,
      phone: $("a_phone").value.trim(),
      notes: $("a_notes").value.trim(),
      status: "active"
    };

    $("btnSave").disabled = true;
    try{
      const id = await create("accounts", data, auth.currentUser);
      toast("Cuenta creada");
      closeModal();
      await loadData();
      renderBoard();
      // opcional: ir al detail
      // window.location.href = `../pages/account_detail.html?id=${encodeURIComponent(id)}`;
    } catch(e){
      console.error(e);
      toast(e?.message || "Error guardando");
    } finally{
      $("btnSave").disabled = false;
    }
  });
}

async function init(){
  PROFILE = await requireRole(["admin","operator","viewer"]);
  await loadShell({
    activeNav: "accounts",
    primaryText: "+ Agregar cuenta",
    onPrimary: ()=> openModal()
  });

  wireModal();
  await loadData();
  renderBoard();
}

init();
