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



export function keyToDisplayDate(raw=""){
  const v = String(raw || "").trim();
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return v;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function normalizeInputDateToKey(raw=""){
  const v = String(raw || "").trim();
  if (!v) return "";
  let y, m, d;
  let k = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (k){
    y, m, d = Number(k[1]), Number(k[2]), Number(k[3]);
  } else {
    k = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!k) return "";
    d, m, y = Number(k[1]), Number(k[2]), Number(k[3]);
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return "";
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function formatDateAR(date){
  if (!date) return "";
  if (typeof date === "string") return keyToDisplayDate(date);
  const d = (date instanceof Date) ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
}
