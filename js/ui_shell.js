import { auth } from "./firebase.js";
import { onSession, logout, getMyProfile } from "./auth.js";
import { initials, $, toast } from "./utils.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { TENANT_ID } from "./auth.js";

export async function loadShell({ activeNav, primaryText="+ Nuevo", onPrimary=null } = {}){
  // Inyecta shell
  const host = document.getElementById("appShell");
  const res = await fetch("../components/shell.html");
  host.innerHTML = await res.text();

  // Activar nav
  document.querySelectorAll(".nav-item").forEach(a=>{
    if (a.dataset.nav === activeNav) a.classList.add("active");
  });

  // Primary action hook
  const btnPrimary = $("btnPrimaryAction");
  btnPrimary.textContent = primaryText;
  if (onPrimary) btnPrimary.addEventListener("click", onPrimary);

  // Menú mobile
  $("btnMenu")?.addEventListener("click", ()=>{
    document.getElementById("sidebar")?.classList.toggle("open");
  });

  // Logout
  $("btnLogout")?.addEventListener("click", async ()=>{
    await logout();
    window.location.href = "../index.html";
  });

  // Cargar settings tenant (nombre/logo)
  try{
    const settingsRef = doc(db, "tenants", TENANT_ID, "settings", "main");
    const snap = await getDoc(settingsRef);
    const s = snap.exists() ? snap.data() : null;
    if (s?.companyName) $("tenantName").textContent = s.companyName;
    if (s?.companySub) $("tenantSub").textContent = s.companySub;

    // Logo: soporta texto o path en /images
    if (s?.logoPath){
      const el = $("tenantLogo");
      el.innerHTML = `<img alt="logo" src="${s.logoPath}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;">`;
    }
  } catch(e){
    console.warn("No settings/main aún", e);
  }

  // Cargar user box
  onSession(async (user)=>{
    if (!user) return;
    const p = await getMyProfile();
    $("meName").textContent = p?.displayName || user.displayName || "—";
    $("meEmail").textContent = p?.email || user.email || "—";
    $("meAvatar").textContent = initials(p?.displayName || user.displayName || "Me");
  });

  wireGlobalSearch();
}

function normalizeSearchText(raw){
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function clearSearchHighlights(){
  document.querySelectorAll(".global-search-hit").forEach(el=> el.classList.remove("global-search-hit"));
}

function runGlobalSearch(){
  const input = $("globalSearch");
  if (!input) return;
  const term = normalizeSearchText(input.value);
  clearSearchHighlights();
  if (!term) return;

  // 1) Coincidencia con menú: navega a la sección
  const navItems = Array.from(document.querySelectorAll(".nav .nav-item"));
  const navMatch = navItems.find(item=> normalizeSearchText(item.textContent).includes(term));
  if (navMatch && !navMatch.classList.contains("active")){
    window.location.href = navMatch.getAttribute("href") || window.location.href;
    return;
  }

  // 2) Buscar dentro del contenido actual
  const root = $("pageContent");
  if (!root) return;
  const candidates = root.querySelectorAll(".card, tr, .panel, .section-title, .field, .col-title, .tab, button, a, td, th");
  const match = Array.from(candidates).find(el=> normalizeSearchText(el.textContent).includes(term));
  if (!match){
    toast("Sin resultados en esta pantalla");
    return;
  }

  match.classList.add("global-search-hit");
  match.scrollIntoView({ behavior:"smooth", block:"center" });
}

function wireGlobalSearch(){
  const input = $("globalSearch");
  if (!input) return;
  input.addEventListener("keydown", ev=>{
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    runGlobalSearch();
  });

  $("btnFilters")?.addEventListener("click", runGlobalSearch);
}
