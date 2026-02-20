// ✅ CAMBIO 1: se agrega "update" acá (y se elimina el import duplicado más abajo)
import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create, update } from "./data_access.js"; // ✅ CAMBIO
import { escapeHtml, formatDateTimeAR, $, toast } from "./utils.js";

const STAGES = [
  { key:"prospect", label:"Prospecto" },
  { key:"offer_sent", label:"Oferta enviada" },
  { key:"negotiation", label:"Negociación" },
  { key:"account_active", label:"Cuenta activa" },
  { key:"closed", label:"Cerrado" }
];

let PROFILE = null;
let ACCOUNTS = [];

function normalizeStage(stage){
  const raw = String(stage || "");
  if (raw === "contacted") return "prospect";
  if (raw === "active") return "account_active";
  if (STAGES.some(s=>s.key === raw)) return raw;
  return "prospect";
}

function stageToAccountStatus(stage){
  return stage === "account_active" ? "active" : "inactive";
}


function openModal(){
  $("modalBackdrop").style.display = "flex";
}
function closeModal(){
  $("modalBackdrop").style.display = "none";
  $("a_name").value = "";
  $("a_phone").value = "";
  $("a_notes").value = "";
  $("a_type").value = "bank";
  $("a_visitUnit").value = "1";
  $("a_visitPeriod").value = "week";
  $("a_stage").value = "prospect";
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
      if (normalizeStage(acc.stage) === newStage) return;

      try{
        await update("accounts", draggedId, { stage: newStage, status: stageToAccountStatus(newStage) }, auth.currentUser);
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
    const st = normalizeStage(a.stage);
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
          <div class="card-sub muted small">
            ${escapeHtml(typeLabel(a.type))}
            ${a.phone ? `· ${escapeHtml(a.phone)}` : ""}
            ${frequencyLabel(a) ? `· ${escapeHtml(frequencyLabel(a))}` : ""}
          </div>
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
  if (t==="bank") return "Banco";
  if (t==="building") return "Edificio";
  if (t==="warehouse") return "Depósito";
  if (t==="store") return "Local";
  if (t==="plant") return "Planta";
  if (t==="business") return "Empresa";
  if (t==="commercial") return "Comercial";
  if (t==="residential") return "Residencial";
  return t || "—";
}

function periodLabel(period, unit){
  const many = Number(unit) > 1;
  if (period === "day") return many ? "días" : "día";
  if (period === "week") return many ? "semanas" : "semana";
  if (period === "month") return many ? "meses" : "mes";
  if (period === "year") return many ? "años" : "año";
  return period || "";
}

function frequencyLabel(account){
  const unit = Number(account.visitFrequencyUnit || 0);
  const period = account.visitFrequencyPeriod;
  if (!unit || !period) return "";
  return `${unit} por ${periodLabel(period, unit)}`;
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

    const stage = $("a_stage").value;
    const data = {
      name,
      type: $("a_type").value,
      visitFrequencyUnit: Math.max(1, Number($("a_visitUnit").value || 1)),
      visitFrequencyPeriod: $("a_visitPeriod").value,
      stage,
      phone: $("a_phone").value.trim(),
      notes: $("a_notes").value.trim(),
      status: stageToAccountStatus(stage)
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
