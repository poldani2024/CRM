export const $ = (id) => document.getElementById(id);

export function escapeHtml(str=""){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

export function toast(text){
  // ultra simple: console + alert suave si querés
  console.log("[toast]", text);
  // si preferís: alert(text);
}

export function pad2(n){ return String(n).padStart(2,"0"); }

/** UI format: DD/MM/YYYY HH:mm */
export function formatDateTimeAR(date){
  if (!date) return "";
  const d = (date instanceof Date) ? date : new Date(date);
  return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function initials(name=""){
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "M";
  const b = parts[1]?.[0] || parts[0]?.[1] || "E";
  return (a+b).toUpperCase();
}

