import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { auth } from "./firebase.js";
import { list, create, update } from "./data_access.js";
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

let draggedId = null;
let justDragged = false;

function enableDragDrop(){
  document.querySelectorAll(".card").forEach(card=>{
    card.setAttribute("draggable", "true");

    card.addEventListener("dragstart", ()=>{
      draggedId = card.dataset.id;
      justDragged = true;
      card.classList.add("dragging");
    });

    card.addEventListener("dragend", ()=>{
      card.classList.remove("dragging");
      draggedId = null;
      window.setTimeout(()=>{ justDragged = false; }, 60);
    });
  });

  document.querySelectorAll("[data-drop-stage]").forEach(col=>{
    const onDragOver = ev=>{
      ev.preventDefault();
      col.classList.add("drag-over");
      col.querySelector(".cards")?.classList.add("drag-over");
    };
    const onDragLeave = ()=>{
      col.classList.remove("drag-over");
      col.querySelector(".cards")?.classList.remove("drag-over");
    };

    col.addEventListener("dragover", onDragOver);
    col.addEventListener("dragleave", onDragLeave);
    col.querySelector(".cards")?.addEventListener("dragover", onDragOver);
    col.querySelector(".cards")?.addEventListener("dragleave", onDragLeave);

    col.addEventListener("drop", async ev=>{
      ev.preventDefault();
      onDragLeave();
      if (!draggedId) return;

      const newStage = col.dataset.dropStage;
      const acc = ACCOUNTS.find(a=>a.id === draggedId);
      if (!acc) return;
      if (normalizeStage(acc.stage) === newStage) return;

      try{
        await update("accounts", draggedId, {
          stage: newStage,
          status: stageToAccountStatus(newStage)
        }, auth.currentUser);
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
        <div class="col" data-drop-stage="${s.key}">
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

    host.querySelectorAll(".card").forEach(card=>{
      card.addEventListener("click", ()=>{
        if (justDragged) return;
        const id = card.dataset.id;
        window.location.href = `../pages/account_detail.html?id=${encodeURIComponent(id)}`;
      });
    });
  }

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

init();
