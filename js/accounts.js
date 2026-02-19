// ✅ CAMBIO 1: se agrega "update" acá (y se elimina el import duplicado más abajo)
import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create, update } from "./data_access.js"; // ✅ CAMBIO
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

let draggedId = null; // ✅ CAMBIO: definido antes para usar en renderBoard -> enableDragDrop

function enableDragDrop(){
  // Cards: drag start/end
  document.querySelectorAll(".card").forEach(card=>{
    // ✅ CAMBIO: forzar draggable por si el navegador/DOM lo pierde
    card.setAttribute("draggable","true");

    card.addEventListener("dragstart", ()=>{
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

    // ✅ CAMBIO 2: reemplaza el "..." por el render real de cards + draggable + data-id
    host.innerHTML = arr.map(a=>{
      const upd = a.updatedAt?.toDate ? a.updatedAt.toDate() : null;
      return `
        <div class="card" draggable="true" data-id="${a.id}">
          <div class="card-title">${escapeHtml(a.name || "—")}</div>
          <div class="card-sub muted small">${escapeHtml(typeLabel(a.type))} · ${escapeHtml(a.phone || "")}</div>
          <div class="card-meta">
            ${upd ? `<span>Actualizado: ${escapeHtml(formatDateTimeAR(upd))}</span>` : `<span class="muted">—</span>`}
          </div>
        </div>
      `;
    }).join("");

    // 👇 (ya estaba, sin tocar lógica)
    host.querySelectorAll(".card").forEach(card=>{
      card.addEventListener("click", ()=>{
        const id = card.dataset.id;
        window.location.href = `../pages/account_detail.html?id=${encodeURIComponent(id)}`;
      });
    });
  }

  // ✅ CAMBIO 3: se llama acá (después de renderizar) y NO al final del archivo
  enableDragDrop();
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

// ✅ (CAMBIO) se mantiene init al final, y se elimina enableDragDrop() suelto
init();
