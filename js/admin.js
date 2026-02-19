import { loadShell } from "./ui_shell.js";
import { requireRole } from "./auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { TENANT_ID } from "./auth.js";
import { $, toast, escapeHtml } from "./utils.js";

async function init(){
  await requireRole(["admin"]);
  await loadShell({ activeNav:"admin", primaryText:"Guardar config", onPrimary: saveSettings });

  const c = document.getElementById("pageContent");
  c.innerHTML = `
    <div class="section-title">Administración</div>

    <div class="panel" style="padding:14px;">
      <div class="muted">Base de configuración (empresa/logo). Gestión de usuarios la agregamos acá en la siguiente iteración.</div>
    </div>

    <div class="spacer"></div>

    <div class="panel" style="padding:14px;">
      <div class="grid2">
        <div class="field">
          <label>Nombre de empresa</label>
          <input id="s_companyName" placeholder="Ej: Fumigaciones Rosario" />
        </div>
        <div class="field">
          <label>Subtítulo</label>
          <input id="s_companySub" placeholder="Ej: Gestión de clientes" />
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>Logo path (ej: ../images/logo.png o /CRM/images/logo.png)</label>
          <input id="s_logoPath" placeholder="/CRM/images/logo.png" />
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-primary" id="btnSaveSettings">Guardar</button>
      </div>
    </div>
  `;

  $("btnSaveSettings").addEventListener("click", saveSettings);
}

async function saveSettings(){
  const data = {
    companyName: $("s_companyName").value.trim(),
    companySub: $("s_companySub").value.trim(),
    logoPath: $("s_logoPath").value.trim(),
    updatedAt: serverTimestamp()
  };
  try{
    const ref = doc(db, "tenants", TENANT_ID, "settings", "main");
    await setDoc(ref, data, { merge:true });
    toast("Settings guardado");
    // recargar para ver logo/nombre aplicado
    window.location.reload();
  } catch(e){
    console.error(e);
    toast(e?.message || "Error guardando settings");
  }
}

init();
