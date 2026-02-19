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

  host.innerHTML = arr.map(a=>{ ... }).join("");

  // 👇 ESTO VA DESPUÉS
  host.querySelectorAll(".card").forEach(card=>{
    card.addEventListener("click", ()=>{
      const id = card.dataset.id;
      window.location.href = `../pages/account_detail.html?id=${encodeURIComponent(id)}`;
    });
  });
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
import { update } from "./data_access.js";

let draggedId = null;

function enableDragDrop(){
  // Cards: drag start/end
  document.querySelectorAll(".card").forEach(card=>{
    card.addEventListener("dragstart", (e)=>{
      draggedId = card.dataset.id;
      card.classList.add("dragging");
    });

    card.addEventListener("dragend", ()=>{
      card.classList.remove("dragging");
      draggedId = null;
    });
  });

  // Columns: allow drop
  document.querySelectorAll(".col").forEach(col=>{
    col.addEventListener("dragover", (e)=> e.preventDefault());

    col.addEventListener("drop", async (e)=>{
      e.preventDefault();
      if (!draggedId) return;

      // detectar stage destino por el id="col_{stage}"
      const cardsHost = col.querySelector(".cards");
      const newStage = cardsHost.id.replace("col_","");

      const acc = ACCOUNTS.find(a=>a.id === draggedId);
      if (!acc) return;
      if ((acc.stage || "contacted") === newStage) return;

      try{
        await update("accounts", draggedId, { stage: newStage }, auth.currentUser);
        toast("Movido ✅");

        await loadData();
        renderBoard();

      } catch(err){
        console.error(err);
        toast("Error moviendo");
      }
    });
  });
}
enableDragDrop();
init();
