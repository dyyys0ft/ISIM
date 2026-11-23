/* =====================================================================
   SISTEMA MÉDICO ISIM — Interfaz
   ===================================================================== */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const S = { user: null, inst: {}, horario: null, meds: null, esquemas: null };
const ROL = { admin: "Administrador", medico: "Médico", recepcion: "Recepción", enfermeria: "Aux. de enfermería" };
const TABS_ROL = {
  recepcion: ["datos", "historia", "receta", "examenes", "pedidos", "consentimientos", "certificados"],
  enfermeria: ["datos", "historia", "examenes"],
};
const puedeTab = k => isClin() || (TABS_ROL[S.user?.rol] || ["datos"]).includes(k);
const tabInicial = () => isClin() ? "consulta" : S.user.rol === "enfermeria" ? "examenes" : "datos";
const inicio = () => S.user.rol === "recepcion" ? "#/turnos" : "#/agenda";
const isClin = () => S.user && (S.user.rol === "admin" || S.user.rol === "medico");
const LOGO = window.DEMO_LOGO || "/logo.png";
const fileUrl = a => a.url || "/api/archivo/" + a.id;
const isAdmin = () => S.user && S.user.rol === "admin";

async function api(method, path, body) {
  if (window.DEMO_API) return window.DEMO_API(method, path, body);
  const opt = { method, headers: { "X-ISIM": "1" }, credentials: "same-origin" };
  if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch("/api/" + path, opt);
  let d = null;
  try { d = await r.json(); } catch (e) { }
  if (r.status === 401 && !path.startsWith("login")) { S.user = null; render(); throw new Error(d?.error || "Sesión expirada"); }
  if (!r.ok) throw new Error(d?.error || "Error " + r.status);
  return d;
}
function toast(msg, err) {
  const d = document.createElement("div"); d.textContent = msg; if (err) d.className = "e";
  $("#toast").appendChild(d); setTimeout(() => d.remove(), err ? 5000 : 2600);
}
const fail = e => toast(e.message || String(e), true);

/* ---------------- fechas ---------------- */
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const parseD = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return iso(d); };
const fmtD = s => s ? s.slice(0, 10).split("-").reverse().join("/") : "";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const longD = s => { const d = parseD(s); return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
function edad(fn, ref) {
  if (!fn) return "";
  const a = parseD(fn), b = ref ? parseD(ref) : new Date();
  let y = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y--;
  return y;
}
function gestacion(fum, ref) {
  if (!fum) return null;
  const days = Math.floor((parseD(ref || today()) - parseD(fum)) / 864e5);
  if (days < 0 || days > 320) return null;
  const fpp = parseD(fum); fpp.setDate(fpp.getDate() + 280);
  return { sem: Math.floor(days / 7), dias: days % 7, txt: `${Math.floor(days / 7)} sem ${days % 7} d`, fpp: iso(fpp) };
}
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hm12 = h => { if (!h) return ""; let [H, M] = h.split(":").map(Number); const ap = H >= 12 ? "pm" : "am"; H = H % 12 || 12; return `${H}:${pad(M)} ${ap}`; };

/* número a letras (cantidades de receta) */
function letras(n) {
  n = parseInt(n); if (isNaN(n)) return "";
  const U = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
  const D = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const C = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
  if (n < 30) return U[n];
  if (n < 100) return D[Math.floor(n / 10)] + (n % 10 ? " y " + U[n % 10] : "");
  if (n === 100) return "cien";
  if (n < 1000) return C[Math.floor(n / 100)] + (n % 100 ? " " + letras(n % 100) : "");
  if (n < 2000) return "mil" + (n % 1000 ? " " + letras(n % 1000) : "");
  return String(n);
}

/* cédula ecuatoriana */
function cedulaOk(c) {
  if (!/^\d{10}$/.test(c)) return false;
  const p = +c.slice(0, 2); if (!((p >= 1 && p <= 24) || p === 30) || +c[2] > 5) return false;
  let s = 0; for (let i = 0; i < 9; i++) { let d = +c[i] * (i % 2 ? 1 : 2); s += d > 9 ? d - 9 : d; }
  return (10 - s % 10) % 10 === +c[9];
}

/* ---------------- modal ---------------- */
function modal(title, body, foot, wide) {
  const root = $("#modal-root");
  const w = document.createElement("div"); w.className = "mback";
  w.innerHTML = `<div class="modal ${wide ? "wide" : ""}"><header><h2>${esc(title)}</h2><button class="btn ghost" data-x>✕</button></header><div class="b">${body}</div>${foot ? `<footer>${foot}</footer>` : ""}</div>`;
  root.appendChild(w);
  const close = () => w.remove();
  w.addEventListener("mousedown", e => { if (e.target === w) close(); });
  $("[data-x]", w).onclick = close;
  w.close = close;
  return w;
}
function confirmar(msg) {
  return new Promise(res => {
    const m = modal("Confirmar", `<p>${esc(msg)}</p>`, `<button class="btn" data-n>Cancelar</button><button class="btn pri" data-y>Aceptar</button>`);
    $("[data-n]", m).onclick = () => { m.close(); res(false); };
    $("[data-y]", m).onclick = () => { m.close(); res(true); };
  });
}

/* ---------------- router ---------------- */
function route() {
  const h = location.hash.slice(1) || "";
  const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || "")) };
}
const go = h => { if (location.hash === h) render(); else location.hash = h; };
window.addEventListener("hashchange", () => render());

async function boot() {
  try {
    const e = await api("GET", "estado");
    S.inst = e.institucion || {};
    if (e.necesita_instalacion) return renderInstalar();
    S.user = e.usuario;
    if (S.user) { const a = await api("GET", "ajustes"); setAjustes(a); }
    render();
  } catch (e) { $("#app").innerHTML = `<div class="main"><div class="err">No se pudo conectar con el servidor: ${esc(e.message)}</div></div>`; }
}

function render() {
  if (!S.user) return renderLogin();
  const r = route();
  let sec = r.parts[0];
  if (!sec) { go(inicio()); return; }
  if (sec === "turnos" && S.user.rol === "enfermeria") { go("#/agenda"); return; }
  shell(sec);
  const m = $("#main");
  ({ turnos: vTurnos, agenda: vAgenda, paciente: vPaciente, ajustes: vAjustes, clave: vClave }[sec] || vTurnos)(m, r);
}

function shell(sec) {
  const navSec = sec === "paciente" ? "agenda" : sec;
  $("#app").innerHTML = `
  <div class="top">
    <img src="${LOGO}" alt="ISIM">
    <nav class="nav">
      ${S.user.rol !== "enfermeria" ? `<a href="#/turnos" class="${navSec === "turnos" ? "on" : ""}">Turnos</a>` : ""}
      <a href="#/agenda" class="${navSec === "agenda" ? "on" : ""}">Agenda</a>
      ${isClin() || S.user.rol === "recepcion" ? `<a href="#/ajustes" class="${navSec === "ajustes" ? "on" : ""}">${isClin() ? "Ajustes" : "Medicamentos"}</a>` : ""}
    </nav>
    <div class="user">
      <div class="who"><b>${esc(S.user.nombre)}</b><span class="small muted">${ROL[S.user.rol]}</span></div>
      <a class="btn sm" href="#/clave">Contraseña</a>
      <button class="btn sm" id="logout">Salir</button>
    </div>
  </div>
  <div class="main" id="main"></div>`;
  $("#logout").onclick = async () => { await api("POST", "logout"); S.user = null; location.hash = ""; render(); };
}

/* ---------------- login / instalación ---------------- */
function renderLogin() {
  $("#app").innerHTML = `<div class="login"><form class="box stack" id="f">
    <img src="${LOGO}" alt="">
    <h2 style="text-align:center">Sistema Médico</h2>
    <div id="er"></div>
    <label class="f"><span>Usuario</span><input name="usuario" autocomplete="username" required autofocus></label>
    <label class="f"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn pri" style="width:100%">Ingresar</button>
    <p class="small muted" style="text-align:center">Información confidencial — uso exclusivo del personal autorizado del ISIM.</p>
  </form></div>`;
  $("#f").onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api("POST", "login", fd); S.user = r.usuario;
      const a = await api("GET", "ajustes"); setAjustes(a);
      location.hash = inicio(); render();
    } catch (er) { $("#er").innerHTML = `<div class="err">${esc(er.message)}</div>`; }
  };
}
function renderInstalar() {
  $("#app").innerHTML = `<div class="login"><form class="box stack" id="f" style="width:460px">
    <img src="${LOGO}" alt="">
    <h2>Primera instalación</h2>
    <div class="info">Cree el usuario <b>administrador</b> (médico principal). Después podrá crear los usuarios de recepción y de los demás médicos.</div>
    <div id="er"></div>
    <label class="f"><span>Nombre completo</span><input name="nombre" value="Dr. Jorge Augusto Paredes Pérez" required></label>
    <label class="f"><span>Especialidad (aparece en recetas)</span><input name="especialidad" value="Gineco-Obstetra · Medicina Materno Fetal"></label>
    <label class="f"><span>Registro profesional (Senescyt / ACESS)</span><input name="registro" placeholder="Ej.: 1006-XX-XXXXXX"></label>
    <label class="f"><span>Usuario</span><input name="usuario" value="jparedes" required></label>
    <label class="f"><span>Contraseña (mínimo 8 caracteres)</span><input name="password" type="password" minlength="8" required></label>
    <button class="btn pri" style="width:100%">Crear administrador e ingresar</button>
  </form></div>`;
  $("#f").onsubmit = async e => {
    e.preventDefault();
    try { const r = await api("POST", "instalar", Object.fromEntries(new FormData(e.target))); S.user = r.usuario; boot(); }
    catch (er) { $("#er").innerHTML = `<div class="err">${esc(er.message)}</div>`; }
  };
}
function vClave(m) {
  m.innerHTML = `<form class="card stack" id="f" style="max-width:420px"><h2>Cambiar mi contraseña</h2>
    <label class="f"><span>Contraseña actual</span><input type="password" name="actual" required></label>
    <label class="f"><span>Nueva contraseña (mín. 8)</span><input type="password" name="nueva" minlength="8" required></label>
    <button class="btn pri">Guardar</button></form>`;
  $("#f").onsubmit = async e => { e.preventDefault(); try { await api("POST", "mi-clave", Object.fromEntries(new FormData(e.target))); toast("Contraseña actualizada"); e.target.reset(); } catch (er) { fail(er); } };
}

/* =====================================================================
   TURNOS
   ===================================================================== */
const ESTADOS = { agendado: "Agendado", espera: "En sala de espera", atendido: "Atendido", noasistio: "No asistió" };
function setAjustes(a) { S.horario = a.horario; S.inst = a.institucion; S.motivos = a.motivos || []; S.plantillas = a.consentimientos || {}; S.textosCI = a.textos_ci || {}; S.membretes = a.membretes || {}; }
const ciDe = motivo => { const x = (S.motivos || []).find(m => m.motivo === motivo); return x && x.consentimiento ? S.plantillas[x.consentimiento] : null; };
function selectMotivo(valor) {
  const grupos = [...new Set((S.motivos || []).map(m => m.grupo))];
  const conocido = !valor || (S.motivos || []).some(m => m.motivo === valor);
  return `<select id="motivo"><option value="">— Seleccione el motivo —</option>
    ${grupos.map(g => `<optgroup label="${esc(g)}">${S.motivos.filter(m => m.grupo === g).map(m => `<option ${m.motivo === valor ? "selected" : ""}>${esc(m.motivo)}</option>`).join("")}</optgroup>`).join("")}
    <option value="__otro" ${conocido ? "" : "selected"}>Otro (escribir)…</option></select>
    <input id="motivoOtro" placeholder="Escriba el motivo" style="margin-top:6px;${conocido ? "display:none" : ""}" value="${conocido ? "" : esc(valor)}">`;
}
const leerMotivo = m => { const v = $("#motivo", m).value; return v === "__otro" ? $("#motivoOtro", m).value.trim() : v; };
function bindMotivo(m) {
  const s = $("#motivo", m), o = $("#motivoOtro", m), h = $("#ciHint", m);
  const upd = () => {
    o.style.display = s.value === "__otro" ? "" : "none";
    const p = ciDe(s.value);
    if (h) h.innerHTML = p ? `✍ Se generará para firma: <b>${esc(p.titulo)}</b>` : "";
  };
  s.onchange = upd; upd();
}

function horarioDelDia(f) {
  const d = parseD(f).getDay(), H = S.horario || {};
  if (d === 0) return { manana: [], tarde: [] };
  return d === 6 ? (H.sabado || { manana: [], tarde: [] }) : (H.lv || { manana: [], tarde: [] });
}
function dateBar(f, base, extraHtml = "") {
  return `<div class="datebar">
    <button class="btn" data-d="-1">‹</button>
    <button class="btn" data-d="0">Hoy</button>
    <button class="btn" data-d="1">›</button>
    <input type="date" value="${f}" id="fdate">
    <span class="day">${longD(f)}</span>
    <span class="grow"></span>${extraHtml}
  </div>`;
}
function bindDateBar(m, f, base) {
  $$("[data-d]", m).forEach(b => b.onclick = () => { const n = +b.dataset.d; go(`${base}?f=${n === 0 ? today() : addDays(f, n)}`); });
  $("#fdate", m).onchange = e => e.target.value && go(`${base}?f=${e.target.value}`);
}

async function vTurnos(m, r) {
  const f = r.q.f || today();
  m.innerHTML = dateBar(f, "#/turnos") + `<div id="tw" class="empty">Cargando…</div>`;
  bindDateBar(m, f, "#/turnos");
  let ts;
  try { ts = await api("GET", "turnos?fecha=" + f); } catch (e) { return fail(e); }
  const H = horarioDelDia(f), cupos = (S.horario && S.horario.cupos_por_hora) || 2;
  const domingo = parseD(f).getDay() === 0;

  const card = t => {
    const nuevo = t.n_consultas === 0;
    return `<div class="slot full e-${t.estado}">
      <a class="nm" href="#/paciente/${t.paciente_id}?t=${t.id}&tab=${tabInicial()}">${esc(t.apellidos)} ${esc(t.nombres)}</a>
      <div class="meta">
        <span>${esc(t.cedula)}</span>${t.fecha_nac ? `<span>· ${edad(t.fecha_nac, f)} a</span>` : ""}
        ${nuevo ? `<span class="badge new">Primera vez</span>` : `<span class="badge">Subsecuente</span>`}
        ${t.ci_pendientes ? `<a class="badge red" href="#/paciente/${t.paciente_id}?t=${t.id}&tab=consentimientos" title="Consentimientos pendientes de firma">✍ ${t.ci_pendientes} por firmar</a>` : ""}
        ${t.motivo ? `<span title="${esc(t.motivo)}">· ${esc(t.motivo.length > 28 ? t.motivo.slice(0, 28) + "…" : t.motivo)}</span>` : ""}
      </div>
      <div class="meta">
        <select data-est="${t.id}">${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${t.estado === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        ${t.consulta_estado ? "" : `<button class="btn sm ghost danger" data-del="${t.id}" title="Quitar turno">Quitar</button>`}
      </div></div>`;
  };
  const jornada = (key, titulo) => {
    const horas = H[key] || [];
    const normales = horas.map(h => {
      let cells = "";
      for (let c = 1; c <= cupos; c++) {
        const t = ts.find(x => x.tipo === "normal" && x.hora === h && x.cupo === c && x.jornada === key);
        cells += t ? card(t) : `<div class="slot" data-slot="${h}|${c}|${key}">＋ Asignar</div>`;
      }
      return `<div class="slotrow" style="grid-template-columns:64px repeat(${cupos},1fr)"><div class="h">${hm12(h)}</div>${cells}</div>`;
    }).join("");
    const ex = ts.filter(x => x.jornada === key && x.tipo !== "normal");
    const extras = ex.map(t => `<div class="extra ${t.tipo === "emergencia" ? "emer" : ""}"><div class="h">${hm12(t.hora)}<div class="small">${t.tipo === "emergencia" ? "EMERG." : "EXTRA"}</div></div>${card(t)}</div>`).join("");
    return `<section class="jor"><header><h3>${titulo}</h3><span class="small muted">${horas.length ? `${horas.length * cupos} turnos fijos · ` : ""}${ts.filter(x => x.jornada === key).length} asignados</span></header>
      ${normales || `<div class="empty small">Sin turnos fijos para este día. Use turnos extra.</div>`}
      <div class="extras"><h4>Turnos extra / emergencias</h4>${extras || `<div class="small muted" style="margin-bottom:8px">Ninguno todavía</div>`}
        <div class="row"><button class="btn sm" data-extra="${key}|extra">＋ Turno extra</button><button class="btn sm danger" data-extra="${key}|emergencia">＋ Emergencia</button></div>
      </div></section>`;
  };
  $("#tw", m).className = "";
  $("#tw", m).innerHTML = (domingo ? `<div class="warn" style="margin-bottom:14px">Domingo: no hay turnos fijos. Solo se registran emergencias.</div>` : "") +
    `<div class="jornadas">${jornada("manana", "Mañana")}${jornada("tarde", "Tarde")}</div>
    <div class="legend"><span><span class="badge new">Primera vez</span> paciente sin consultas previas</span><span><span class="badge">Subsecuente</span> ya tiene historia clínica</span></div>`;

  $$("[data-slot]", m).forEach(el => el.onclick = () => {
    const [hora, cupo, jornada] = el.dataset.slot.split("|");
    asignar({ fecha: f, hora, cupo: +cupo, jornada, tipo: "normal" }, () => vTurnos(m, r));
  });
  $$("[data-extra]", m).forEach(el => el.onclick = () => {
    const [jornada, tipo] = el.dataset.extra.split("|");
    const hs = H[jornada] || [];
    let hora = f === today() ? nowHM() : (hs.length ? hs[hs.length - 1] : (jornada === "manana" ? "12:00" : "18:00"));
    asignar({ fecha: f, hora, cupo: 1, jornada, tipo }, () => vTurnos(m, r));
  });
  $$("[data-est]", m).forEach(el => el.onchange = async () => {
    try { await api("PUT", "turnos/" + el.dataset.est, { estado: el.value }); toast("Estado actualizado"); vTurnos(m, r); } catch (e) { fail(e); }
  });
  $$("[data-del]", m).forEach(el => el.onclick = async () => {
    if (!await confirmar("¿Quitar este turno? El cupo quedará libre.")) return;
    try { await api("DELETE", "turnos/" + el.dataset.del); vTurnos(m, r); } catch (e) { fail(e); }
  });
}

/* --- modal de asignación --- */
function asignar(slot, done) {
  const titulo = slot.tipo === "normal" ? `Asignar turno — ${hm12(slot.hora)} (cupo ${slot.cupo})` : (slot.tipo === "emergencia" ? "Registrar emergencia" : "Turno extra");
  const m = modal(titulo, `
    <div class="info small" style="margin-bottom:12px">${longD(slot.fecha)} · ${slot.jornada === "manana" ? "Mañana" : "Tarde"}</div>
    <div id="paso1">
      <label class="f"><span>Buscar paciente por nombre, apellido o número de cédula</span>
        <input id="q" placeholder="Ej.: Guaño Susana  ·  0603002791" autocomplete="off"></label>
      <div id="res" class="res" style="margin-top:8px;display:none"></div>
      <div class="row" style="margin-top:10px"><span class="muted small grow" id="hint">Escriba al menos 2 letras o números.</span>
        <button class="btn ok" id="nueva">＋ Paciente nueva (primera vez)</button></div>
    </div>
    <div id="paso2" style="display:none"></div>
    <div class="grid g3" style="margin-top:14px">
      ${slot.tipo !== "normal" ? `<label class="f"><span>Hora</span><input type="time" id="hora" value="${slot.hora}"></label>` : ""}
      <label class="f ${slot.tipo !== "normal" ? "span2" : "spanall"}"><span>Motivo de la cita</span>
        ${selectMotivo(slot.tipo === "emergencia" ? "Emergencia" : "")}<small class="muted" id="ciHint"></small></label>
    </div>`,
    `<button class="btn" data-c>Cancelar</button><button class="btn pri" id="ok" disabled>Asignar turno</button>`);
  $("[data-c]", m).onclick = m.close;
  bindMotivo(m);
  let sel = null, modoNueva = false, tmr;
  const q = $("#q", m); q.focus();
  q.oninput = () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const t = q.value.trim(); const box = $("#res", m);
      if (t.length < 2) { box.style.display = "none"; return; }
      try {
        const rs = await api("GET", "pacientes?q=" + encodeURIComponent(t));
        box.style.display = "block";
        $("#hint", m).textContent = rs.length ? `${rs.length} resultado(s). Seleccione a la paciente.` : "No se encontró. Si es primera vez, regístrela como paciente nueva.";
        box.innerHTML = rs.length ? rs.map(p => `<div data-id="${p.id}"><span><b>${esc(p.apellidos)} ${esc(p.nombres)}</b></span><span class="muted small">CI ${esc(p.cedula)}${p.fecha_nac ? " · " + edad(p.fecha_nac) + " años" : ""}</span></div>`).join("") : `<div class="muted">Sin resultados</div>`;
        $$("[data-id]", box).forEach(d => d.onclick = () => { $$("[data-id]", box).forEach(x => x.classList.remove("sel")); d.classList.add("sel"); sel = +d.dataset.id; $("#ok", m).disabled = false; });
      } catch (e) { fail(e); }
    }, 220);
  };
  $("#nueva", m).onclick = () => {
    modoNueva = true; sel = null;
    $("#paso1", m).style.display = "none";
    const t = q.value.trim(), digits = /^\d+$/.test(t);
    $("#paso2", m).style.display = "block";
    $("#paso2", m).innerHTML = `<h3 style="margin-bottom:10px">Paciente nueva — datos de admisión</h3>` + formAdmision({ cedula: digits ? t : "", apellidos: digits ? "" : t.toUpperCase() }, true) +
      `<button class="btn sm ghost" id="volver" style="margin-top:8px">‹ Volver a buscar</button>`;
    bindAdmision($("#paso2", m));
    $("#volver", m).onclick = () => { modoNueva = false; $("#paso2", m).style.display = "none"; $("#paso1", m).style.display = "block"; $("#ok", m).disabled = !sel; };
    $("#ok", m).disabled = false; $("#ok", m).textContent = "Registrar paciente y asignar turno";
  };
  $("#ok", m).onclick = async () => {
    const btn = $("#ok", m); btn.disabled = true;
    try {
      let pid = sel;
      if (modoNueva) {
        const data = leerForm($("#paso2", m));
        data.consentimiento_datos = data.consentimiento_datos ? new Date().toLocaleString("es-EC") : "";
        pid = (await api("POST", "pacientes", data)).id;
      }
      const body = { ...slot, paciente_id: pid, motivo: leerMotivo(m) };
      if ($("#hora", m)) body.hora = $("#hora", m).value || slot.hora;
      let res;
      try { res = await api("POST", "turnos", body); }
      catch (e) {
        if (/ya tiene turno/.test(e.message) && await confirmar(e.message + " ¿Agendar otro turno de todas formas?")) res = await api("POST", "turnos", { ...body, forzar: true });
        else throw e;
      }
      m.close(); toast("Turno asignado"); done && done();
      if (res && res.consentimientos && res.consentimientos.length) documentosParaFirmar(pid, res.consentimientos, done);
    } catch (e) { fail(e); btn.disabled = false; }
  };
}

/* --- formulario de admisión (Formulario 001) --- */
const OPC = {
  sexo: [["F", "Femenino"], ["M", "Masculino"]],
  estado_civil: ["Soltera/o", "Casada/o", "Unión de hecho", "Divorciada/o", "Viuda/o"],
  instruccion: ["Ninguna", "Primaria", "Secundaria / Bachillerato", "Superior", "Cuarto nivel"],
  etnia: ["Mestiza", "Indígena", "Afroecuatoriana", "Montubia", "Blanca", "Otra"],
  seguro: ["Ninguno", "IESS", "ISSFA", "ISSPOL", "Seguro privado"],
  grupo_sanguineo: ["", "O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"],
  tipo_doc: [["cedula", "Cédula"], ["pasaporte", "Pasaporte / otro"]],
};
const sel = (name, opts, v) => `<select name="${name}">${opts.map(o => { const [k, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(k)}" ${String(v ?? "") === String(k) ? "selected" : ""}>${esc(l || "—")}</option>`; }).join("")}</select>`;
const inp = (name, label, v, extra = "", req) => `<label class="f ${extra.includes("span") ? extra : ""}"><span>${label}${req ? ' <i class="req">*</i>' : ""}</span><input name="${name}" value="${esc(v ?? "")}" ${extra.includes("span") ? "" : extra}></label>`;
const ta = (name, label, v, cls = "spanall", rows = 2) => `<label class="f ${cls}"><span>${label}</span><textarea name="${name}" rows="${rows}">${esc(v ?? "")}</textarea></label>`;
const fsel = (name, label, opts, v, cls = "") => `<label class="f ${cls}"><span>${label}</span>${sel(name, opts, v)}</label>`;

function formAdmision(p, nuevo) {
  return `<div class="grid g4">
    ${fsel("tipo_doc", "Documento", OPC.tipo_doc, p.tipo_doc || "cedula")}
    <label class="f"><span>N.º cédula / documento <i class="req">*</i></span><input name="cedula" value="${esc(p.cedula || "")}" maxlength="20"><small class="muted" data-cedmsg></small></label>
    ${inp("apellidos", "Apellidos", p.apellidos, 'style="text-transform:uppercase"', 1)}
    ${inp("nombres", "Nombres", p.nombres, 'style="text-transform:uppercase"', 1)}
    <label class="f"><span>Fecha de nacimiento <i class="req">*</i></span><input type="date" name="fecha_nac" value="${esc(p.fecha_nac || "")}"></label>
    ${fsel("sexo", "Sexo", OPC.sexo, p.sexo || "F")}
    ${inp("telefono", "Celular / teléfono", p.telefono, "", 1)}
    ${inp("email", "Correo electrónico", p.email)}
    ${nuevo ? "" : `${fsel("estado_civil", "Estado civil", ["", ...OPC.estado_civil], p.estado_civil)}
    ${fsel("instruccion", "Instrucción", ["", ...OPC.instruccion], p.instruccion)}
    ${inp("ocupacion", "Ocupación", p.ocupacion)}
    ${inp("nacionalidad", "Nacionalidad", p.nacionalidad || "Ecuatoriana")}
    ${fsel("etnia", "Autoidentificación étnica", ["", ...OPC.etnia], p.etnia)}
    ${fsel("seguro", "Seguro de salud", OPC.seguro, p.seguro || "Ninguno")}`}
    ${inp("direccion", "Dirección domiciliaria", p.direccion, "span2")}
    ${nuevo ? "" : `${inp("parroquia", "Parroquia", p.parroquia)}${inp("canton", "Cantón", p.canton || "Riobamba")}
    ${inp("provincia", "Provincia", p.provincia || "Chimborazo")}
    ${inp("contacto_nombre", "En caso de emergencia avisar a", p.contacto_nombre)}
    ${inp("contacto_parentesco", "Parentesco", p.contacto_parentesco)}
    ${inp("contacto_telefono", "Teléfono de contacto", p.contacto_telefono)}
    ${inp("empresa", "Institución / empresa donde trabaja", p.empresa)}
    ${inp("puesto", "Puesto de trabajo", p.puesto)}
    ${inp("hc_numero", "N.º historia clínica física (si tiene)", p.hc_numero)}`}
  </div>
  ${nuevo || !isClin() ? antecedentesBasicos(p) : ""}
  ${nuevo || !p.consentimiento_datos ? `<label class="chk" style="margin-top:14px"><input type="checkbox" name="consentimiento_datos" value="1">
    <span class="small">La paciente <b>autoriza</b> al Instituto de Salud Integral de la Mujer el tratamiento de sus datos personales y de salud, con fines exclusivamente asistenciales y de su historia clínica, conforme a la Ley Orgánica de Protección de Datos Personales. Se le informó que puede acceder, rectificar y solicitar copia de su información. <i class="req">*</i></span></label>`
    : `<div class="small muted" style="margin-top:10px">✓ Consentimiento de tratamiento de datos registrado: ${esc(p.consentimiento_datos)}</div>`}`;
}
function antecedentesBasicos(p) {
  const campo = (name, label, ph) => `<label class="f"><span>${label} <a href="#" class="small" data-nr="${name}" style="text-transform:none;letter-spacing:0;float:right">No refiere</a></span>
    <textarea name="${name}" rows="2" placeholder="${ph}">${esc(p[name] || "")}</textarea></label>`;
  return `<h3 style="margin:16px 0 8px;font-size:13px">Antecedentes de salud</h3><div class="grid g3">
    ${campo("alergias", "¿Alergias?", "Ej.: penicilina, AINES, látex…")}
    ${campo("ant_personales", "¿Enfermedades previas?", "Ej.: hipertensión, diabetes, hipotiroidismo…")}
    ${campo("ant_quirurgicos", "¿Operaciones / cirugías?", "Ej.: cesárea 2019, apendicectomía…")}</div>`;
}
function bindAdmision(box) {
  $$("[data-nr]", box).forEach(a => a.onclick = e => { e.preventDefault(); $(`[name=${a.dataset.nr}]`, box).value = "No refiere"; });
  const c = $("[name=cedula]", box), t = $("[name=tipo_doc]", box), msg = $("[data-cedmsg]", box);
  const chk = () => { if (t.value !== "cedula" || !c.value) { msg.textContent = ""; return; } msg.textContent = cedulaOk(c.value.trim()) ? "✓ cédula válida" : "✗ cédula no válida"; msg.style.color = cedulaOk(c.value.trim()) ? "var(--green)" : "var(--red)"; };
  c.oninput = chk; t.onchange = chk; chk();
}
function leerForm(box) {
  const o = {};
  $$("input[name],select[name],textarea[name]", box).forEach(el => {
    if (el.type === "checkbox") o[el.name] = el.checked ? (el.value || 1) : (el.dataset.off ?? "");
    else if (el.type === "radio") { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  });
  return o;
}

/* =====================================================================
   AGENDA
   ===================================================================== */
async function vAgenda(m, r) {
  const f = r.q.f || today();
  m.innerHTML = dateBar(f, "#/agenda", `<div class="ac" style="width:320px"><input id="buscaP" placeholder="Buscar cualquier paciente (nombre o cédula)…" autocomplete="off"><div class="ac-list" id="acP" style="display:none"></div></div>`) + `<div id="aw" class="empty">Cargando…</div>`;
  bindDateBar(m, f, "#/agenda");
  buscadorPaciente($("#buscaP", m), $("#acP", m), p => go(`#/paciente/${p.id}?tab=${isClin() ? "historia" : tabInicial()}`));
  let ts;
  try { ts = await api("GET", "turnos?fecha=" + f); } catch (e) { return fail(e); }
  ts.sort((a, b) => (a.hora > b.hora ? 1 : a.hora < b.hora ? -1 : a.cupo - b.cupo));
  const resumen = Object.keys(ESTADOS).map(k => `<span class="badge ${k === "atendido" ? "green" : k === "noasistio" ? "grey" : k === "espera" ? "new" : ""}">${ESTADOS[k]}: ${ts.filter(t => t.estado === k).length}</span>`).join(" ");
  const aw = $("#aw", m); aw.className = "";
  aw.innerHTML = !ts.length ? `<div class="card empty">No hay pacientes agendadas para este día.<br><a href="#/turnos?f=${f}">Ir a Turnos para asignar</a></div>` :
    `<div class="row" style="margin-bottom:10px">${resumen}<span class="grow"></span><span class="muted small">${ts.length} paciente(s)</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Hora</th><th>Tipo</th><th>Paciente</th><th>Cédula</th><th>Edad</th><th>Motivo</th><th>Estado</th><th>Consulta</th></tr></thead><tbody>
    ${ts.map(t => `<tr class="click" data-go="#/paciente/${t.paciente_id}?t=${t.id}&tab=${tabInicial()}">
      <td><b>${hm12(t.hora)}</b></td>
      <td>${t.tipo === "normal" ? `<span class="small muted">Cupo ${t.cupo}</span>` : t.tipo === "emergencia" ? `<span class="badge red">Emergencia</span>` : `<span class="badge new">Extra</span>`}</td>
      <td><b>${esc(t.apellidos)} ${esc(t.nombres)}</b> ${t.nota_importante ? `<span class="badge red" title="${esc(t.nota_importante)}">⚠ ${esc(t.nota_importante.length > 34 ? t.nota_importante.slice(0, 34) + "…" : t.nota_importante)}</span>` : ""} ${t.n_consultas === 0 ? `<span class="badge new">1.ª vez</span>` : ""} ${t.ci_pendientes ? `<span class="badge red">✍ ${t.ci_pendientes} por firmar</span>` : ""}</td>
      <td>${esc(t.cedula)}</td><td>${t.fecha_nac ? edad(t.fecha_nac, f) : ""}</td>
      <td class="small">${esc(t.motivo)}</td>
      <td><span class="badge ${t.estado === "atendido" ? "green" : t.estado === "noasistio" ? "grey" : t.estado === "espera" ? "new" : ""}">${ESTADOS[t.estado] || t.estado}</span></td>
      <td>${t.consulta_estado === "cerrada" ? `<span class="badge green">Firmada</span>` : t.consulta_estado ? `<span class="badge new">Borrador</span>` : `<span class="muted small">—</span>`}</td>
    </tr>`).join("")}</tbody></table></div>`;
  $$("[data-go]", aw).forEach(tr => tr.onclick = () => go(tr.dataset.go));
}

function buscadorPaciente(input, list, onPick) {
  let tmr;
  input.oninput = () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const t = input.value.trim();
      if (t.length < 2) { list.style.display = "none"; return; }
      const rs = await api("GET", "pacientes?q=" + encodeURIComponent(t)).catch(fail) || [];
      list.style.display = "block";
      list.innerHTML = rs.length ? rs.map((p, i) => `<div data-i="${i}"><b>${esc(p.apellidos)} ${esc(p.nombres)}</b> <span class="muted small">CI ${esc(p.cedula)}</span></div>`).join("") : `<div class="muted">Sin resultados</div>`;
      $$("[data-i]", list).forEach(d => d.onmousedown = () => { list.style.display = "none"; onPick(rs[+d.dataset.i]); });
    }, 220);
  };
  input.onblur = () => setTimeout(() => list.style.display = "none", 150);
}

/* =====================================================================
   FICHA DE PACIENTE
   ===================================================================== */
const TABS = [["datos", "Datos de la paciente"], ["historia", "Historia clínica"], ["consulta", "Consulta del día"], ["receta", "Receta"], ["examenes", "Exámenes"], ["pedidos", "Pedidos"], ["consentimientos", "Consentimientos"], ["certificados", "Certificados"]];

async function vPaciente(m, r) {
  const pid = +r.parts[1];
  let tab = r.q.tab || "datos";
  if (!puedeTab(tab)) tab = "datos";
  m.innerHTML = `<div class="empty">Cargando…</div>`;
  let P, turno = null, consulta = null;
  try {
    P = await api("GET", "pacientes/" + pid);
    // turno: el indicado o el de hoy
    if (r.q.t) {
      const t1 = await api("GET", "turnos/" + r.q.t).catch(() => null);
      turno = t1 && t1.id && t1.paciente_id === pid ? t1 : null;
    }
    if (!turno) {
      const th = await api("GET", "turnos?fecha=" + today());
      turno = th.find(x => x.paciente_id === pid) || null;
    }
    if (turno && S.user.rol !== "enfermeria") { const c = await api("GET", "consultas?turno=" + turno.id); consulta = c && c.id ? c : null; }
  } catch (e) { m.innerHTML = ""; return fail(e); }
  const ctx = { P, turno, consulta, pid, r, reload: () => vPaciente(m, r) };
  const qs = t => `#/paciente/${pid}?${turno ? "t=" + turno.id + "&" : ""}tab=${t}`;
  const nota = (P.nota_importante || "").trim();
  m.innerHTML = `
    ${nota ? `<div class="nota-imp"><span class="ic">⚠</span><div class="grow"><b>NOTA IMPORTANTE</b><div class="tx">${esc(nota)}</div></div>${isClin() ? `<button class="btn sm" id="editNota">Editar</button>` : ""}</div>`
      : isClin() ? `<div class="nota-imp vacia"><span class="ic">＋</span><span class="grow">Sin nota importante. Agregue aquí lo que el médico debe tener presente siempre (p. ej. hipertensa, anticoagulada, embarazo de alto riesgo).</span><button class="btn sm" id="editNota">Agregar nota</button></div>` : ""}
    <div class="phead">
      <button class="btn ghost" onclick="history.back()">‹</button>
      <div class="avatar">${esc((P.apellidos[0] || "") + (P.nombres[0] || ""))}</div>
      <div class="grow">
        <div class="nm">${esc(P.apellidos)} ${esc(P.nombres)}</div>
        <div class="small muted">CI ${esc(P.cedula)} · ${P.fecha_nac ? edad(P.fecha_nac) + " años" : "edad no registrada"} · HC N.º ${esc(P.cedula)}${P.telefono ? " · ☎ " + esc(P.telefono) : ""}</div>
      </div>
      ${isClin() ? `<span class="alerg" style="${P.alergias ? "" : "background:#eef0f3;color:var(--muted)"}">Alergias: ${esc(P.alergias || "no registradas")}</span>` : ""}
      ${turno ? `<div class="right small"><b>Turno ${fmtD(turno.fecha)} · ${hm12(turno.hora)}</b><br><span class="muted">${esc(turno.motivo || "")}</span></div>` : ""}
    </div>
    <nav class="tabs">${TABS.filter(([k]) => puedeTab(k)).map(([k, l]) => `<a href="${qs(k)}" class="${k === tab ? "on" : ""} ${!puedeTab(k) ? "locked" : ""}">${l}${k === "consentimientos" && turno && turno.ci_pendientes ? ` <span class="badge red">${turno.ci_pendientes}</span>` : ""}</a>`).join("")}</nav>
    <div id="tab"></div>`;
  const box = $("#tab", m);
  const en = $("#editNota", m);
  if (en) en.onclick = () => {
    const md = modal("Nota importante de la paciente", `<div class="info small" style="margin-bottom:10px">Se muestra arriba en todas las pestañas de la paciente y en la Agenda. Escriba solo lo que el médico debe tener presente siempre.</div>
      <textarea id="nti" rows="4" placeholder="Ej.: HIPERTENSA en tratamiento con losartán. Alérgica a penicilina.">${esc(nota)}</textarea>`,
      `${nota ? `<button class="btn danger" id="del" style="margin-right:auto">Quitar nota</button>` : ""}<button class="btn" data-c>Cancelar</button><button class="btn pri" id="sv">Guardar</button>`);
    $("[data-c]", md).onclick = md.close;
    const guardar = async v => { try { await api("PUT", "pacientes/" + pid, { nota_importante: v }); md.close(); toast("Nota guardada"); vPaciente(m, r); } catch (e) { fail(e); } };
    $("#sv", md).onclick = () => guardar($("#nti", md).value.trim());
    if (nota) $("#del", md).onclick = () => guardar("");
    $("#nti", md).focus();
  };
  ({ datos: tDatos, historia: tHistoria, consulta: tConsulta, receta: tReceta, examenes: tExamenes, pedidos: tPedidos, consentimientos: tConsentimientos, certificados: tCertificados }[tab] || tDatos)(box, ctx);
}

/* ---------- Datos ---------- */
function tDatos(box, { P, reload }) {
  box.innerHTML = `<form id="fd">
    <div class="sec"><h3><span class="n">1</span>Datos de identificación y contacto (Admisión)</h3><div class="b">${formAdmision(P, false)}</div></div>
    ${isClin() ? `
    <div class="sec"><h3><span class="n">2</span>Antecedentes personales</h3><div class="b grid g3">
      ${ta("alergias", "Alergias (medicamentos, alimentos, otros)", P.alergias, "")}
      ${fsel("grupo_sanguineo", "Grupo sanguíneo y factor", OPC.grupo_sanguineo, P.grupo_sanguineo)}
      ${ta("medicacion_habitual", "Medicación habitual", P.medicacion_habitual, "")}
      ${ta("ant_personales", "Antecedentes patológicos personales (clínicos)", P.ant_personales, "")}
      ${ta("ant_quirurgicos", "Antecedentes quirúrgicos", P.ant_quirurgicos, "")}
      ${ta("ant_familiares", "Antecedentes patológicos familiares", P.ant_familiares, "")}
      ${ta("habitos", "Hábitos (tabaco, alcohol, actividad física)", P.habitos, "")}
    </div></div>
    <div class="sec"><h3><span class="n">3</span>Antecedentes gineco-obstétricos</h3><div class="b grid g6">
      ${inp("menarquia", "Menarquia (edad)", P.menarquia)}${inp("ciclos", "Ciclos (días/duración)", P.ciclos)}
      <label class="f"><span>FUM</span><input type="date" name="fum" value="${esc(P.fum || "")}"></label>
      ${inp("ivsa", "IVSA (edad)", P.ivsa)}${inp("parejas", "N.º parejas sexuales", P.parejas)}${inp("mac", "Método anticonceptivo", P.mac)}
      ${inp("gestas", "Gestas", P.gestas)}${inp("partos", "Partos", P.partos)}${inp("cesareas", "Cesáreas", P.cesareas)}
      ${inp("abortos", "Abortos", P.abortos)}${inp("hijos_vivos", "Hijos vivos", P.hijos_vivos)}<span></span>
      ${inp("ultimo_pap", "Último Papanicolaou (fecha/resultado)", P.ultimo_pap, "span3")}${inp("ultima_mamografia", "Última mamografía / eco mamaria", P.ultima_mamografia, "span3")}
    </div></div>` : ""}
    <div class="sec"><h3><span class="n">${isClin() ? 4 : 2}</span>Observaciones</h3><div class="b">${ta("observaciones", "Observaciones administrativas", P.observaciones)}</div></div>
    <div class="row"><span class="muted small grow">Registrada: ${esc(P.creado || "")}${P.actualizado ? " · Última actualización: " + esc(P.actualizado) : ""}</span><button class="btn pri">Guardar cambios</button></div>
  </form>`;
  bindAdmision(box);
  $("#fd").onsubmit = async e => {
    e.preventDefault();
    const d = leerForm(e.target);
    if ("consentimiento_datos" in d) { if (d.consentimiento_datos) d.consentimiento_datos = new Date().toLocaleString("es-EC"); else delete d.consentimiento_datos; }
    try { await api("PUT", "pacientes/" + P.id, d); toast("Datos guardados"); reload(); } catch (er) { fail(er); }
  };
}

/* ---------- Historia clínica ---------- */
async function tHistoria(box, { P, pid }, sel) {
  if (!isClin()) return tHistoriaResumen(box, P);
  if (sel == null) box.innerHTML = `<div class="empty">Cargando…</div>`;
  const hc = await api("GET", "historia/" + pid).catch(fail) || [];
  const resumen = `<div class="card" style="margin-bottom:14px"><div class="row"><h3 class="grow">Resumen de antecedentes</h3><span class="small muted">${hc.filter(c => c.estado === "cerrada").length} consulta(s) firmada(s)</span></div>
    <div class="kv">
      <dt>Alergias</dt><dd>${esc(P.alergias || "—")}</dd>
      <dt>Antecedentes personales</dt><dd>${esc(P.ant_personales || "—")}</dd>
      <dt>Quirúrgicos</dt><dd>${esc(P.ant_quirurgicos || "—")}</dd>
      <dt>Familiares</dt><dd>${esc(P.ant_familiares || "—")}</dd>
      <dt>Gineco-obstétricos</dt><dd>${esc(agoTxt(P) || "—")}</dd>
    </div></div>`;
  if (!hc.length) { box.innerHTML = resumen + `<div class="card empty">Todavía no hay consultas registradas para esta paciente.</div>`; return; }
  const peds = await api("GET", "pedidos?paciente=" + pid).catch(() => []);
  const selId = sel ?? hc[0].id;
  const c = hc.find(x => x.id === selId) || hc[0];
  const d = c.datos || {};
  const pedDia = peds.filter(p => p.fecha === c.fecha);
  box.innerHTML = resumen + `
    <div class="subtabs">${hc.map(x => `<button class="st ${x.id === c.id ? "on" : ""}" data-st="${x.id}">
      <b>${fmtD(x.fecha)}</b><span>${esc(x.sin_consulta ? "Receta sin consulta" : (((x.datos.diagnosticos || [])[0] || {}).desc || x.datos.motivo || "Sin diagnóstico").slice(0, 34))}</span>
      ${x.estado === "cerrada" || x.sin_consulta ? "" : `<i class="dot" title="Borrador"></i>`}</button>`).join("")}</div>
    <div class="hc-item" style="border-top-left-radius:0">
      <header style="cursor:default"><span class="d">${longD(c.fecha)}</span><span class="grow"></span>
        ${c.sin_consulta ? `<span class="badge grey">Sin consulta registrada</span>` : c.estado === "cerrada" ? `<span class="badge green">Firmada</span>` : `<span class="badge new">Borrador</span>`}
        <span class="muted small">Médico: ${esc(c.medico || "")}</span></header>
      <div class="body">
        ${consultaKV(d)}
        ${c.recetas.map(rx => `<div class="card" style="margin-top:12px;background:#fafcfb"><div class="row"><b class="grow">Receta N.º ${rx.numero}${rx.datos.para_pareja ? " — tratamiento para la pareja" : ""}${rx.anulada ? ' <span class="badge red">ANULADA</span>' : ""}</b><button class="btn sm" data-rx="${rx.id}">Reimprimir</button></div>
          <ol style="margin:8px 0 0;padding-left:18px">${rx.datos.items.map(it => `<li><b>${esc(it.comercial || it.generico)}</b> <span class="muted">(${esc(it.generico)})</span> — #${esc(it.cantidad)} ${esc(it.unidad || "")}: ${esc(it.indicacion)}</li>`).join("")}</ol>
          ${rx.datos.recomendaciones ? `<div class="small muted" style="margin-top:6px;white-space:pre-wrap">${esc(rx.datos.recomendaciones)}</div>` : ""}</div>`).join("")}
        ${pedDia.length ? `<div class="card" style="margin-top:12px;background:#fafcfb"><b>Pedidos emitidos ese día</b>${pedDia.map(p => `<div class="row" style="margin-top:6px"><span class="grow small"><b>${esc(PED[p.tipo]?.t || p.tipo)}</b> — ${esc(resumenPedido(p).slice(0, 110))}</span><button class="btn sm" data-pp="${p.id}">Reimprimir</button></div>`).join("")}</div>` : ""}
        ${c.notas.map(n => `<div class="note"><b>Nota aclaratoria · ${esc(n.fecha)} · ${esc(n.usuario)}</b><br>${esc(n.texto)}</div>`).join("")}
        <div class="row" style="margin-top:12px"><span class="small muted grow">${c.sin_consulta ? "Receta emitida sin consulta registrada en el sistema" : c.estado === "cerrada" ? "Firmada electrónicamente el " + esc(c.cerrada_en) : "Consulta en borrador (sin firmar)"}</span>
          ${c.estado === "cerrada" ? `<button class="btn sm" data-nota="${c.id}">＋ Nota aclaratoria</button>` : ""}
          ${c.sin_consulta ? "" : `<button class="btn sm" data-print="${c.id}">Imprimir consulta</button>`}</div>
      </div></div>`;
  $$("[data-st]", box).forEach(b => b.onclick = () => tHistoria(box, { P, pid }, +b.dataset.st));
  $$("[data-pp]", box).forEach(b => b.onclick = async () => imprimirPedido(await api("GET", "pedidos/" + b.dataset.pp), P));
  $$("[data-rx]", box).forEach(b => b.onclick = () => imprimirReceta(+b.dataset.rx, P));
  $$("[data-print]", box).forEach(b => b.onclick = () => imprimirConsulta(hc.find(c => c.id === +b.dataset.print), P));
  $$("[data-nota]", box).forEach(b => b.onclick = () => {
    const md = modal("Nota aclaratoria", `<div class="info small" style="margin-bottom:10px">La consulta firmada no se modifica. La nota queda registrada con fecha, hora y usuario.</div><textarea id="nt" rows="5"></textarea>`, `<button class="btn" data-c>Cancelar</button><button class="btn pri" id="sv">Guardar nota</button>`);
    $("[data-c]", md).onclick = md.close;
    $("#sv", md).onclick = async () => { try { await api("POST", `consultas/${b.dataset.nota}/nota`, { texto: $("#nt", md).value }); md.close(); tHistoria(box, { P, pid }, +b.dataset.nota); } catch (e) { fail(e); } };
  });
}
function agoTxt(P) {
  const p = [];
  if (P.menarquia) p.push("Menarquia " + P.menarquia);
  if (P.ciclos) p.push("Ciclos " + P.ciclos);
  const g = ["gestas", "partos", "cesareas", "abortos", "hijos_vivos"].map(k => P[k]);
  if (g.some(Boolean)) p.push(`G${P.gestas || 0} P${P.partos || 0} C${P.cesareas || 0} A${P.abortos || 0} HV${P.hijos_vivos || 0}`);
  if (P.fum) p.push("FUM " + fmtD(P.fum));
  if (P.ivsa) p.push("IVSA " + P.ivsa);
  if (P.mac) p.push("MAC " + P.mac);
  if (P.ultimo_pap) p.push("PAP " + P.ultimo_pap);
  return p.join(" · ");
}
const CAMPOS_CONSULTA = [
  ["motivo", "Motivo de consulta"], ["enfermedad_actual", "Enfermedad o problema actual"], ["ros", "Revisión actual de órganos y sistemas"],
  ["_vitales", "Signos vitales y antropometría"], ["_obst", "Control obstétrico"], ["examen_fisico", "Examen físico general"],
  ["examen_gineco", "Examen ginecológico / mamario"], ["_dx", "Diagnósticos"], ["plan", "Plan diagnóstico y terapéutico"],
  ["indicaciones", "Indicaciones / educación"], ["proxima_cita", "Próxima cita"]];
function vitalesTxt(d) {
  const p = [];
  if (d.pa_sis || d.pa_dia) p.push(`PA ${d.pa_sis || "-"}/${d.pa_dia || "-"} mmHg`);
  if (d.fc) p.push(`FC ${d.fc} lpm`); if (d.fr) p.push(`FR ${d.fr} rpm`); if (d.temp) p.push(`T° ${d.temp} °C`);
  if (d.sat) p.push(`SatO₂ ${d.sat}%`); if (d.peso) p.push(`Peso ${d.peso} kg`); if (d.talla) p.push(`Talla ${d.talla} cm`);
  if (d.peso && d.talla) p.push(`IMC ${(d.peso / ((d.talla / 100) ** 2)).toFixed(1)}`);
  return p.join(" · ");
}
function obstTxt(d) {
  if (!d.embarazo) return "";
  const p = [];
  if (d.fum) p.push("FUM " + fmtD(d.fum)); if (d.eg) p.push("EG " + d.eg); if (d.fpp) p.push("FPP " + fmtD(d.fpp));
  if (d.au) p.push("AU " + d.au + " cm"); if (d.fcf) p.push("FCF " + d.fcf + " lpm"); if (d.mov) p.push("Mov. fetales: " + d.mov);
  if (d.presentacion) p.push("Presentación: " + d.presentacion); if (d.edemas) p.push("Edemas: " + d.edemas);
  return p.join(" · ");
}
function consultaKV(d) {
  return `<dl class="kv">${CAMPOS_CONSULTA.map(([k, l]) => {
    let v = k === "_vitales" ? vitalesTxt(d) : k === "_obst" ? obstTxt(d) : k === "_dx" ? (d.diagnosticos || []).map(x => `${x.cie} ${x.desc} (${x.tipo})`).join("\n") : k === "proxima_cita" ? fmtD(d[k]) : d[k];
    return v ? `<dt>${l}</dt><dd>${esc(v)}</dd>` : "";
  }).join("")}</dl>`;
}

/* ---------- Consulta del día (Formulario 002) ---------- */
function sinTurno(box, ctx, que) {
  box.innerHTML = `<div class="card empty">Esta paciente no tiene turno para hoy, por eso no hay ${que}.<br><br>
    <button class="btn pri" id="mk">＋ Crear turno extra ahora y abrir consulta</button></div>`;
  $("#mk", box).onclick = async () => {
    try {
      const h = nowHM(), jornada = +h.slice(0, 2) < 13 ? "manana" : "tarde";
      const r = await api("POST", "turnos", { fecha: today(), hora: h, jornada, tipo: "extra", cupo: 1, paciente_id: ctx.pid, motivo: "" });
      go(`#/paciente/${ctx.pid}?t=${r.id}&tab=consulta`);
    } catch (e) { fail(e); }
  };
}
function tConsulta(box, ctx) {
  const { P, turno, consulta } = ctx;
  if (!turno) return sinTurno(box, ctx, "consulta del día");
  const d = Object.assign({ fum: P.fum || "", diagnosticos: [] }, consulta?.datos || {});
  const cerrada = consulta?.estado === "cerrada";
  if (cerrada) {
    box.innerHTML = `<div class="card"><div class="row"><h2 class="grow">Consulta del ${fmtD(consulta.fecha)}</h2><span class="badge green">Firmada ${esc(consulta.cerrada_en)}</span>
      <button class="btn sm" id="pr">Imprimir</button><a class="btn sm pri" href="#/paciente/${P.id}?t=${turno.id}&tab=receta">Ir a receta ›</a></div>${consultaKV(d)}
      <div class="info small" style="margin-top:14px">La consulta firmada ya no se puede modificar (integridad de la historia clínica). Para corregir o completar, añada una nota aclaratoria desde la pestaña Historia clínica.</div></div>`;
    $("#pr", box).onclick = () => imprimirConsulta({ ...consulta, datos: d }, P);
    return;
  }
  const fe = turno.fecha;
  if (turno.ci_pendientes) setTimeout(() => {
    const f0 = $("#fc", box); if (!f0) return;
    f0.insertAdjacentHTML("afterbegin", `<div class="warn" style="margin-bottom:12px">✍ Esta paciente tiene <b>${turno.ci_pendientes} consentimiento(s) pendiente(s) de firma</b>. Explíquelos y hágalos firmar antes del procedimiento. <a href="#/paciente/${P.id}?t=${turno.id}&tab=consentimientos">Ver consentimientos ›</a></div>`);
  }, 0);
  box.innerHTML = `<form id="fc">
    <div class="row" style="margin-bottom:12px"><h2 class="grow">Consulta externa — ${longD(fe)}</h2>${consulta ? `<span class="badge new">Borrador guardado</span>` : `<span class="badge grey">Nueva</span>`}</div>
    <div class="sec"><h3><span class="n">A</span>Motivo de consulta <i class="req" style="color:var(--red)">*</i></h3><div class="b">${ta("motivo", "Motivo por el que acude la paciente", d.motivo, "spanall", 2)}</div></div>
    <div class="sec"><h3><span class="n">B</span>Antecedentes relevantes (de la ficha)</h3><div class="b small">
      <div class="kv" style="margin-top:0"><dt>Alergias</dt><dd>${esc(P.alergias || "—")}</dd><dt>Personales / quirúrgicos</dt><dd>${esc([P.ant_personales, P.ant_quirurgicos].filter(Boolean).join(" · ") || "—")}</dd><dt>Familiares</dt><dd>${esc(P.ant_familiares || "—")}</dd><dt>Gineco-obstétricos</dt><dd>${esc(agoTxt(P) || "—")}</dd></div>
      <a class="small" href="#/paciente/${P.id}?t=${turno.id}&tab=datos">Editar antecedentes en Datos de la paciente ›</a></div></div>
    <div class="sec"><h3><span class="n">C</span>Enfermedad o problema actual</h3><div class="b">${ta("enfermedad_actual", "Cronología, localización, características, intensidad, causa aparente, síntomas asociados", d.enfermedad_actual, "spanall", 4)}</div></div>
    <div class="sec"><h3><span class="n">D</span>Revisión actual de órganos y sistemas</h3><div class="b">${ta("ros", "", d.ros, "spanall", 2)}</div></div>
    <div class="sec"><h3><span class="n">E</span>Signos vitales y antropometría</h3><div class="b grid g6">
      ${inp("pa_sis", "PA sistólica (mmHg)", d.pa_sis, 'inputmode="numeric"')}${inp("pa_dia", "PA diastólica (mmHg)", d.pa_dia, 'inputmode="numeric"')}
      ${inp("fc", "Frec. cardíaca (lpm)", d.fc)}${inp("fr", "Frec. respiratoria (rpm)", d.fr)}${inp("temp", "Temperatura (°C)", d.temp)}${inp("sat", "Sat. O₂ (%)", d.sat)}
      ${inp("peso", "Peso (kg)", d.peso)}${inp("talla", "Talla (cm)", d.talla)}<label class="f"><span>IMC</span><input id="imc" disabled></label>
    </div></div>
    <div class="sec"><h3><span class="n">F</span>Ginecología / obstetricia</h3><div class="b">
      <div class="grid g6">
        <label class="f"><span>FUM</span><input type="date" name="fum" value="${esc(d.fum || "")}"></label>
        <label class="chk" style="align-self:end;padding-bottom:8px"><input type="checkbox" name="embarazo" value="1" ${d.embarazo ? "checked" : ""}><span>Paciente embarazada</span></label>
      </div>
      <div id="obst" class="grid g6" style="margin-top:12px;${d.embarazo ? "" : "display:none"}">
        <label class="f"><span>Edad gestacional (por FUM)</span><input name="eg" value="${esc(d.eg || "")}"></label>
        <label class="f"><span>FPP</span><input type="date" name="fpp" value="${esc(d.fpp || "")}"></label>
        ${inp("au", "Altura uterina (cm)", d.au)}${inp("fcf", "FCF (lpm)", d.fcf)}${inp("mov", "Movimientos fetales", d.mov)}${inp("presentacion", "Presentación", d.presentacion)}
        ${inp("edemas", "Edemas", d.edemas)}
      </div></div></div>
    <div class="sec"><h3><span class="n">G</span>Examen físico</h3><div class="b grid g2">
      ${ta("examen_fisico", "Examen físico general / regional", d.examen_fisico, "", 4)}
      ${ta("examen_gineco", "Mamas, abdomen, genitales externos, especuloscopia, tacto vaginal", d.examen_gineco, "", 4)}
    </div></div>
    <div class="sec"><h3><span class="n">H</span>Diagnósticos (CIE-10) <i class="req" style="color:var(--red)">*</i></h3><div class="b">
      <div id="dxs"></div>
      <div class="row"><div class="ac grow"><input id="dxq" placeholder="Buscar por código o nombre (ej.: N76, vaginitis, embarazo)…" autocomplete="off"><div class="ac-list" id="dxl" style="display:none"></div></div>
      <button type="button" class="btn" id="dxman">Código manual</button></div>
      <p class="small muted">PRE = presuntivo · DEF = definitivo</p></div></div>
    <div class="sec"><h3><span class="n">I</span>Plan de tratamiento</h3><div class="b grid g2">
      ${ta("plan", "Plan diagnóstico y terapéutico (la receta se emite en la pestaña Receta)", d.plan, "", 3)}
      ${ta("indicaciones", "Indicaciones generales / educación a la paciente", d.indicaciones, "", 3)}
      <label class="f"><span>Próxima cita / control</span><input type="date" name="proxima_cita" value="${esc(d.proxima_cita || "")}"></label>
    </div></div>
    <div class="row" style="position:sticky;bottom:0;background:var(--bg);padding:12px 0;border-top:1px solid var(--line)">
      <span class="small muted grow">Médico: ${esc(S.user.nombre)}. Al firmar, la consulta queda cerrada y ya no se puede modificar.</span>
      <button type="button" class="btn" id="save">Guardar borrador</button>
      <button type="button" class="btn ok" id="firmar">Firmar y cerrar consulta</button>
    </div></form>`;
  const f = $("#fc", box);
  let dx = d.diagnosticos.slice();
  const drawDx = () => {
    $("#dxs", f).innerHTML = dx.map((x, i) => `<span class="dx-chip"><b>${esc(x.cie)}</b>${esc(x.desc)}<select data-dt="${i}"><option ${x.tipo === "PRE" ? "selected" : ""}>PRE</option><option ${x.tipo === "DEF" ? "selected" : ""}>DEF</option></select><button type="button" class="btn sm ghost" data-dr="${i}">✕</button></span>`).join("") || `<p class="small muted">Sin diagnósticos todavía.</p>`;
    $$("[data-dt]", f).forEach(s => s.onchange = () => dx[+s.dataset.dt].tipo = s.value);
    $$("[data-dr]", f).forEach(b => b.onclick = () => { dx.splice(+b.dataset.dr, 1); drawDx(); });
  };
  drawDx();
  cieAutocomplete($("#dxq", f), $("#dxl", f), (c, de) => { dx.push({ cie: c, desc: de, tipo: "PRE" }); drawDx(); });
  $("#dxman", f).onclick = () => {
    const md = modal("Diagnóstico manual", `<div class="grid g3"><label class="f"><span>Código CIE-10</span><input id="mc"></label><label class="f span2"><span>Descripción</span><input id="md"></label></div>`, `<button class="btn pri" id="ok">Agregar</button>`);
    $("#ok", md).onclick = () => { const c = $("#mc", md).value.trim().toUpperCase(), de = $("#md", md).value.trim(); if (c && de) { dx.push({ cie: c, desc: de, tipo: "PRE" }); drawDx(); md.close(); } };
  };
  const upd = () => {
    const p = +$("[name=peso]", f).value, t = +$("[name=talla]", f).value;
    $("#imc", f).value = p && t ? (p / ((t / 100) ** 2)).toFixed(1) : "";
    const emb = $("[name=embarazo]", f).checked;
    $("#obst", f).style.display = emb ? "" : "none";
  };
  $("[name=fum]", f).onchange = () => {
    const g = gestacion($("[name=fum]", f).value, fe);
    if (g) { $("[name=eg]", f).value = g.txt; $("[name=fpp]", f).value = g.fpp; }
  };
  f.oninput = upd; upd();
  const guardar = async cerrar => {
    const datos = leerForm(f); datos.diagnosticos = dx; datos.embarazo = $("[name=embarazo]", f).checked ? 1 : 0;
    if (cerrar && !await confirmar("Al firmar, la consulta queda cerrada en la historia clínica y no podrá modificarse. ¿Firmar ahora?")) return;
    try {
      if (consulta) await api("PUT", "consultas/" + consulta.id, { datos, cerrar });
      else await api("POST", "consultas", { paciente_id: P.id, turno_id: turno.id, fecha: fe, datos, cerrar });
      if (datos.fum && datos.fum !== P.fum) await api("PUT", "pacientes/" + P.id, { fum: datos.fum }).catch(() => { });
      toast(cerrar ? "Consulta firmada" : "Borrador guardado");
      ctx.reload();
    } catch (e) { fail(e); }
  };
  $("#save", f).onclick = () => guardar(false);
  $("#firmar", f).onclick = () => guardar(true);
}
function cieAutocomplete(input, list, onPick) {
  input.oninput = () => {
    const t = input.value.trim().toLowerCase();
    if (t.length < 2) { list.style.display = "none"; return; }
    const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const tn = norm(t);
    const rs = CIE10.filter(([c, d]) => c.toLowerCase().startsWith(t) || norm(d).includes(tn)).slice(0, 15);
    list.style.display = "block";
    list.innerHTML = rs.length ? rs.map(([c, d], i) => `<div data-i="${i}"><b>${c}</b> ${esc(d)}</div>`).join("") : `<div class="muted">No está en la lista frecuente — use "Código manual"</div>`;
    $$("[data-i]", list).forEach(el => el.onmousedown = e => { e.preventDefault(); const [c, d] = rs[+el.dataset.i]; onPick(c, d); input.value = ""; list.style.display = "none"; });
  };
  input.onblur = () => setTimeout(() => list.style.display = "none", 150);
}

/* ---------- Receta ---------- */
async function cargarCatalogos(force) {
  if (!S.meds || force) S.meds = await api("GET", "medicamentos");
  if (!S.esquemas || force) S.esquemas = await api("GET", "esquemas");
}
async function tReceta(box, ctx) {
  const { P, turno, consulta } = ctx;
  if (!turno) return sinTurno(box, ctx, "receta del día");
  await cargarCatalogos();
  const medSel = await selectMedico(consulta);
  const dxs = consulta?.datos?.diagnosticos || [];
  const rx = { diagnostico: dxs.map(x => x.desc).join(" / "), cie: dxs.map(x => x.cie).join(" + "), alergias: P.alergias || "", items: [], recomendaciones: "", para_pareja: 0 };
  const previas = await api("GET", "recetas?paciente=" + P.id).catch(() => []);
  const hoyR = previas.filter(x => consulta ? x.consulta_id === consulta.id : x.turno_id === turno.id);
  box.innerHTML = `
    ${hoyR.length ? `<div class="card" style="margin-bottom:14px"><h3>Recetas emitidas en esta consulta</h3>${hoyR.map(x => `<div class="row" style="margin-top:8px"><span class="grow">N.º ${x.numero} — ${x.datos.items.map(i => esc(i.comercial || i.generico)).join(", ")}${x.datos.para_pareja ? " <span class='badge'>pareja</span>" : ""}</span><button class="btn sm" data-rp="${x.id}">Reimprimir</button></div>`).join("")}</div>` : ""}
    ${consulta && consulta.estado !== "cerrada" && isClin() ? `<div class="warn" style="margin-bottom:14px">La consulta está en borrador. Recuerde firmarla al terminar.</div>` : ""}
    ${!consulta ? `<div class="info small" style="margin-bottom:14px">${isClin() ? "Todavía no hay consulta registrada para este turno. La receta se guardará en la historia clínica con la fecha de hoy." : "La receta se emite a nombre del <b>médico tratante</b> que seleccione, y queda registrado que usted la elaboró."}</div>` : ""}
    <div class="sec"><h3><span class="n">1</span>Datos de la receta</h3><div class="b grid g4">
      ${medSel}
      <div class="ac span2"><label class="f"><span>Diagnóstico</span><input id="rdx" value="${esc(rx.diagnostico)}" autocomplete="off"></label><div class="ac-list" id="rdxl" style="display:none"></div></div>
      <label class="f"><span>CIE-10 (automático)</span><input id="rcie" value="${esc(rx.cie)}"></label>
      <label class="f"><span>Alergias</span><input id="ral" value="${esc(rx.alergias)}" placeholder="Registrar (No refiere solo si se verificó)"></label>
      <label class="f span2"><span>Aplicar esquema del recetario</span><select id="esq"><option value="">— Seleccione un esquema (opcional) —</option>${S.esquemas.map(e => `<option value="${e.id}">${esc(e.nombre)}${e.cie ? " · " + esc(e.cie) : ""}</option>`).join("")}</select></label>
      <label class="chk span2" style="align-self:end;padding-bottom:8px"><input type="checkbox" id="pareja"><span>Tratamiento exclusivo para la <b>pareja</b> (receta complementaria con el nombre de la paciente)</span></label>
    </div></div>
    <div class="sec"><h3><span class="n">2</span>Prescripción</h3><div class="b">
      <div id="items"></div>
      <div class="row"><div class="ac grow"><input id="medq" placeholder="Agregar medicamento: escriba nombre comercial o genérico…" autocomplete="off"><div class="ac-list" id="medl" style="display:none"></div></div>
      <button class="btn" id="libre">＋ Medicamento no catalogado</button></div>
    </div></div>
    <div class="sec"><h3><span class="n">3</span>Recomendaciones</h3><div class="b"><textarea id="rrec" rows="3" placeholder="Una recomendación por línea"></textarea></div></div>
    <div class="row"><span class="grow small muted">La receta incluye nombre genérico (DCI), cantidad en número y letras, indicaciones, firma y registro profesional.</span><button class="btn pri" id="emitir">Guardar e imprimir receta</button></div>`;
  $$("[data-rp]", box).forEach(b => b.onclick = () => imprimirReceta(+b.dataset.rp, P));
  const draw = () => {
    $("#items", box).innerHTML = rx.items.map((it, i) => `<div class="rx-item">
      <div class="num">${i + 1}</div>
      <div class="grid g2" style="gap:8px">
        <label class="f"><span>Nombre comercial</span><input data-k="comercial" data-i="${i}" value="${esc(it.comercial)}"></label>
        <label class="f"><span>Genérico (DCI) y concentración *</span><input data-k="generico" data-i="${i}" value="${esc(it.generico)}"></label>
        <label class="f"><span>Forma farmacéutica · vía</span><input data-k="forma_via" data-i="${i}" value="${esc([it.forma, it.via].filter(Boolean).join(" · "))}"></label>
        <div class="grid" style="grid-template-columns:90px 1fr;gap:8px"><label class="f"><span>Cantidad *</span><input type="number" min="1" data-k="cantidad" data-i="${i}" value="${esc(it.cantidad)}"></label>
        <label class="f"><span>Unidad</span><input data-k="unidad" data-i="${i}" value="${esc(it.unidad)}"></label></div>
      </div>
      <label class="f"><span>Indicaciones (dosis, frecuencia, duración) *</span><textarea rows="4" data-k="indicacion" data-i="${i}">${esc(it.indicacion)}</textarea>
        <small class="muted">#${esc(it.cantidad || "")} (${letras(it.cantidad)}) ${esc(it.unidad || "")}</small></label>
      <button class="btn sm ghost danger x" data-rm="${i}">✕</button>
    </div>`).join("") || `<p class="muted small">Sin medicamentos todavía.</p>`;
    $$("[data-k]", box).forEach(el => el.oninput = () => {
      const it = rx.items[+el.dataset.i];
      if (el.dataset.k === "forma_via") { const [a, ...b] = el.value.split("·"); it.forma = a.trim(); it.via = b.join("·").trim(); }
      else it[el.dataset.k] = el.value;
      if (el.dataset.k === "cantidad" || el.dataset.k === "unidad") el.closest(".rx-item").querySelector("small").textContent = `#${it.cantidad || ""} (${letras(it.cantidad)}) ${it.unidad || ""}`;
    });
    $$("[data-rm]", box).forEach(b => b.onclick = () => { rx.items.splice(+b.dataset.rm, 1); draw(); });
  };
  draw();
  const addMed = m => rx.items.push({ med_id: m.id, comercial: m.comercial, generico: m.generico, forma: m.forma, via: m.via, unidad: m.unidad, cantidad: m.cantidad || "", indicacion: m.indicacion || "" });
  medAutocomplete($("#medq", box), $("#medl", box), m => { addMed(m); draw(); });
  dxAuto(box, "#rdx", "#rcie", "#rdxl");
  $("#libre", box).onclick = () => { rx.items.push({ comercial: "", generico: "", forma: "", via: "", unidad: "", cantidad: "", indicacion: "" }); draw(); };
  $("#esq", box).onchange = e => {
    const es = S.esquemas.find(x => x.id === +e.target.value); if (!es) return;
    rx.items = es.items.map(x => ({ ...x }));
    $("#rrec", box).value = es.recomendaciones || "";
    $("#pareja", box).checked = !!es.para_pareja;
    if (!$("#rdx", box).value && es.diagnostico) { $("#rdx", box).value = es.diagnostico; $("#rcie", box).value = es.cie; }
    draw();
  };
  $("#emitir", box).onclick = async () => {
    const datos = { diagnostico: $("#rdx", box).value, cie: $("#rcie", box).value, alergias: $("#ral", box).value, items: rx.items, recomendaciones: $("#rrec", box).value, para_pareja: $("#pareja", box).checked ? 1 : 0 };
    try {
      const mid = $("[name=medico_id]", box)?.value;
      const r = await api("POST", "recetas", { paciente_id: P.id, consulta_id: consulta ? consulta.id : null, turno_id: turno.id, medico_id: mid ? +mid : null, fecha: turno.fecha, datos });
      if (datos.alergias && datos.alergias !== P.alergias) await api("PUT", "pacientes/" + P.id, { alergias: datos.alergias }).catch(() => { });
      toast("Receta N.º " + r.numero + " guardada en la historia clínica");
      await imprimirReceta(r.id, P);
      ctx.reload();
    } catch (e) { fail(e); }
  };
}
function medAutocomplete(input, list, onPick) {
  input.oninput = () => {
    const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const t = norm(input.value.trim());
    if (t.length < 2) { list.style.display = "none"; return; }
    const rs = S.meds.filter(m => m.activo && (norm(m.comercial).includes(t) || norm(m.generico).includes(t))).slice(0, 15);
    list.style.display = "block";
    list.innerHTML = rs.length ? rs.map((m, i) => `<div data-i="${i}"><b>${esc(m.comercial)}</b> <span class="muted small">${esc(m.generico)} · ${esc(m.forma || "")}</span></div>`).join("") : `<div class="muted">No está en el catálogo. Use "Medicamento no catalogado" o agréguelo en Ajustes.</div>`;
    $$("[data-i]", list).forEach(el => el.onmousedown = e => { e.preventDefault(); onPick(rs[+el.dataset.i]); input.value = ""; list.style.display = "none"; });
  };
  input.onblur = () => setTimeout(() => list.style.display = "none", 150);
}

/* ---------- Exámenes ---------- */
const EXAM = { ecografia: "Informe de ecografía", colposcopia: "Colposcopia", penescopia: "Penescopia", laboratorio: "Exámenes de laboratorio", pap_biopsia: "Resultado Papanicolaou / Biopsia" };
async function tExamenes(box, ctx, filtro = "") {
  const { P } = ctx;
  box.innerHTML = `<div class="empty">Cargando…</div>`;
  const ex = await api("GET", "examenes?paciente=" + P.id).catch(fail) || [];
  const peds = await api("GET", "pedidos?paciente=" + P.id).catch(() => []);
  const pend = peds.filter(p => p.estado !== "resultado" && p.estado !== "sin_resultado");
  const lista = filtro ? ex.filter(e => e.tipo === filtro) : ex;
  const PED_EXAM = { ecografia: "ecografia", colposcopia: "colposcopia", biopsia: "pap_biopsia", laboratorio: "laboratorio" };
  box.innerHTML = `
    ${pend.length ? `<div class="card" style="margin-bottom:14px;border-color:#f0d9a0;background:#fffdf6"><h3 style="margin-bottom:8px">⏳ Pedidos pendientes de resultado (${pend.length})</h3>
      ${pend.map(p => `<div class="row" style="padding:8px 0;border-top:1px solid var(--line)"><span class="badge new">${fmtD(p.fecha)}</span><span class="grow"><b>${esc(PED[p.tipo]?.t || p.tipo)}</b> N.º ${p.numero} <span class="small muted">— ${esc(resumenPedido(p).slice(0, 90))}</span></span>
        <button class="btn sm pri" data-res="${p.id}">⬆ Subir resultado</button>${isClin() || S.user.rol === "recepcion" ? `<button class="btn sm ghost" data-sinr="${p.id}" title="La paciente no se hizo el examen">No se realizó</button>` : ""}</div>`).join("")}</div>` : ""}
    <div class="row" style="margin-bottom:12px"><div class="chips grow" style="margin:0">
      <span class="chip ${!filtro ? "on" : ""}" data-f="">Todos (${ex.length})</span>
      ${Object.entries(EXAM).map(([k, l]) => `<span class="chip ${filtro === k ? "on" : ""}" data-f="${k}">${l} (${ex.filter(e => e.tipo === k).length})</span>`).join("")}
    </div><button class="btn pri" id="nuevo">＋ Subir examen</button></div>
    <div id="fx"></div>
    ${lista.length ? lista.map(e => `<div class="card">
      <div class="row"><span class="badge">${EXAM[e.tipo]}</span>${e.pedido_id ? `<span class="badge green" title="Resultado de un pedido">✓ de pedido</span>` : ""}<b class="grow">${esc(e.titulo || "")}</b><span class="muted small">${fmtD(e.fecha)} · subido por ${esc(e.autor || "")}</span></div>
      ${e.texto ? `<div style="white-space:pre-wrap;margin-top:10px">${esc(e.texto)}</div>` : ""}
      ${e.archivos.length ? `<div class="thumbs">${e.archivos.map(a => `<a href="${fileUrl(a)}" target="_blank" title="${esc(a.nombre)}">${a.mime.startsWith("image/") ? `<img src="${fileUrl(a)}" loading="lazy" alt="">` : `<div class="pdf"><div><b>PDF</b>${esc(a.nombre.slice(0, 26))}</div></div>`}</a>`).join("")}</div>` : ""}
    </div>`).join("") : `<div class="card empty">No hay exámenes ${filtro ? "de este tipo" : ""} registrados.</div>`}`;
  $$("[data-f]", box).forEach(c => c.onclick = () => tExamenes(box, ctx, c.dataset.f));
  $("#nuevo", box).onclick = () => formExamen($("#fx", box), ctx, filtro, () => tExamenes(box, ctx, filtro));
  $$("[data-res]", box).forEach(b => b.onclick = () => {
    const p = peds.find(x => x.id === +b.dataset.res);
    formExamen($("#fx", box), ctx, PED_EXAM[p.tipo], () => tExamenes(box, ctx, filtro), p);
    $("#fx", box).scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $$("[data-sinr]", box).forEach(b => b.onclick = async () => {
    if (!await confirmar("¿Marcar este pedido como no realizado? Ya no aparecerá como pendiente.")) return;
    try { await api("PUT", "pedidos/" + b.dataset.sinr, { estado: "sin_resultado" }); tExamenes(box, ctx, filtro); } catch (e) { fail(e); }
  });
}
function formExamen(fx, ctx, tipo, done, pedido) {
  const files = [];
  fx.innerHTML = `<div class="card" style="margin-bottom:14px;border-color:var(--green-line)"><h3 style="margin-bottom:12px">${pedido ? `Resultado del ${esc((PED[pedido.tipo]?.t || "").toLowerCase())} N.º ${pedido.numero} (${fmtD(pedido.fecha)})` : "Subir examen / resultado"}</h3>
    <div class="grid g4">
      <label class="f"><span>Tipo de examen</span><select id="xt">${Object.entries(EXAM).map(([k, l]) => `<option value="${k}" ${tipo === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f"><span>Fecha del examen</span><input type="date" id="xf" value="${today()}"></label>
      <label class="f span2"><span>Título / descripción corta</span><input id="xti" value="${pedido ? esc(resumenPedido(pedido).slice(0, 80)) : ""}" placeholder="Ej.: Ecografía obstétrica 2.º trimestre · Lab. Clínico X"></label>
      <label class="f spanall"><span>Informe / resultado en texto (opcional si adjunta archivos)</span><textarea id="xtx" rows="6"></textarea></label>
    </div>
    <div class="drop" id="drop" style="margin-top:12px">Arrastre aquí imágenes o PDF, o <u>haga clic para seleccionar</u> (puede subir varios)<input type="file" id="xfl" multiple accept="image/*,application/pdf" style="display:none"></div>
    <div id="xlist" class="small" style="margin-top:8px"></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" id="xc">Cancelar</button><button class="btn pri" id="xs">Guardar examen</button></div></div>`;
  const drop = $("#drop", fx), fl = $("#xfl", fx);
  const showList = () => $("#xlist", fx).innerHTML = files.map((f, i) => `<span class="dx-chip">${esc(f.nombre)} <span class="muted">${(f.size / 1024 / 1024).toFixed(1)} MB</span><button class="btn sm ghost" data-rf="${i}">✕</button></span>`).join("");
  const addFiles = list => {
    [...list].forEach(f => {
      if (!(f.type.startsWith("image/") || f.type === "application/pdf")) return toast(f.name + ": solo imágenes o PDF", true);
      if (f.size > 30 * 1024 * 1024) return toast(f.name + " supera 30 MB", true);
      const rd = new FileReader(); rd.onload = () => { files.push({ nombre: f.name, mime: f.type, data: rd.result, size: f.size }); showList(); bindRm(); }; rd.readAsDataURL(f);
    });
  };
  const bindRm = () => $$("[data-rf]", fx).forEach(b => b.onclick = () => { files.splice(+b.dataset.rf, 1); showList(); bindRm(); });
  drop.onclick = () => fl.click(); fl.onchange = () => addFiles(fl.files);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); };
  $("#xc", fx).onclick = () => fx.innerHTML = "";
  $("#xs", fx).onclick = async () => {
    const b = $("#xs", fx); b.disabled = true; b.textContent = "Subiendo…";
    try {
      await api("POST", "examenes", { paciente_id: ctx.P.id, pedido_id: pedido ? pedido.id : null, tipo: $("#xt", fx).value, fecha: $("#xf", fx).value, titulo: $("#xti", fx).value, texto: $("#xtx", fx).value, archivos: files.map(({ nombre, mime, data }) => ({ nombre, mime, data })) });
      toast("Examen guardado"); done();
    } catch (e) { fail(e); b.disabled = false; b.textContent = "Guardar examen"; }
  };
}

/* ---------- Pedidos ---------- */
const PED = {
  ecografia: { t: "Pedido de ecografía", ic: "◐" },
  colposcopia: { t: "Pedido de colposcopia", ic: "◎" },
  biopsia: { t: "Pedido de análisis de biopsia / citología", ic: "⬡" },
  laboratorio: { t: "Pedido de laboratorio", ic: "⚗" },
};
const ECO_OPC = [["Obstétricas", ["Ecografía obstétrica de 1.er trimestre", "Tamizaje 11–14 semanas (TN)", "Ecografía morfológica (20–24 sem)", "Ecografía obstétrica de crecimiento", "Doppler materno-fetal", "Perfil biofísico", "Cervicometría"]],
["Ginecológicas", ["Ecografía transvaginal", "Ecografía pélvica (abdominal)", "Folículometría", "Ecografía mamaria bilateral"]],
["Otras", ["Ecografía abdominal", "Ecografía renal y de vías urinarias", "Ecografía tiroidea", "Ecografía de partes blandas", "Ecografía testicular / escrotal", "Ecografía de pene / Doppler peneano"]]];
const LAB_OPC = [["Hematología", ["Biometría hemática completa", "Grupo sanguíneo y factor Rh", "Tiempo de protrombina (TP)", "Tiempo de tromboplastina (TTP)", "Plaquetas", "VSG"]],
["Química sanguínea", ["Glucosa en ayunas", "Curva de tolerancia oral a la glucosa (75 g)", "Hemoglobina glicosilada (HbA1c)", "Urea", "Creatinina", "Ácido úrico", "Colesterol total", "HDL", "LDL", "Triglicéridos", "TGO (AST)", "TGP (ALT)", "Bilirrubinas", "Proteínas totales", "Ferritina", "Hierro sérico", "Vitamina D (25-OH)"]],
["Hormonas", ["β-hCG cuantitativa", "β-hCG cualitativa", "TSH", "T4 libre", "T3", "FSH", "LH", "Estradiol", "Progesterona", "Prolactina", "Testosterona total", "Testosterona libre", "DHEA-S", "Hormona antimülleriana (AMH)", "Insulina basal", "Cortisol"]],
["Serología / infecciosas", ["VDRL", "VIH (prueba rápida / ELISA)", "HBsAg (hepatitis B)", "Anti-HCV (hepatitis C)", "Toxoplasma IgG / IgM", "Rubéola IgG / IgM", "Citomegalovirus IgG / IgM", "Herpes 1 y 2 IgG / IgM"]],
["Orina", ["Elemental y microscópico de orina (EMO)", "Urocultivo y antibiograma", "Proteinuria de 24 horas", "Relación proteína/creatinina"]],
["Secreciones", ["Frotis y Gram de secreción vaginal", "Cultivo y antibiograma de secreción vaginal", "KOH", "Cristalografía", "Chlamydia trachomatis", "Neisseria gonorrhoeae", "Mycoplasma / Ureaplasma", "Estreptococo grupo B (35–37 sem)"]],
["Marcadores tumorales", ["CA-125", "CA 19-9", "CA 15-3", "CEA", "AFP"]]];
const COLPO_MOT = ["Citología (PAP) alterada", "VPH de alto riesgo positivo", "Sangrado poscoital", "Lesión cervical visible", "Control post-tratamiento (LEEP / fulguración)", "Control de lesión previa", "Leucorrea persistente"];
const MUESTRAS = ["Biopsia de cérvix (dirigida por colposcopia)", "Cono / asa LEEP", "Legrado endocervical", "Legrado / biopsia de endometrio", "Biopsia de vulva", "Biopsia de vagina", "Pólipo endocervical / endometrial", "Biopsia de pene", "Pieza quirúrgica", "Otra"];
const ESTUDIOS = ["Estudio histopatológico", "Citología cervicovaginal convencional (PAP)", "Citología en base líquida", "Genotipificación de VPH", "Inmunohistoquímica (p16 / Ki-67)"];

function checks(name, grupos) {
  return `<div class="checks">${grupos.map(([g, ops]) => `<div class="grp">${g}</div>${ops.map(o => `<label class="chk"><input type="checkbox" name="${name}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("")}`).join("")}</div>`;
}
async function tPedidos(box, ctx) {
  const { P, consulta } = ctx;
  const dxs = consulta?.datos?.diagnosticos || [];
  const dxTxt = dxs.map(x => x.desc).join(" / "), cieTxt = dxs.map(x => x.cie).join(" + ");
  const g = gestacion(P.fum);
  const comun = `<div class="grid g4" style="margin-bottom:12px">
    <label class="f"><span>Fecha</span><input type="date" name="fecha" value="${today()}"></label>
    <label class="f span2"><span>Diagnóstico presuntivo</span><input name="diagnostico" value="${esc(dxTxt)}"></label>
    <label class="f"><span>CIE-10</span><input name="cie" value="${esc(cieTxt)}"></label></div>`;
  const forms = {
    ecografia: comun + checks("estudios", ECO_OPC) + `<div class="grid g4" style="margin-top:12px">
      <label class="f"><span>Otra ecografía</span><input name="otro"></label>
      <label class="f"><span>FUM</span><input type="date" name="fum" value="${esc(P.fum || "")}"></label>
      <label class="f"><span>Edad gestacional</span><input name="eg" value="${g ? g.txt : ""}"></label>
      <label class="f"><span>Prioridad</span><select name="prioridad"><option>Normal</option><option>Urgente</option></select></label>
      ${ta("datos_clinicos", "Datos clínicos / justificación del estudio", "", "spanall")}</div>`,
    colposcopia: comun + `<div class="checks">${COLPO_MOT.map(o => `<label class="chk"><input type="checkbox" name="motivos" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("")}</div>
      <div class="grid g3" style="margin-top:12px">
      ${inp("pap_previo", "Resultado de citología / VPH previo", P.ultimo_pap || "", "span2")}
      <label class="f"><span>Incluye</span><select name="incluye"><option>Colposcopia</option><option>Colposcopia con biopsia dirigida</option><option>Colposcopia + vulvoscopia</option></select></label>
      ${ta("datos_clinicos", "Datos clínicos / observaciones", "", "spanall")}</div>`,
    biopsia: comun + `<div class="grid g3">
      <label class="f"><span>Estudio solicitado</span><select name="estudio">${ESTUDIOS.map(o => `<option>${esc(o)}</option>`).join("")}</select></label>
      <label class="f"><span>Tipo de muestra</span><select name="muestra">${MUESTRAS.map(o => `<option>${esc(o)}</option>`).join("")}</select></label>
      ${inp("sitio", "Sitio / localización (ej.: hora 6 del cérvix)", "")}
      ${inp("n_muestras", "N.º de frascos / muestras", "1")}
      <label class="f"><span>Fecha de toma</span><input type="date" name="fecha_toma" value="${today()}"></label>
      ${inp("fijador", "Fijador", "Formol al 10%")}
      ${ta("hallazgos", "Hallazgos colposcópicos / quirúrgicos", "", "spanall")}
      ${ta("datos_clinicos", "Datos clínicos (FUM, MAC, embarazo, menopausia, tratamientos previos)", [P.fum ? "FUM " + fmtD(P.fum) : "", P.mac ? "MAC " + P.mac : ""].filter(Boolean).join(" · "), "spanall")}</div>`,
    laboratorio: comun + checks("examenes", LAB_OPC) + `<div class="grid g3" style="margin-top:12px">
      ${inp("otro", "Otros exámenes", "", "span2")}
      <label class="f"><span>Preparación</span><select name="preparacion"><option>Ayuno de 8 a 12 horas</option><option>No requiere ayuno</option></select></label>
      ${ta("datos_clinicos", "Datos clínicos / observaciones", g && consulta?.datos?.embarazo ? `Embarazo de ${g.txt}` : "", "spanall")}</div>`,
  };
  const prev = await api("GET", "pedidos?paciente=" + P.id).catch(() => []);
  const medSel = await selectMedico(consulta);
  box.innerHTML = `${!consulta && isClin() ? `<div class="info small" style="margin-bottom:12px">Sugerencia: si registra antes la consulta del día, el diagnóstico se completa automáticamente en los pedidos.</div>` : ""}
    ${medSel ? `<div class="grid g4" style="margin-bottom:12px">${medSel}</div>` : ""}
    ${Object.entries(PED).map(([k, v]) => `<div class="acc" data-acc="${k}"><header><span class="ic">${v.ic}</span>${v.t}<span class="chev">›</span></header>
      <div class="b"><form data-form="${k}"><div class="small muted" style="margin:10px 0">Paciente: <b>${esc(P.apellidos)} ${esc(P.nombres)}</b> · CI ${esc(P.cedula)} · ${P.fecha_nac ? edad(P.fecha_nac) + " años" : ""}</div>${forms[k]}
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn pri">Generar e imprimir pedido</button></div></form></div></div>`).join("")}
    <h3 style="margin:20px 0 10px">Pedidos emitidos</h3>
    ${prev.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>N.º</th><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Resultado</th><th></th></tr></thead><tbody>
      ${prev.map(p => `<tr><td>${p.numero}</td><td>${fmtD(p.fecha)}</td><td>${esc(PED[p.tipo]?.t || p.tipo)}</td><td class="small">${esc(resumenPedido(p).slice(0, 120))}</td>
        <td>${p.estado === "resultado" ? `<span class="badge green">Recibido</span>` : `<span class="badge new">Pendiente</span>`}</td><td class="right"><button class="btn sm" data-pp="${p.id}">Reimprimir</button></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted small">Ninguno todavía.</p>`}`;
  $$("[data-acc]>header", box).forEach(h => h.onclick = () => h.parentElement.classList.toggle("open"));
  $$("[data-pp]", box).forEach(b => b.onclick = async () => imprimirPedido(await api("GET", "pedidos/" + b.dataset.pp), P));
  $$("[data-form]", box).forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    const tipo = f.dataset.form, d = {};
    $$("input,select,textarea", f).forEach(el => {
      if (!el.name) return;
      if (el.type === "checkbox") { (d[el.name] = d[el.name] || []); if (el.checked) d[el.name].push(el.value); }
      else d[el.name] = el.value;
    });
    const sel = (d.estudios || d.examenes || d.motivos || []).length + (d.otro ? 1 : 0);
    if ((tipo === "ecografia" || tipo === "laboratorio") && !sel) return toast("Seleccione al menos un estudio", true);
    try {
      const mid = $("[name=medico_id]", box)?.value;
      const r = await api("POST", "pedidos", { paciente_id: P.id, tipo, fecha: d.fecha, datos: d, medico_id: mid ? +mid : null, turno_id: ctx.turno ? ctx.turno.id : null });
      toast("Pedido N.º " + r.numero + " generado");
      await imprimirPedido(await api("GET", "pedidos/" + r.id), P);
      tPedidos(box, ctx);
    } catch (er) { fail(er); }
  });
}
function resumenPedido(p) {
  const d = p.datos;
  return [...(d.estudios || []), ...(d.examenes || []), ...(d.motivos || []), d.estudio, d.muestra, d.otro].filter(Boolean).join(", ");
}

/* =====================================================================
   IMPRESIÓN (receta, pedidos, consulta)
   ===================================================================== */
function printDoc(html, page) {
  if (window.DEMO_PRINT) return window.DEMO_PRINT(html, page);
  return new Promise(res => {
    const fr = document.createElement("iframe");
    fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(fr);
    const doc = fr.contentDocument;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>ISIM</title><style>@page{size:${page};margin:0}${PRINT_CSS}</style></head><body>${html}${FIT_JS}</body></html>`);
    doc.close();
    const go = () => { setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => { fr.remove(); res(); }, 1500); }, 250); };
    const imgs = [...doc.images];
    let n = imgs.length; if (!n) return go();
    imgs.forEach(i => { if (i.complete) { if (--n === 0) go(); } else i.onload = i.onerror = () => { if (--n === 0) go(); }; });
  });
}
// si el contenido no cabe en una hoja, se reduce lo necesario (máx. 22 %)
const FIT_JS = `<script>(function(){document.querySelectorAll('.pg.fit').forEach(function(p){var H=parseFloat(p.getAttribute('data-h'))*96/25.4;p.style.minHeight='0';var h=p.scrollHeight;if(h>H){var z=Math.max(.78,(H-2)/h);p.style.zoom=z;p.style.minHeight=(H/z-1)+'px';}else{p.style.minHeight=H+'px';}});})();<\/script>`;
const PRINT_CSS = `
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:Poppins,"Segoe UI",Arial,sans-serif;color:#1d2433;font-size:9.5pt}
.pg{position:relative;padding:7mm 10mm 6mm;min-height:100vh;display:flex;flex-direction:column}
.pg::before,.pg::after{content:"";position:absolute;top:0;height:2.2mm}
.pg::before{left:0;width:72%;background:#284f8c}.pg::after{right:0;width:28%;background:#45989f}
.bot{position:absolute;bottom:0;left:0;right:0;height:1.6mm;background:linear-gradient(90deg,#284f8c 72%,#45989f 72%)}
.hd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2.5mm}
.hd img{height:14.5mm;margin-top:-1mm}
.hd .t{text-align:right}
.hd .t h1{margin:0;font-size:17pt;font-weight:400;letter-spacing:.06em;color:#284f8c}
.hd .t .in{color:#45989f;font-size:6.8pt;font-weight:600;letter-spacing:.1em}
.hd .t .ad{color:#6b7487;font-size:6.2pt}
.pbox{background:#f4f6fa;border-radius:3mm;padding:2.2mm 5mm;display:grid;grid-template-columns:2.4fr 1.2fr 1fr 1fr;gap:1.2mm 5mm;margin-bottom:3mm}
.pbox .l{font-size:5.8pt;letter-spacing:.12em;color:#6b7487;text-transform:uppercase}
.pbox .v{font-weight:600;font-size:9pt;border-bottom:.3mm solid transparent;min-height:4mm}
.pbox .v.line{border-bottom-color:#b7bfcf}
.cols{display:grid;grid-template-columns:1.25fr 1fr;gap:6mm;flex:1}
.ch{font-size:7pt;letter-spacing:.14em;color:#284f8c;text-transform:uppercase;border-bottom:.3mm solid #c7cede;padding-bottom:1mm;margin-bottom:2mm;font-weight:600}
.ch i{text-transform:none;font-family:Georgia,serif;font-size:13pt;font-weight:700;letter-spacing:0;margin-right:1.5mm}
.it{display:grid;grid-template-columns:1.25fr 1fr;gap:6mm;margin-bottom:2mm;break-inside:avoid}
.it .m{display:flex;gap:3mm}
.it .n{width:5mm;height:5mm;border-radius:50%;background:#284f8c;color:#fff;font-size:7pt;display:grid;place-items:center;flex:none;font-weight:600}
.it .cm{font-size:10pt;font-weight:500;line-height:1.2}
.it .gn{font-style:italic;color:#6b7487;font-size:7.4pt}
.it .q{display:inline-block;background:#e6f3f4;color:#2f7479;border-radius:3mm;padding:.4mm 3mm;font-size:7pt;margin-top:1mm}
.it .ind{border-left:.9mm solid #45989f;padding:1mm 0 1mm 3mm;font-size:8.6pt}
.ft{display:grid;grid-template-columns:1.25fr 1fr;gap:6mm;align-items:end;margin-top:auto;padding-top:2mm}
.rec{background:#f4f6fa;border-radius:3mm;padding:2mm 4mm;font-size:7.6pt;line-height:1.35}
.rec .ch{border:0;margin-bottom:1mm;font-size:6pt}
.rec div{padding-left:4mm;position:relative}.rec div::before{content:"✓";position:absolute;left:0;color:#45989f;font-weight:700}
.fi{text-align:center;font-size:6.8pt;color:#6b7487;padding-top:7mm;line-height:1.35}
.fi .ln{border-top:.35mm solid #1d2433;width:62mm;margin:0 auto 1.2mm}
.fi b{display:block;color:#284f8c;font-size:8.6pt}
.note{font-size:6pt;color:#6b7487;margin-top:2mm;border-top:.2mm solid #e3e7ef;padding-top:1.5mm}
.tag{display:inline-block;background:#284f8c;color:#fff;padding:.6mm 3mm;border-radius:2mm;font-size:7pt;letter-spacing:.08em;margin-bottom:2mm}
ul.sel{margin:0;padding-left:5mm;columns:2;column-gap:8mm;font-size:9pt}ul.sel li{margin-bottom:.8mm;break-inside:avoid}
.blk{margin-bottom:3mm}.blk .l{font-size:6pt;letter-spacing:.12em;color:#6b7487;text-transform:uppercase;margin-bottom:.6mm}
.blk .v{white-space:pre-wrap}
table.hc{width:100%;border-collapse:collapse;font-size:8.5pt}table.hc td{border:.25mm solid #c7cede;padding:1.6mm 2.4mm;vertical-align:top}
.ci{font-size:8.6pt}.ci .tt{font-size:12pt;color:#284f8c;font-weight:600;margin:0 0 2.5mm}
.ci table.dg{margin-bottom:3mm}.ci table.dg td.l{width:28mm}
.ci .sec{margin-bottom:1.8mm;break-inside:avoid}.ci .st{font-weight:600;color:#284f8c;font-size:8.2pt}.ci .sv{white-space:pre-wrap;line-height:1.35}
.ci .st2{font-weight:700;color:#284f8c;font-size:8.4pt;letter-spacing:.06em;margin:3mm 0 1mm;border-bottom:.3mm solid #c7cede}
.ci .decl{line-height:1.4;text-align:justify}.ci .txt{white-space:pre-wrap;line-height:1.42;text-align:justify;margin-bottom:3mm}
.ci .nota{background:#fff6e0;border-left:1mm solid #b7791f;padding:1.6mm 3mm;margin:2mm 0;font-size:8pt}
.ci .fechahora{margin:2mm 0;white-space:pre}
.ci .firmas{display:grid;grid-template-columns:1fr 1fr;gap:8mm;break-inside:avoid}
.ci .firmas3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm;break-inside:avoid}
.ci .fbox{position:relative;font-size:7.4pt;color:#4b5468}.ci .fbox .fsp{height:12mm}.ci .fbox .fln{border-top:.3mm solid #1d2433;margin-bottom:1mm;margin-right:24mm}
.ci .fbox b{display:block;color:#1d2433}.ci .hu{position:absolute;right:0;top:0;width:20mm;height:22mm;border:.3mm dashed #8a93a6;border-radius:2mm;font-size:6pt;text-align:center;padding-top:15mm;color:#8a93a6}
.mb{position:relative;width:210mm;height:296mm;overflow:hidden;page-break-after:avoid}.mbg{position:absolute;inset:0;width:100%;height:100%}
.mbc{position:absolute;overflow:hidden}
.cert{font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#111}
.cert .ti{text-align:center;font-weight:700;font-size:15pt;margin-bottom:4mm}
.cert .ti2{text-align:center;font-weight:700;font-size:14pt;color:#284f8c;margin-bottom:4mm}
.cert .bar{background:#a6a6a6;text-align:center;font-size:13pt;padding:1.2mm;margin-bottom:3mm}
.cert table.ctab{width:100%;border-collapse:collapse;font-size:9.5pt}.cert table.ctab td{border:.3mm solid #000;padding:.8mm 2mm;vertical-align:top}
.cert table.ctab td.k{width:48%;font-weight:700}.cert table.ctab td.v{font-weight:700}
.cert .sq{display:inline-block;width:7mm;height:3.6mm;background:#5b9bd5;color:#fff;font-size:7pt;text-align:center;line-height:3.6mm;vertical-align:middle}
.cert p.b{font-weight:700;margin:2.5mm 0}.cert .fl{font-weight:700;line-height:1.35}
.cert p.r{text-align:right;margin:0 0 4mm}.cert p.j{text-align:justify;line-height:1.45;margin:0 0 3mm}
.cert .fc{text-align:center;line-height:1.35}.cert p.nt{font-style:italic;font-size:8.5pt;margin-top:5mm}
.cert .cc{margin-top:4mm}
.ci .neg{margin-top:2mm;break-inside:avoid}.ci .bot{display:none}
table.hc td.l{width:45mm;background:#f4f6fa;font-size:7pt;text-transform:uppercase;letter-spacing:.06em;color:#4b5468}
`;
function cabecera(titulo, P, extra) {
  const I = S.inst;
  return `<div class="hd"><img src="${LOGO}"><div class="t"><h1>${titulo}</h1><div class="in">${esc(I.nombre)}</div><div class="ad">${esc(I.direccion)}</div><div class="ad">Citas: ${esc(I.telefono)}${I.ruc ? " · RUC " + esc(I.ruc) : ""}</div></div></div>`;
}
function firma(med) {
  return `<div class="fi"><div class="ln"></div><b>${esc(med.nombre || med.medico || "")}</b>${esc(med.especialidad || "")}${med.registro ? `<br>Reg. profesional: ${esc(med.registro)}` : ""}<br>Firma y sello</div>`;
}
async function imprimirReceta(id, P) {
  const r = await api("GET", "recetas/" + id).catch(fail); if (!r) return;
  const d = r.datos;
  const recs = (d.recomendaciones || "").split("\n").map(s => s.trim()).filter(Boolean);
  const html = `<div class="pg fit" data-h="148">${cabecera("RECETA MÉDICA")}
    ${d.para_pareja ? `<div class="tag">TRATAMIENTO EXCLUSIVO PARA LA PAREJA</div>` : ""}
    <div class="pbox">
      <div><div class="l">Paciente</div><div class="v">${esc(P.apellidos)} ${esc(P.nombres)}</div></div>
      <div><div class="l">C.I. / HC</div><div class="v">${esc(P.cedula)}</div></div>
      <div><div class="l">Edad</div><div class="v">${P.fecha_nac ? edad(P.fecha_nac, r.fecha) + " años" : ""}</div></div>
      <div><div class="l">Fecha · N.º</div><div class="v">${fmtD(r.fecha)} · ${String(r.numero).padStart(5, "0")}</div></div>
      <div><div class="l">Diagnóstico</div><div class="v">${esc(d.diagnostico)}</div></div>
      <div><div class="l">CIE-10</div><div class="v">${esc(d.cie)}</div></div>
      <div style="grid-column:span 2"><div class="l">Alergias</div><div class="v line">${esc(d.alergias)}</div></div>
    </div>
    <div class="cols" style="display:block;flex:none">
      <div class="it" style="margin-bottom:1mm"><div class="ch"><i>Rp/</i>Prescripción</div><div class="ch">Indicaciones</div></div>
      ${d.items.map((it, i) => `<div class="it"><div class="m"><span class="n">${i + 1}</span><div>
        <div class="cm">${esc(it.comercial || it.generico)}</div>
        <div class="gn">${esc(it.generico)}${it.forma || it.via ? " · " + esc([it.forma, it.via].filter(Boolean).join(" · ")) : ""}</div>
        <span class="q">Cantidad: #${esc(it.cantidad)} (${letras(it.cantidad)}) ${esc(it.unidad || "")}</span></div></div>
        <div class="ind">${esc(it.indicacion)}</div></div>`).join("")}
    </div>
    <div class="ft"><div>${recs.length ? `<div class="rec"><div class="ch" style="padding:0">Recomendaciones</div>${recs.map(x => `<div>${esc(x)}</div>`).join("")}</div>` : ""}</div>${firma(r)}</div>
    <div class="note">${esc(S.inst.pie_receta || "")}${r.elaborado && r.elaborado !== r.medico ? " · Elaborada por: " + esc(r.elaborado) : ""}${r.anulada ? " · RECETA ANULADA" : ""}</div><div class="bot"></div></div>`;
  return printDoc(html, "A5 landscape");
}
async function imprimirPedido(p, P) {
  const d = p.datos;
  const lista = (arr) => arr && arr.length ? `<ul class="sel">${arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  const blk = (l, v) => v ? `<div class="blk"><div class="l">${l}</div><div class="v">${esc(v)}</div></div>` : "";
  let cuerpo = "";
  if (p.tipo === "ecografia") cuerpo = `<div class="ch">Estudios solicitados</div>${lista([...(d.estudios || []), d.otro].filter(Boolean))}<div style="height:3mm"></div>
    <div class="pbox" style="grid-template-columns:1fr 1fr 1fr;background:#fff;padding:0">${d.fum ? `<div><div class="l">FUM</div><div class="v">${fmtD(d.fum)}</div></div>` : ""}${d.eg ? `<div><div class="l">Edad gestacional</div><div class="v">${esc(d.eg)}</div></div>` : ""}<div><div class="l">Prioridad</div><div class="v">${esc(d.prioridad)}</div></div></div>${blk("Datos clínicos", d.datos_clinicos)}`;
  if (p.tipo === "colposcopia") cuerpo = `<div class="ch">Se solicita: ${esc(d.incluye)}</div><div class="blk"><div class="l">Motivo</div>${lista(d.motivos)}</div>${blk("Citología / VPH previo", d.pap_previo)}${blk("Datos clínicos", d.datos_clinicos)}`;
  if (p.tipo === "biopsia") cuerpo = `<div class="ch">${esc(d.estudio)}</div><div class="pbox" style="grid-template-columns:2fr 1.4fr 1fr 1fr;background:#fff;padding:0">
    <div><div class="l">Tipo de muestra</div><div class="v">${esc(d.muestra)}</div></div><div><div class="l">Sitio</div><div class="v">${esc(d.sitio)}</div></div>
    <div><div class="l">N.º muestras</div><div class="v">${esc(d.n_muestras)}</div></div><div><div class="l">Fecha de toma</div><div class="v">${fmtD(d.fecha_toma)}</div></div></div>
    ${blk("Fijador", d.fijador)}${blk("Hallazgos", d.hallazgos)}${blk("Datos clínicos", d.datos_clinicos)}`;
  if (p.tipo === "laboratorio") cuerpo = `<div class="ch">Exámenes solicitados</div>${lista([...(d.examenes || []), d.otro].filter(Boolean))}<div style="height:3mm"></div>${blk("Preparación", d.preparacion)}${blk("Datos clínicos", d.datos_clinicos)}`;
  const html = `<div class="pg fit" data-h="210">${cabecera(PED[p.tipo].t.replace("Pedido de ", "PEDIDO DE ").toUpperCase())}
    <div class="pbox">
      <div><div class="l">Paciente</div><div class="v">${esc(P.apellidos)} ${esc(P.nombres)}</div></div>
      <div><div class="l">C.I. / HC</div><div class="v">${esc(P.cedula)}</div></div>
      <div><div class="l">Edad</div><div class="v">${P.fecha_nac ? edad(P.fecha_nac, p.fecha) + " años" : ""}</div></div>
      <div><div class="l">Fecha · N.º</div><div class="v">${fmtD(p.fecha)} · ${String(p.numero).padStart(5, "0")}</div></div>
      <div style="grid-column:span 2"><div class="l">Diagnóstico presuntivo</div><div class="v">${esc(d.diagnostico)}</div></div>
      <div><div class="l">CIE-10</div><div class="v">${esc(d.cie)}</div></div><div><div class="l">Teléfono</div><div class="v">${esc(P.telefono || "")}</div></div>
    </div>
    <div style="flex:1">${cuerpo}</div>
    <div class="ft"><div></div>${firma(p)}</div><div class="bot"></div></div>`;
  return printDoc(html, "A5 portrait");
}
function imprimirConsulta(c, P) {
  const d = c.datos || {};
  const filas = CAMPOS_CONSULTA.map(([k, l]) => {
    const v = k === "_vitales" ? vitalesTxt(d) : k === "_obst" ? obstTxt(d) : k === "_dx" ? (d.diagnosticos || []).map(x => `${x.cie}  ${x.desc}  (${x.tipo})`).join("\n") : k === "proxima_cita" ? fmtD(d[k]) : d[k];
    return v ? `<tr><td class="l">${l}</td><td style="white-space:pre-wrap">${esc(v)}</td></tr>` : "";
  }).join("");
  const html = `<div class="pg" style="padding:12mm 14mm">${cabecera("CONSULTA EXTERNA")}
    <div class="pbox"><div><div class="l">Paciente</div><div class="v">${esc(P.apellidos)} ${esc(P.nombres)}</div></div>
      <div><div class="l">C.I. / HC</div><div class="v">${esc(P.cedula)}</div></div><div><div class="l">Edad</div><div class="v">${P.fecha_nac ? edad(P.fecha_nac, c.fecha) + " años" : ""}</div></div>
      <div><div class="l">Fecha</div><div class="v">${fmtD(c.fecha)}</div></div></div>
    <table class="hc"><tr><td class="l">Antecedentes</td><td style="white-space:pre-wrap">${esc([P.alergias ? "Alergias: " + P.alergias : "", P.ant_personales, P.ant_quirurgicos, P.ant_familiares ? "Familiares: " + P.ant_familiares : "", agoTxt(P)].filter(Boolean).join("\n"))}</td></tr>${filas}</table>
    <div style="flex:1"></div>
    <div class="ft"><div class="note" style="border:0">${c.estado === "cerrada" ? "Firmada electrónicamente: " + esc(c.cerrada_en) : "BORRADOR — no firmado"}</div>${firma({ nombre: c.medico || S.user.nombre, especialidad: S.user.especialidad, registro: S.user.registro })}</div><div class="bot"></div></div>`;
  printDoc(html, "A4 portrait");
}

/* =====================================================================
   AJUSTES
   ===================================================================== */
async function vAjustes(m, r) {
  if (!isClin() && S.user.rol !== "recepcion") return go(inicio());
  const sec = isClin() ? (r.parts[1] || "medicamentos") : "medicamentos";
  const items = [["medicamentos", "Medicamentos"], ...(isClin() ? [["esquemas", "Esquemas de receta"]] : []), ...(isAdmin() ? [["horario", "Horarios de turnos"], ["institucion", "Datos del instituto"], ["usuarios", "Usuarios"], ["motivos", "Motivos y consentimientos"], ["membretes", "Hojas membretadas"], ["auditoria", "Registro de accesos"], ["respaldo", "Respaldo"]] : [])];
  m.innerHTML = `<div class="side"><nav>${items.map(([k, l]) => `<a href="#/ajustes/${k}" class="${k === sec ? "on" : ""}">${l}</a>`).join("")}</nav><div id="aj"></div></div>`;
  const box = $("#aj", m);
  ({ medicamentos: ajMeds, esquemas: ajEsq, horario: ajHorario, institucion: ajInst, usuarios: ajUsers, auditoria: ajAudit, respaldo: ajResp, motivos: ajMotivos, membretes: ajMembretes }[sec] || ajMeds)(box);
}
async function ajMeds(box) {
  await cargarCatalogos(true);
  box.innerHTML = `<div class="row" style="margin-bottom:12px"><h2 class="grow">Catálogo de medicamentos</h2><input id="fm" placeholder="Filtrar…" style="width:220px"><button class="btn pri" id="nm">＋ Nuevo medicamento</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre comercial</th><th>Genérico (DCI) y concentración</th><th>Forma · vía</th><th>Cant.</th><th>Indicación por defecto</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = f => {
    const n = s => (s || "").toLowerCase();
    $("#tb", box).innerHTML = S.meds.filter(x => !f || n(x.comercial + x.generico).includes(n(f))).map(x => `<tr style="${x.activo ? "" : "opacity:.45"}"><td><b>${esc(x.comercial)}</b></td><td>${esc(x.generico)}</td><td class="small">${esc(x.forma)} · ${esc(x.via)}</td><td>${esc(x.cantidad ?? "")} ${esc(x.unidad || "")}</td><td class="small">${esc(x.indicacion)}</td><td><button class="btn sm" data-e="${x.id}">Editar</button></td></tr>`).join("");
    $$("[data-e]", box).forEach(b => b.onclick = () => editMed(S.meds.find(x => x.id === +b.dataset.e), () => ajMeds(box)));
  };
  draw(); $("#fm", box).oninput = e => draw(e.target.value);
  $("#nm", box).onclick = () => editMed({ activo: 1 }, () => ajMeds(box));
}
function editMed(x, done) {
  const md = modal(x.id ? "Editar medicamento" : "Nuevo medicamento", `<form id="f" class="grid g2">
    ${inp("comercial", "Nombre comercial", x.comercial, "", 1)}${inp("generico", "Genérico (DCI) + concentración", x.generico, "", 1)}
    ${inp("forma", "Forma farmacéutica (comprimidos, óvulos, ampollas…)", x.forma)}${inp("via", "Vía (vía oral, vía vaginal, IM…)", x.via)}
    ${inp("cantidad", "Cantidad por defecto", x.cantidad, 'type="number"')}${inp("unidad", "Unidad (comprimidos, óvulos, tubo…)", x.unidad)}
    ${ta("indicacion", "Indicación por defecto", x.indicacion)}
    <label class="chk"><input type="checkbox" name="activo" value="1" data-off="0" ${x.activo ? "checked" : ""}><span>Activo (aparece al recetar)</span></label></form>`,
    `<button class="btn" data-c>Cancelar</button><button class="btn pri" id="ok">Guardar</button>`);
  $("[data-c]", md).onclick = md.close;
  $("#ok", md).onclick = async () => {
    const d = leerForm($("#f", md));
    if (!d.comercial || !d.generico) return toast("Nombre comercial y genérico son obligatorios", true);
    try { await api(x.id ? "PUT" : "POST", "medicamentos" + (x.id ? "/" + x.id : ""), d); md.close(); S.meds = null; done(); } catch (e) { fail(e); }
  };
}
async function ajEsq(box) {
  await cargarCatalogos(true);
  box.innerHTML = `<div class="row" style="margin-bottom:12px"><h2 class="grow">Esquemas de receta (recetario)</h2><button class="btn pri" id="ne">＋ Nuevo esquema</button></div>
    <p class="small muted">Al recetar, elija un esquema y se cargan los medicamentos con sus indicaciones. Siempre puede modificarlos antes de imprimir.</p>
    ${S.esquemas.map(e => `<div class="card"><div class="row"><b class="grow">${esc(e.nombre)}</b>${e.para_pareja ? `<span class="badge">Pareja</span>` : ""}<span class="small muted">${esc(e.diagnostico)} ${esc(e.cie)}</span><button class="btn sm" data-e="${e.id}">Editar</button></div>
      <div class="small" style="margin-top:6px">${e.items.map(i => `${esc(i.comercial)} #${esc(i.cantidad)}`).join(" · ")}</div></div>`).join("")}`;
  $$("[data-e]", box).forEach(b => b.onclick = () => editEsq(S.esquemas.find(x => x.id === +b.dataset.e), () => ajEsq(box)));
  $("#ne", box).onclick = () => editEsq({ items: [] }, () => ajEsq(box));
}
function editEsq(e, done) {
  const items = (e.items || []).map(x => ({ ...x }));
  const md = modal(e.id ? "Editar esquema" : "Nuevo esquema", `<div class="grid g4">
    <label class="f span2"><span>Nombre del esquema</span><input id="en" value="${esc(e.nombre || "")}"></label>
    <label class="f"><span>Diagnóstico</span><input id="ed" value="${esc(e.diagnostico || "")}"></label>
    <label class="f"><span>CIE-10</span><input id="ec" value="${esc(e.cie || "")}"></label></div>
    <h3 style="margin:14px 0 8px">Medicamentos</h3><div id="ei"></div>
    <div class="ac" style="margin-top:6px"><input id="eq" placeholder="Agregar medicamento del catálogo…" autocomplete="off"><div class="ac-list" id="el" style="display:none"></div></div>
    <label class="f" style="margin-top:12px"><span>Recomendaciones (una por línea)</span><textarea id="er" rows="3">${esc(e.recomendaciones || "")}</textarea></label>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="ep" ${e.para_pareja ? "checked" : ""}><span>Es receta para la pareja</span></label>`,
    `${e.id ? `<button class="btn danger" id="del" style="margin-right:auto">Eliminar</button>` : ""}<button class="btn" data-c>Cancelar</button><button class="btn pri" id="ok">Guardar</button>`, true);
  const draw = () => {
    $("#ei", md).innerHTML = items.map((it, i) => `<div class="grid" style="grid-template-columns:1.2fr 80px 2fr 30px;gap:8px;margin-bottom:6px;align-items:start"><div><b>${esc(it.comercial)}</b><div class="small muted">${esc(it.generico)}</div></div>
      <input type="number" data-q="${i}" value="${esc(it.cantidad)}"><textarea rows="2" data-ind="${i}">${esc(it.indicacion)}</textarea><button class="btn sm ghost danger" data-r="${i}">✕</button></div>`).join("") || `<p class="small muted">Sin medicamentos</p>`;
    $$("[data-q]", md).forEach(x => x.oninput = () => items[+x.dataset.q].cantidad = x.value);
    $$("[data-ind]", md).forEach(x => x.oninput = () => items[+x.dataset.ind].indicacion = x.value);
    $$("[data-r]", md).forEach(x => x.onclick = () => { items.splice(+x.dataset.r, 1); draw(); });
  };
  draw();
  medAutocomplete($("#eq", md), $("#el", md), m => { items.push({ med_id: m.id, comercial: m.comercial, generico: m.generico, forma: m.forma, via: m.via, unidad: m.unidad, cantidad: m.cantidad, indicacion: m.indicacion }); draw(); });
  $("[data-c]", md).onclick = md.close;
  if (e.id) $("#del", md).onclick = async () => { if (await confirmar("¿Eliminar este esquema?")) { await api("DELETE", "esquemas/" + e.id); md.close(); done(); } };
  $("#ok", md).onclick = async () => {
    const d = { nombre: $("#en", md).value, diagnostico: $("#ed", md).value, cie: $("#ec", md).value, items, recomendaciones: $("#er", md).value, para_pareja: $("#ep", md).checked ? 1 : 0 };
    if (!d.nombre) return toast("Ponga un nombre al esquema", true);
    try { await api(e.id ? "PUT" : "POST", "esquemas" + (e.id ? "/" + e.id : ""), d); md.close(); S.esquemas = null; done(); } catch (er) { fail(er); }
  };
}
async function ajHorario(box) {
  const a = await api("GET", "ajustes"); const H = a.horario;
  const t = arr => (arr || []).join(", ");
  box.innerHTML = `<div class="card stack"><h2>Horarios de turnos</h2>
    <p class="small muted">Escriba las horas de inicio separadas por comas, en formato 24 h (ej.: 09:30, 10:00). Los turnos extra y emergencias se agregan aparte, sin límite.</p>
    <div class="grid g2">
      <label class="f"><span>Lunes a viernes — mañana</span><input id="lm" value="${t(H.lv.manana)}"></label>
      <label class="f"><span>Lunes a viernes — tarde</span><input id="lt" value="${t(H.lv.tarde)}"></label>
      <label class="f"><span>Sábado — mañana</span><input id="sm" value="${t(H.sabado.manana)}" placeholder="vacío = solo turnos extra"></label>
      <label class="f"><span>Sábado — tarde</span><input id="st" value="${t(H.sabado.tarde)}"></label>
      <label class="f"><span>Pacientes por cada hora</span><input type="number" id="cp" min="1" max="6" value="${H.cupos_por_hora || 2}"></label>
    </div><div><button class="btn pri" id="ok">Guardar horarios</button></div></div>`;
  const parse = s => s.split(",").map(x => x.trim()).filter(Boolean).map(x => { const [h, m] = x.split(":"); return `${pad(+h)}:${pad(+(m || 0))}`; });
  $("#ok", box).onclick = async () => {
    const horario = { lv: { manana: parse($("#lm", box).value), tarde: parse($("#lt", box).value) }, sabado: { manana: parse($("#sm", box).value), tarde: parse($("#st", box).value) }, cupos_por_hora: +$("#cp", box).value || 2 };
    try { await api("PUT", "ajustes", { horario }); S.horario = horario; toast("Horarios guardados"); } catch (e) { fail(e); }
  };
}
async function ajInst(box) {
  const I = (await api("GET", "ajustes")).institucion;
  box.innerHTML = `<form class="card stack" id="f"><h2>Datos del instituto (encabezado de recetas y pedidos)</h2><div class="grid g2">
    ${inp("nombre", "Nombre", I.nombre, "span2")}${inp("direccion", "Dirección", I.direccion, "span2")}${inp("telefono", "Teléfono de citas", I.telefono)}${inp("ruc", "RUC", I.ruc)}
    ${inp("pie_receta", "Nota al pie de la receta", I.pie_receta, "span2")}
    ${ta("presentacion_cert", "Presentación del médico en certificados (después de \"Yo, Dr. …,\")", I.presentacion_cert || "médico gineco-obstetra, especialista en Medicina Materno Fetal y Director Médico del Instituto de Salud Integral de la Mujer (ISIM)", "span2", 2)}
    ${inp("ciudad", "Ciudad (para la fecha del certificado)", I.ciudad || "Riobamba")}</div><div><button class="btn pri">Guardar</button></div></form>`;
  $("#f", box).onsubmit = async e => { e.preventDefault(); const d = { ...I, ...leerForm(e.target) }; try { await api("PUT", "ajustes", { institucion: d }); S.inst = d; toast("Guardado"); } catch (er) { fail(er); } };
}
async function ajUsers(box) {
  const us = await api("GET", "usuarios");
  box.innerHTML = `<div class="row" style="margin-bottom:12px"><h2 class="grow">Usuarios</h2><button class="btn pri" id="nu">＋ Nuevo usuario</button></div>
    <div class="info small" style="margin-bottom:12px"><b>Administrador</b> y <b>Médico</b>: todo (el administrador además maneja usuarios, horarios, auditoría y respaldos).<br>
      <b>Recepción</b>: Turnos, Agenda, Datos de la paciente, Historia clínica (solo fechas y resumen), Receta, Exámenes, Pedidos, Consentimientos y Certificados. Recetas, pedidos y certificados salen a nombre del médico tratante.<br>
      <b>Auxiliar de enfermería</b>: Agenda, Datos de la paciente, Historia clínica (solo fechas y resumen) y Exámenes (subir resultados).</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Registro prof.</th><th>Estado</th><th></th></tr></thead><tbody>
    ${us.map(u => `<tr><td><b>${esc(u.nombre)}</b><div class="small muted">${esc(u.especialidad)}</div></td><td>${esc(u.usuario)}</td><td>${ROL[u.rol]}</td><td>${esc(u.registro)}</td><td>${u.activo ? `<span class="badge green">Activo</span>` : `<span class="badge grey">Inactivo</span>`}</td><td><button class="btn sm" data-e="${u.id}">Editar</button></td></tr>`).join("")}</tbody></table></div>`;
  const edit = u => {
    const md = modal(u.id ? "Editar usuario" : "Nuevo usuario", `<form id="f" class="grid g2">
      ${inp("nombre", "Nombre completo", u.nombre, "", 1)}
      <label class="f"><span>Usuario (para ingresar)</span><input name="usuario" value="${esc(u.usuario || "")}" ${u.id ? "disabled" : ""}></label>
      ${fsel("rol", "Rol", [["recepcion", "Recepción"], ["enfermeria", "Auxiliar de enfermería"], ["medico", "Médico"], ["admin", "Administrador"]], u.rol || "recepcion")}
      ${inp("especialidad", "Especialidad (médicos)", u.especialidad)}
      ${inp("registro", "Registro profesional (médicos)", u.registro)}
      ${ta("firma_cert", "Firma en certificados de atención (una línea por renglón)", u.firma_cert, "", 3)}
      ${ta("firma_iess", "Firma en certificados IESS (nombre, especialidad, C.I., mail)", u.firma_iess, "", 3)}
      <label class="f"><span>${u.id ? "Nueva contraseña (dejar vacío para no cambiar)" : "Contraseña (mín. 8)"}</span><input name="password" type="password"></label>
      ${u.id ? `<label class="chk"><input type="checkbox" name="activo" value="1" data-off="0" ${u.activo ? "checked" : ""}><span>Usuario activo</span></label>` : ""}</form>`,
      `<button class="btn" data-c>Cancelar</button><button class="btn pri" id="ok">Guardar</button>`);
    $("[data-c]", md).onclick = md.close;
    $("#ok", md).onclick = async () => { try { await api(u.id ? "PUT" : "POST", "usuarios" + (u.id ? "/" + u.id : ""), leerForm($("#f", md))); md.close(); S.medicos = null; ajUsers(box); } catch (e) { fail(e); } };
  };
  $("#nu", box).onclick = () => edit({});
  $$("[data-e]", box).forEach(b => b.onclick = () => edit(us.find(x => x.id === +b.dataset.e)));
}
async function ajAudit(box) {
  const a = await api("GET", "auditoria");
  box.innerHTML = `<h2 style="margin-bottom:6px">Registro de accesos y cambios</h2><p class="small muted">Últimos 500 movimientos. Se registra quién vio o modificó cada historia clínica (confidencialidad — AM 5216).</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Registro</th><th>Detalle</th><th>Equipo</th></tr></thead><tbody>
    ${a.map(x => `<tr><td class="small">${esc(x.fecha)}</td><td>${esc(x.usuario || "—")}</td><td>${esc(x.accion)}</td><td class="small">${esc(x.entidad)} ${esc(x.entidad_id ?? "")}</td><td class="small">${esc((x.detalle || "").slice(0, 60))}</td><td class="small muted">${esc(x.ip)}</td></tr>`).join("")}</tbody></table></div>`;
}
function ajResp(box) {
  box.innerHTML = `<div class="card stack"><h2>Respaldo de la información</h2>
    <p>Descarga un archivo .zip con <b>toda la base de datos</b> (pacientes, historias clínicas, recetas, pedidos) y <b>todos los archivos de exámenes</b>.</p>
    <div class="warn">Recomendación: haga un respaldo cada semana y guárdelo en un disco externo o en una nube privada. El archivo contiene datos de salud: guárdelo en un lugar seguro.</div>
    <div><a class="btn pri" href="/api/respaldo" ${window.DEMO_API ? 'onclick="toast(\'En la demostración no hay respaldo: en el sistema instalado descarga un .zip\');return false"' : ""}>Descargar respaldo ahora</a></div></div>`;
}


/* =====================================================================
   CONSENTIMIENTOS INFORMADOS (Formulario 024 — AM 5316)
   ===================================================================== */
const CI_EST = { pendiente: ["Pendiente de firma", "new"], firmado: ["Firmado", "green"], negado: ["Paciente no acepta", "red"], revocado: ["Revocado", "grey"] };

async function documentosParaFirmar(pid, ids, done) {
  const docs = await Promise.all(ids.map(id => api("GET", "consentimientos/" + id)));
  const P = await api("GET", "pacientes/" + pid);
  const md = modal("Documentos para firma de la paciente", `
    <div class="info small" style="margin-bottom:12px">Se generaron estos documentos para <b>${esc(P.apellidos)} ${esc(P.nombres)}</b>. Imprímalos para que la paciente los lea y firme. El consentimiento del procedimiento lo explica y firma también el médico.</div>
    <div id="dl"></div>`, `<button class="btn pri" data-c>Listo</button>`);
  const draw = () => {
    $("#dl", md).innerHTML = docs.map((d, i) => `<div class="card row" style="margin-top:8px">
      <div class="grow"><b>${esc(d.titulo)}</b><div class="small"><span class="badge ${CI_EST[d.estado][1]}">${CI_EST[d.estado][0]}</span></div></div>
      <button class="btn" data-pr="${i}">🖨 Imprimir</button>
      ${d.estado === "pendiente" ? `<button class="btn ok" data-fi="${i}">✓ Marcar firmado</button>` : ""}</div>`).join("");
    $$("[data-pr]", md).forEach(b => b.onclick = () => imprimirCI(docs[+b.dataset.pr], P));
    $$("[data-fi]", md).forEach(b => b.onclick = async () => {
      const d = docs[+b.dataset.fi];
      try { await api("PUT", "consentimientos/" + d.id, { estado: "firmado" }); d.estado = "firmado"; draw(); toast("Registrado como firmado"); } catch (e) { fail(e); }
    });
  };
  draw();
  $("[data-c]", md).onclick = () => { md.close(); done && done(); };
}

async function tConsentimientos(box, ctx) {
  const { P, turno } = ctx;
  box.innerHTML = `<div class="empty">Cargando…</div>`;
  const lista = await api("GET", "consentimientos?paciente=" + P.id).catch(fail) || [];
  const plant = Object.entries(S.plantillas || {});
  box.innerHTML = `
    <div class="row" style="margin-bottom:12px"><h2 class="grow">Consentimientos informados</h2>
      <select id="nuevoCI" style="width:auto;max-width:420px"><option value="">＋ Generar consentimiento…</option>${plant.map(([k, p]) => `<option value="${k}">${esc(p.titulo)}</option>`).join("")}</select></div>
    <div class="info small" style="margin-bottom:14px">El documento se imprime, lo explica el profesional, la paciente lo firma (o pone su huella) y se archiva en su carpeta física. Aquí se registra el estado. La firma <b>no es requisito para la admisión</b>; si la paciente no acepta, se registra la negativa.</div>
    ${lista.length ? lista.map(d => `<div class="card">
      <div class="row"><b class="grow">${esc(d.titulo)}</b><span class="badge ${CI_EST[d.estado][1]}">${CI_EST[d.estado][0]}</span></div>
      <div class="small muted" style="margin-top:4px">Generado ${fmtD(d.fecha)}${d.firmado_en ? " · Firmado " + esc(d.firmado_en) : ""}${d.negado_en ? " · No aceptado " + esc(d.negado_en) : ""}${d.revocado_en ? " · Revocado " + esc(d.revocado_en) : ""}${d.usuario ? " · " + esc(d.usuario) : ""}</div>
      ${d.clave !== "datos" && d.estado === "pendiente" && isClin() ? `<label class="f" style="margin-top:10px"><span>Riesgos específicos de la paciente (se imprimen en el documento)</span><textarea rows="2" data-re="${d.id}">${esc(d.contenido.riesgos_especificos || "")}</textarea></label>` : (d.contenido.riesgos_especificos && d.clave !== "datos" ? `<div class="small" style="margin-top:8px"><b>Riesgos específicos:</b> ${esc(d.contenido.riesgos_especificos)}</div>` : "")}
      <div class="row" style="margin-top:10px;justify-content:flex-end">
        <button class="btn" data-pr="${d.id}">🖨 Imprimir</button>
        ${d.estado === "pendiente" ? `<button class="btn danger" data-st="${d.id}|negado">Paciente no acepta</button><button class="btn ok" data-st="${d.id}|firmado">✓ Marcar firmado</button>` : ""}
        ${d.estado === "firmado" ? `<button class="btn danger" data-st="${d.id}|revocado">Registrar revocatoria</button>` : ""}
      </div></div>`).join("") : `<div class="card empty">Esta paciente no tiene consentimientos generados.</div>`}`;
  const guardarRiesgos = async id => { const t = $(`[data-re="${id}"]`, box); if (t) await api("PUT", "consentimientos/" + id, { riesgos_especificos: t.value }); };
  $("#nuevoCI", box).onchange = async e => {
    if (!e.target.value) return;
    try { await api("POST", "consentimientos", { paciente_id: P.id, turno_id: turno ? turno.id : null, clave: e.target.value }); toast("Consentimiento generado"); ctx.reload(); } catch (er) { fail(er); }
  };
  $$("[data-re]", box).forEach(t => t.onchange = () => guardarRiesgos(t.dataset.re).then(() => toast("Guardado")).catch(fail));
  $$("[data-pr]", box).forEach(b => b.onclick = async () => { await guardarRiesgos(b.dataset.pr).catch(() => { }); imprimirCI(await api("GET", "consentimientos/" + b.dataset.pr), P); });
  $$("[data-st]", box).forEach(b => b.onclick = async () => {
    const [id, est] = b.dataset.st.split("|");
    const msg = { firmado: "¿Confirma que la paciente firmó el documento impreso y que quedó archivado?", negado: "¿Registrar que la paciente NO acepta el procedimiento? Debe firmar la sección de negativa del documento (o un testigo si no desea firmar).", revocado: "¿Registrar que la paciente revoca este consentimiento? Debe firmar la sección de revocatoria." }[est];
    if (!await confirmar(msg)) return;
    try { await guardarRiesgos(id).catch(() => { }); await api("PUT", "consentimientos/" + id, { estado: est }); toast("Registrado"); ctx.reload(); } catch (e) { fail(e); }
  });
}

function imprimirCI(d, P) {
  const c = d.contenido || {}, I = S.inst, T = S.textosCI || {};
  const ed = P.fecha_nac ? edad(P.fecha_nac, d.fecha) + " años" : "";
  const fill = t => String(t || "").replace("{ruc}", I.ruc || "").replace("{direccion}", I.direccion || "");
  const firmaBox = (titulo, lineas, huella) => `<div class="fbox"><div class="fsp"></div><div class="fln"></div><b>${titulo}</b>${lineas.map(l => `<div>${l}</div>`).join("")}${huella ? `<div class="hu">Huella<br>(si no sabe firmar)</div>` : ""}</div>`;
  const firmasPaciente = `<div class="firmas">
    ${firmaBox("Firma de la paciente", [`${esc(P.apellidos)} ${esc(P.nombres)}`, `C.I. ${esc(P.cedula)}`], true)}
    ${firmaBox("Profesional que informa", [`Nombre: ____________________________`, `Firma, sello y código`], false)}</div>
    <div class="firmas" style="margin-top:2mm">${firmaBox("Representante legal / quien firma por la paciente (si aplica)", ["Nombre y C.I.: _______________________", "Parentesco: __________  Teléfono: __________"], false)}<div></div></div>`;
  let cuerpo;
  if (d.clave === "datos") {
    cuerpo = `<div class="txt">${esc(fill(c.texto))}</div>
      <div class="decl">${esc(c.declaracion || "")}</div>
      <div class="fechahora">Fecha: ${fmtD(d.fecha)}      Hora: ________</div>
      <div class="firmas">${firmaBox("Firma de la paciente", [`${esc(P.apellidos)} ${esc(P.nombres)}`, `C.I. ${esc(P.cedula)}`], true)}${firmaBox("Recibido por (ISIM)", ["Nombre: ____________________________", "Firma"], false)}</div>`;
  } else {
    const sec = (n, t, v) => v ? `<div class="sec"><div class="st">${n}. ${t}</div><div class="sv">${esc(v)}</div></div>` : "";
    cuerpo = `
      ${sec(1, "Nombre del procedimiento", `${(t => t.charAt(0).toUpperCase() + t.slice(1))(c.titulo.replace(/^Consentimiento informado para /i, ""))}\nTipo: ${c.tipo || ""}`)}
      ${sec(2, "En qué consiste", c.que_es)}
      ${sec(3, "Cómo se realiza", c.como)}
      ${sec(4, "Duración aproximada", c.duracion)}
      ${sec(5, "Beneficios", c.beneficios)}
      <div class="sec"><div class="st">6. Riesgos</div><div class="sv"><b>Frecuentes (poco graves):</b> ${esc(c.riesgos_frecuentes)}<br><b>Poco frecuentes (graves):</b> ${esc(c.riesgos_raros)}<br><b>Específicos de la paciente:</b> ${esc(c.riesgos_especificos || "") || "________________________________________________________________"}</div></div>
      ${sec(7, "Alternativas al procedimiento", c.alternativas)}
      ${sec(8, "Manejo posterior y responsabilidades de la paciente", c.posterior)}
      ${sec(9, "Consecuencias posibles si no se realiza", c.no_realizar)}
      ${c.nota ? `<div class="nota">${esc(c.nota)}</div>` : ""}
      <div class="st2">DECLARACIÓN DE CONSENTIMIENTO INFORMADO</div>
      <div class="decl">${esc(T.declaracion || "")}</div>
      <div class="fechahora">Fecha: ${fmtD(d.fecha)}      Hora: ________</div>
      ${firmasPaciente}
      <div class="neg"><div class="st2">NEGATIVA DEL CONSENTIMIENTO INFORMADO</div><div class="decl">${esc(T.negativa || "")}</div>
        <div class="firmas3">${firmaBox("Paciente o representante", ["Nombre y C.I."], false)}${firmaBox("Profesional tratante", ["Firma y sello"], false)}${firmaBox("Testigo (si la paciente no desea firmar)", ["Nombre y C.I."], false)}</div><div class="fechahora">Fecha: ___/___/______</div></div>
      <div class="neg"><div class="st2">REVOCATORIA DEL CONSENTIMIENTO INFORMADO</div><div class="decl">${esc(T.revocatoria || "")} Fecha del consentimiento revocado: ${fmtD(d.fecha)}.</div>
        <div class="firmas3">${firmaBox("Paciente o representante", ["Nombre y C.I."], true)}${firmaBox("Profesional que recibe", ["Firma y sello"], false)}<div class="fechahora" style="align-self:end">Fecha: ___/___/______</div></div></div>`;
  }
  const html = `<div class="pg ci" style="padding:10mm 13mm 9mm">${cabecera(d.clave === "datos" ? "AUTORIZACIÓN" : "CONSENTIMIENTO INFORMADO")}
    <div class="tt">${esc(c.titulo)}</div>
    <table class="hc dg"><tr><td class="l">Establecimiento</td><td>${esc(I.nombre)}</td><td class="l">Servicio</td><td>Ginecología y Obstetricia</td></tr>
      <tr><td class="l">Paciente</td><td><b>${esc(P.apellidos)} ${esc(P.nombres)}</b></td><td class="l">C.I. / HCU</td><td>${esc(P.cedula)}</td></tr>
      <tr><td class="l">Edad</td><td>${ed}</td><td class="l">Tipo de atención</td><td>Ambulatoria</td></tr></table>
    ${cuerpo}
    <div class="note" style="margin-top:3mm">Documento N.º ${String(d.id).padStart(5, "0")} · Este documento forma parte de la historia clínica de la paciente.${d.clave !== "datos" ? " Formulario de consentimiento informado (estructura del Form. 024, AM 5316)." : ""}</div>
    <div class="bot"></div></div>`;
  return printDoc(html, "A4 portrait");
}

/* ---------- Ajustes: motivos y plantillas ---------- */
async function ajMotivos(box) {
  const a = await api("GET", "ajustes"); setAjustes(a);
  let mot = (a.motivos || []).map(x => ({ ...x }));
  const plant = a.consentimientos || {};
  const draw = () => {
    box.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px"><h2 class="grow">Motivos de cita</h2><button class="btn" id="addM">＋ Motivo</button><button class="btn pri" id="saveM">Guardar motivos</button></div>
      <p class="small muted">Lo que aparece en la lista desplegable al asignar un turno, y el consentimiento que se genera automáticamente.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Grupo</th><th>Motivo</th><th>Consentimiento que se genera</th><th></th></tr></thead><tbody>
      ${mot.map((x, i) => `<tr><td style="width:160px"><input data-mg="${i}" value="${esc(x.grupo)}"></td><td><input data-mm="${i}" value="${esc(x.motivo)}"></td>
        <td><select data-mc="${i}"><option value="">— Ninguno —</option>${Object.entries(plant).filter(([k]) => k !== "datos").map(([k, p]) => `<option value="${k}" ${x.consentimiento === k ? "selected" : ""}>${esc(p.titulo)}</option>`).join("")}</select></td>
        <td><button class="btn sm ghost danger" data-mx="${i}">✕</button></td></tr>`).join("")}</tbody></table></div></div>
      <div class="card"><h2 style="margin-bottom:10px">Plantillas de consentimiento</h2>
      <p class="small muted">Revise y adapte los textos a su práctica. Los cambios aplican a los documentos que se generen desde ahora.</p>
      ${Object.entries(plant).map(([k, p]) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)"><span class="grow">${esc(p.titulo)}</span><button class="btn sm" data-ep="${k}">Editar texto</button></div>`).join("")}</div>`;
    $$("[data-mg]", box).forEach(e => e.oninput = () => mot[+e.dataset.mg].grupo = e.value);
    $$("[data-mm]", box).forEach(e => e.oninput = () => mot[+e.dataset.mm].motivo = e.value);
    $$("[data-mc]", box).forEach(e => e.onchange = () => mot[+e.dataset.mc].consentimiento = e.value);
    $$("[data-mx]", box).forEach(e => e.onclick = () => { mot.splice(+e.dataset.mx, 1); draw(); });
    $("#addM", box).onclick = () => { mot.push({ grupo: "Otros", motivo: "", consentimiento: "" }); draw(); };
    $("#saveM", box).onclick = async () => { mot = mot.filter(x => x.motivo.trim()); try { await api("PUT", "ajustes", { motivos: mot }); S.motivos = mot; toast("Motivos guardados"); } catch (e) { fail(e); } };
    $$("[data-ep]", box).forEach(b => b.onclick = () => {
      const k = b.dataset.ep, p = plant[k];
      const campos = k === "datos" ? [["titulo", "Título"], ["texto", "Texto"], ["declaracion", "Declaración"]] :
        [["titulo", "Título"], ["tipo", "Tipo (diagnóstico / terapéutico)"], ["que_es", "En qué consiste"], ["como", "Cómo se realiza"], ["duracion", "Duración"], ["beneficios", "Beneficios"], ["riesgos_frecuentes", "Riesgos frecuentes"], ["riesgos_raros", "Riesgos poco frecuentes (graves)"], ["alternativas", "Alternativas"], ["posterior", "Manejo posterior"], ["no_realizar", "Consecuencias de no realizarlo"], ["nota", "Nota / contraindicaciones (opcional)"]];
      const md = modal("Editar plantilla", `<div class="stack">${campos.map(([f, l]) => `<label class="f"><span>${l}</span><textarea data-f="${f}" rows="${f === "texto" ? 14 : f === "titulo" || f === "tipo" || f === "duracion" ? 1 : 3}">${esc(p[f] || "")}</textarea></label>`).join("")}</div>`,
        `<button class="btn" data-c>Cancelar</button><button class="btn pri" id="ok">Guardar plantilla</button>`, true);
      $("[data-c]", md).onclick = md.close;
      $("#ok", md).onclick = async () => {
        $$("[data-f]", md).forEach(t => p[t.dataset.f] = t.value);
        try { await api("PUT", "ajustes", { consentimientos: plant }); S.plantillas = plant; md.close(); toast("Plantilla guardada"); draw(); } catch (e) { fail(e); }
      };
    });
  };
  draw();
}


/* =====================================================================
   CERTIFICADOS MÉDICOS (IESS y de atención)
   ===================================================================== */
const MES_UP = m => MESES[m].toUpperCase();
const anioLetras = y => y >= 2000 && y < 2100 ? "Dos mil" + (y % 100 ? " " + letras(y % 100) : "") : String(y);
function fechaIESS(f, ref) {
  const d = parseD(f);
  return `${f === ref ? "HOY " : ""}${DIAS[d.getDay()].toUpperCase()} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ( ${letras(d.getDate()).toUpperCase()} de ${MES_UP(d.getMonth())} del ${anioLetras(d.getFullYear())} )`;
}
const fechaLarga = f => { const d = parseD(f); return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
const diasEntre = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5) + 1;
/* el médico escribe el diagnóstico y se busca el CIE-10 solo (se puede corregir) */
const normTxt = t => (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9. ]/g, " ").replace(/\s+/g, " ").trim();
function buscarCIE(texto) {
  const t = normTxt(texto); if (t.length < 2) return [];
  const porCodigo = {}; CIE10.forEach(x => { if (!porCodigo[x[0]]) porCodigo[x[0]] = x; });
  const out = new Map();
  // 1) sinónimos de uso diario (el más largo que coincida gana)
  (window.CIE10_SINONIMOS || []).filter(([k]) => t === k || t.includes(k) && k.length > 3 || k.startsWith(t) && t.length > 3)
    .sort((a, b) => (b[0] === t) - (a[0] === t) || b[0].length - a[0].length)
    .forEach(([, c]) => { if (porCodigo[c] && !out.has(c)) out.set(c, [99, porCodigo[c]]); });
  // 2) código o texto de la descripción
  const ws = t.split(" ").filter(w => w.length > 2 && !["del", "de", "la", "las", "los", "por", "con", "sin", "una", "uno", "que", "mas"].includes(w));
  CIE10.forEach(x => {
    const [c, d] = x, dn = normTxt(d), dw = dn.split(" ");
    let sc = 0;
    if (c.toLowerCase().replace(".", "") === t.replace(/[ .]/g, "")) sc = 100;
    else if (dn === t) sc = 95;
    else if (dn.startsWith(t)) sc = 85;
    else if (ws.length) {
      const hit = ws.filter(w => dw.some(x => x.startsWith(w.slice(0, Math.max(4, w.length - 2))))).length;
      sc = 70 * hit / ws.length - dw.length * 0.5;
    }
    if (sc >= 40 && !out.has(c)) out.set(c, [sc, x]);
  });
  return [...out.values()].sort((a, b) => b[0] - a[0]).slice(0, 8).map(([, x]) => x);
}
function dxAuto(box, descSel, cieSel, listSel, onChange) {
  const di = $(descSel, box), ci = $(cieSel, box), li = $(listSel, box), hint = document.createElement("small");
  hint.className = "muted"; ci.closest("label").appendChild(hint);
  let cieManual = !!ci.value, tmr;
  const pintar = (rs) => {
    li.style.display = rs.length ? "block" : "none";
    li.innerHTML = rs.map(([c, d], i) => `<div data-i="${i}"><b>${c}</b> ${esc(d)}</div>`).join("");
    $$("[data-i]", li).forEach(el => el.onmousedown = e => { e.preventDefault(); const [c, d] = rs[+el.dataset.i]; di.value = d; ci.value = c; cieManual = false; hint.textContent = "✓ código asignado"; li.style.display = "none"; onChange && onChange(); });
  };
  di.addEventListener("input", () => {
    clearTimeout(tmr);
    tmr = setTimeout(() => {
      const rs = buscarCIE(di.value); pintar(rs);
      if (!cieManual) {
        if (rs.length) { ci.value = rs[0][0]; hint.innerHTML = `Sugerido: <b>${rs[0][0]}</b> ${esc(rs[0][1])} — puede corregirlo`; }
        else { ci.value = ""; hint.textContent = di.value.trim().length > 2 ? "No encontré el código: escríbalo a mano" : ""; }
      }
      onChange && onChange();
    }, 200);
  });
  di.addEventListener("blur", () => setTimeout(() => li.style.display = "none", 150));
  ci.addEventListener("input", () => { cieManual = !!ci.value.trim(); hint.textContent = cieManual ? "Código corregido a mano" : ""; onChange && onChange(); });
}
const mdBold = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

async function tCertificados(box, ctx) {
  const { P, consulta, turno } = ctx;
  const prev = await api("GET", "certificados?paciente=" + P.id).catch(() => []);
  const dxC = (consulta?.datos?.diagnosticos || []);
  const fum = consulta?.datos?.fum || P.fum || "";
  const emb0 = !!(consulta?.datos?.embarazo) || !!gestacion(fum);
  const g0 = gestacion(fum);
  const trat = (P.estado_civil || "").startsWith("Soltera") ? "Srta." : "Sra.";
  const medSel = await selectMedico(consulta);
  box.innerHTML = `
    ${medSel ? `<div class="grid g4" style="margin-bottom:12px">${medSel}</div>` : ""}
    ${!S.membretes.embarazo || !S.membretes.gineco ? `<div class="warn" style="margin-bottom:12px">Todavía no se han subido las hojas membretadas (Materno Fetal y Salud Femenina). Mientras tanto los certificados salen con el encabezado del ISIM. ${isAdmin() ? `<a href="#/ajustes/membretes">Subirlas en Ajustes ›</a>` : "Pídale al administrador que las suba."}</div>` : ""}
    <div class="acc" data-acc="iess"><header><span class="ic">🏛</span>Certificado para el IESS<span class="chev">›</span></header><div class="b"><form id="fi">
      <div class="grid g4" style="margin-top:12px">
        <label class="f"><span>Tratamiento</span>${sel("tratamiento", ["Sra.", "Srta."], trat)}</label>
        ${inp("empresa", "Institución / empresa", P.empresa, "span2")}
        ${inp("puesto", "Puesto de trabajo", P.puesto)}
        <label class="f"><span>Fecha de emisión</span><input type="date" name="fecha" value="${today()}"></label>
        <div class="small muted span3" style="align-self:end;padding-bottom:10px">Se toman de los datos de la paciente: correo <b>${esc(P.email || "— no registrado —")}</b> · teléfono <b>${esc(P.telefono || "—")}</b> · HC <b>${esc(P.hc_numero || P.cedula)}</b>${!P.email ? ` · <a href="#/paciente/${P.id}?${turno ? "t=" + turno.id + "&" : ""}tab=datos">agregar correo</a>` : ""}</div>
      </div>
      <h3 style="margin:16px 0 8px">Diagnóstico</h3>
      <div class="grid g4">
        <label class="chk" style="align-self:end;padding-bottom:8px"><input type="checkbox" name="embarazo" value="1" ${emb0 ? "checked" : ""}><span><b>Embarazada</b></span></label>
        <label class="f emb"><span>Semanas de embarazo</span><input name="semanas" value="${g0 ? g0.sem : ""}" inputmode="numeric"></label>
        <label class="f emb"><span>Días (opcional)</span><input name="dias_eg" value="${g0 && g0.dias ? g0.dias : ""}" inputmode="numeric"></label>
        <div class="small muted emb" style="align-self:end;padding-bottom:10px">${fum ? "Por FUM " + fmtD(fum) + (g0 ? ": " + g0.txt : "") : "Sin FUM registrada"}</div>
        <div class="ac span3"><label class="f"><span>Diagnóstico (escríbalo con sus palabras)</span><input name="dx_base" value="${esc(dxC.map(x => x.desc).join(" y "))}" placeholder="Ej.: amenaza de parto prematuro, hiperemesis, infección urinaria…" autocomplete="off"></label><div class="ac-list" id="cil" style="display:none"></div></div>
        <label class="f"><span>Código CIE-10 (automático)</span><input name="cie" value="${esc(dxC.map(x => x.cie).join(" + "))}"></label>
        <label class="f spanall"><span>Así saldrá en el certificado (puede corregirlo)</span><textarea name="diagnostico" rows="2">${esc(dxC.map(x => x.desc).join(" y "))}</textarea></label>
      </div>
      <div class="grid g4" style="margin-top:8px">
        <label class="f"><span>Presenta síntomas</span>${sel("sintomas", ["Si", "No"], "Si")}</label>
        <label class="f"><span>Enfermedad</span>${sel("enfermedad", ["Si", "No"], "Si")}</label>
        <label class="f"><span>Aislamiento</span>${sel("aislamiento", ["No", "Si"], "No")}</label><span></span>
        <label class="f"><span>Días de reposo</span><input name="dias_reposo" type="number" min="1" value="3" style="font-size:18px;font-weight:600"></label>
        <label class="f"><span>Desde</span><input type="date" name="desde" value="${today()}"></label>
        <div class="small" id="ndias" style="align-self:end;padding-bottom:10px"></div>
        <label class="f"><span>Hoja membretada</span>${sel("hoja", [["embarazo", "Materno Fetal (embarazo)"], ["gineco", "Salud Femenina (ginecología)"]], emb0 ? "embarazo" : "gineco")}</label>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn pri">Generar e imprimir certificado IESS</button></div></form></div></div>

    <div class="acc" data-acc="atencion"><header><span class="ic">📄</span>Certificado de consulta / procedimiento / embarazo<span class="chev">›</span></header><div class="b"><form id="fa">
      <div class="grid g4" style="margin-top:12px">
        <label class="f"><span>Tipo</span>${sel("subtipo", [["consulta", "De consulta (asistencia)"], ["procedimiento", "De procedimiento"], ["embarazo", "De embarazo"]], emb0 ? "embarazo" : "consulta")}</label>
        <label class="f"><span>Fecha de atención</span><input type="date" name="fecha_atencion" value="${turno ? turno.fecha : today()}"></label>
        <label class="f"><span>Hora</span><input type="time" name="hora" value="${turno ? turno.hora : ""}"></label>
        <label class="f"><span>Fecha de emisión</span><input type="date" name="fecha" value="${today()}"></label>
        <label class="f span2 t-proc"><span>Procedimiento realizado</span><input name="procedimiento" list="procs" value="${esc(turno && ciDe(turno.motivo) && /colposcop|LEEP|láser|HIFU|Emsella|PRP|DIU/i.test(turno.motivo) ? turno.motivo : "")}"><datalist id="procs">${(S.motivos || []).filter(m => ["Procedimientos", "Gineco-estética", "Ecografía"].includes(m.grupo)).map(m => `<option>${esc(m.motivo)}</option>`).join("")}</datalist></label>
        <label class="f t-emb"><span>Semanas de embarazo</span><input name="semanas" value="${g0 ? g0.sem : ""}"></label>
        <label class="f t-emb"><span>Días</span><input name="dias_eg" value="${g0 && g0.dias ? g0.dias : ""}"></label>
        <label class="f t-emb"><span>FUM</span><input type="date" name="fum" value="${esc(fum)}"></label>
        <label class="f t-emb"><span>Último control</span><input type="date" name="ultimo_control" value="${turno ? turno.fecha : today()}"></label>
        <label class="chk span2" style="align-self:end;padding-bottom:8px"><input type="checkbox" name="con_dx" value="1"><span>Incluir diagnóstico</span></label>
        <div class="ac span2"><label class="f"><span>Diagnóstico (escríbalo)</span><input name="dx" value="${esc(dxC.map(x => x.desc).join(" y "))}" autocomplete="off"></label><div class="ac-list" id="cal" style="display:none"></div></div>
        <label class="f"><span>CIE-10 (automático)</span><input name="dx_cie" value="${esc(dxC.map(x => x.cie).join(" + "))}"></label>
        <label class="f"><span>Días de reposo (0 = ninguno)</span><input name="reposo" value="0" inputmode="numeric"></label>
        <label class="f"><span>Reposo desde (si hay)</span><input type="date" name="reposo_desde" value="${today()}"></label>
        <label class="f"><span>Hoja membretada</span>${sel("hoja", [["embarazo", "Materno Fetal (embarazo)"], ["gineco", "Salud Femenina (ginecología)"]], emb0 ? "embarazo" : "gineco")}</label>
        <label class="f spanall"><span>Información adicional (opcional: derivaciones, indicaciones, etc.)</span><textarea name="extra" rows="2"></textarea></label>
      </div>
      <div class="row" style="margin:12px 0 6px"><h3 class="grow">Texto del certificado</h3><button type="button" class="btn sm" id="regen">↻ Volver a armar el texto</button></div>
      <textarea name="texto" rows="9" style="font-size:13px"></textarea>
      <p class="small muted">Puede corregir el texto libremente. Lo que va entre **dos asteriscos** sale en negrita.</p>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn pri">Generar e imprimir certificado</button></div></form></div></div>

    <h3 style="margin:20px 0 10px">Certificados emitidos</h3>
    ${prev.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>N.º</th><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Médico</th><th></th></tr></thead><tbody>
      ${prev.map(c => `<tr><td>${c.numero}</td><td>${fmtD(c.fecha)}</td><td>${c.tipo === "iess" ? `<span class="badge">IESS</span>` : `<span class="badge green">${esc({ consulta: "Consulta", procedimiento: "Procedimiento", embarazo: "Embarazo" }[c.datos.subtipo] || "Atención")}</span>`}</td>
        <td class="small">${esc(c.tipo === "iess" ? `${c.datos.diagnostico} · ${fmtD(c.datos.desde)} al ${fmtD(c.datos.hasta)}` : (c.datos.procedimiento || c.datos.dx || ""))}</td><td class="small">${esc(c.medico || "")}</td>
        <td class="right"><button class="btn sm" data-rc="${c.id}">Reimprimir</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted small">Ninguno todavía.</p>`}`;

  $$("[data-acc]>header", box).forEach(h => h.onclick = () => h.parentElement.classList.toggle("open"));
  $$("[data-rc]", box).forEach(b => b.onclick = async () => imprimirCert(await api("GET", "certificados/" + b.dataset.rc), P));

  /* --- IESS --- */
  const fi = $("#fi", box);
  let dxManual = false;
  const armarDx = () => {
    if (dxManual) return;
    const f = leerForm(fi), base = (f.dx_base || "").trim();
    const emb = f.embarazo ? `Embarazo de ${f.semanas || "__"} semanas${f.dias_eg ? " " + f.dias_eg + " días" : ""}` : "";
    const b2 = base ? base.charAt(0).toUpperCase() + base.slice(1) : "";
    $("[name=diagnostico]", fi).value = emb && b2 ? `${emb} más un cuadro de ${b2}` : (emb || b2);
  };
  const updI = () => {
    const emb = $("[name=embarazo]", fi).checked;
    $$(".emb", fi).forEach(e => e.style.visibility = emb ? "" : "hidden");
    const d = $("[name=desde]", fi).value, n = parseInt($("[name=dias_reposo]", fi).value) || 0;
    $("#ndias", fi).innerHTML = d && n > 0 ? `Hasta el <b>${DIAS[parseD(addDays(d, n - 1)).getDay()]} ${fmtD(addDays(d, n - 1))}</b>` : `<span style="color:var(--red)">Ponga los días</span>`;
  };
  $("[name=diagnostico]", fi).oninput = () => dxManual = true;
  ["embarazo", "semanas", "dias_eg"].forEach(n => $(`[name=${n}]`, fi).addEventListener("input", () => { dxManual = false; armarDx(); }));
  $("[name=embarazo]", fi).addEventListener("change", () => { $("[name=hoja]", fi).value = $("[name=embarazo]", fi).checked ? "embarazo" : "gineco"; dxManual = false; armarDx(); updI(); });
  fi.addEventListener("input", updI);
  $("[name=dx_base]", fi).addEventListener("input", () => { dxManual = false; armarDx(); });
  dxAuto(fi, "[name=dx_base]", "[name=cie]", "#cil", () => { dxManual = false; armarDx(); });
  armarDx(); updI();
  fi.onsubmit = async e => {
    e.preventDefault();
    const d = leerForm(fi);
    const n = parseInt(d.dias_reposo) || 0;
    if (n < 1) return toast("Ponga los días de reposo", true);
    d.hasta = addDays(d.desde, n - 1);
    try {
      const mid = $("[name=medico_id]", box)?.value;
      const r = await api("POST", "certificados", { paciente_id: P.id, tipo: "iess", fecha: d.fecha, datos: d, medico_id: mid ? +mid : null });
      toast("Certificado N.º " + r.numero + " generado");
      await imprimirCert(await api("GET", "certificados/" + r.id), P);
      ctx.reload();
    } catch (er) { fail(er); }
  };

  /* --- Atención --- */
  const fa = $("#fa", box);
  const ed = P.fecha_nac ? edad(P.fecha_nac) : "";
  const armarTexto = () => {
    const f = leerForm(fa), st = f.subtipo, I = S.inst;
    const quien = `La ${trat === "Srta." ? "señorita" : "señora"} **${P.apellidos} ${P.nombres}**, portadora de la cédula de ciudadanía N.° **${P.cedula}**${ed !== "" ? `, de ${ed} años de edad` : ""}`;
    const cuando = `el día **${fechaLarga(f.fecha_atencion)}**${f.hora ? ` a las ${f.hora}` : ""}`;
    const medNom = (() => { const sm = $("[name=medico_id]", box); return sm ? sm.options[sm.selectedIndex].text.split(" — ")[0] : S.user.nombre; })();
    const p = [`Yo, **${medNom}**, ${I.presentacion_cert || "médico gineco-obstetra, especialista en Medicina Materno Fetal y Director Médico del Instituto de Salud Integral de la Mujer (ISIM)"}, **CERTIFICO** que:`];
    if (st === "consulta") p.push(`${quien}, acudió a consulta médica en el Instituto de Salud Integral de la Mujer ${cuando}.`);
    if (st === "procedimiento") p.push(`${quien}, fue atendida en el Instituto de Salud Integral de la Mujer ${cuando}, donde se le realizó el procedimiento de **${f.procedimiento || "__________"}**.`);
    if (st === "embarazo") {
      const g = gestacion(f.fum, f.fecha);
      p.push(`${quien}, se encuentra bajo mi control prenatal y cursa actualmente un **embarazo de ${f.semanas || "__"} semanas${f.dias_eg ? " y " + f.dias_eg + " días" : ""} de gestación**.`);
      const l = [];
      if (f.fum) l.push(`**Fecha de última menstruación (FUM):** ${fechaLarga(f.fum)}.`);
      if (g) l.push(`**Fecha probable de parto (FPP):** ${fechaLarga(g.fpp)}.`);
      if (f.ultimo_control) l.push(`**Último control prenatal:** ${fechaLarga(f.ultimo_control)}.`);
      if (l.length) p.push(l.join("\n"));
    }
    if (f.con_dx && f.dx) p.push(`**Diagnóstico:** ${f.dx.charAt(0).toUpperCase() + f.dx.slice(1)}${f.dx_cie ? ` (CIE-10: ${f.dx_cie})` : ""}.`);
    const n = parseInt(f.reposo) || 0;
    if (n > 0) p.push(`Se indica **reposo médico de ${n} (${letras(n)}) día${n > 1 ? "s" : ""}**, desde el ${fechaLarga(f.reposo_desde)} hasta el ${fechaLarga(addDays(f.reposo_desde, n - 1))}.`);
    if (f.extra.trim()) p.push(f.extra.trim());
    p.push("Es todo cuanto puedo certificar en honor a la verdad.");
    $("[name=texto]", fa).value = p.join("\n\n");
  };
  const updA = () => {
    const st = $("[name=subtipo]", fa).value;
    $$(".t-proc", fa).forEach(e => e.style.display = st === "procedimiento" ? "" : "none");
    $$(".t-emb", fa).forEach(e => e.style.display = st === "embarazo" ? "" : "none");
  };
  let textoManual = false;
  $("[name=texto]", fa).oninput = () => textoManual = true;
  fa.addEventListener("input", e => { if (e.target.name !== "texto") { updA(); if (!textoManual) armarTexto(); } });
  fa.addEventListener("change", e => { if (e.target.name === "subtipo") $("[name=hoja]", fa).value = e.target.value === "embarazo" ? "embarazo" : "gineco"; updA(); if (!textoManual) armarTexto(); });
  $("#regen", fa).onclick = () => { textoManual = false; armarTexto(); };
  const smc = $("[name=medico_id]", box); if (smc) smc.addEventListener("change", () => { if (!textoManual) armarTexto(); });
  dxAuto(fa, "[name=dx]", "[name=dx_cie]", "#cal", () => { if (!$("[name=con_dx]", fa).checked && $("[name=dx]", fa).value.trim()) $("[name=con_dx]", fa).checked = true; if (!textoManual) armarTexto(); });
  updA(); armarTexto();
  fa.onsubmit = async e => {
    e.preventDefault();
    const d = leerForm(fa);
    if (!d.texto.trim()) return toast("El texto está vacío", true);
    try {
      const mid = $("[name=medico_id]", box)?.value;
      const r = await api("POST", "certificados", { paciente_id: P.id, tipo: "atencion", fecha: d.fecha, datos: d, medico_id: mid ? +mid : null });
      toast("Certificado N.º " + r.numero + " generado");
      await imprimirCert(await api("GET", "certificados/" + r.id), P);
      ctx.reload();
    } catch (er) { fail(er); }
  };
}

function hojaMembretada(tipo, contenido) {
  const M = S.membretes || {}, img = M[tipo];
  if (!img) return `<div class="pg cert" style="padding:12mm 18mm 14mm">${cabecera("")}<div class="cc">${contenido}</div><div class="bot"></div></div>`;
  return `<div class="mb"><img class="mbg" src="${img}"><div class="mbc cert" style="top:${M.top ?? 42}mm;bottom:${M.bottom ?? 82}mm;left:${M.lado ?? 22}mm;right:${M.lado ?? 22}mm">${contenido}</div></div>`;
}
function imprimirCert(c, P) {
  const d = c.datos, I = S.inst;
  const lineasFirma = t => String(t || c.medico || "").split("\n").filter(Boolean);
  let cont;
  if (c.tipo === "iess") {
    const box = v => `<span class="sq">${v ? "x" : ""}</span>`;
    const sn = v => v === "Si" ? `Si ${box(1)}&nbsp;&nbsp;&nbsp;&nbsp; NO ${box(0)}` : `Si ${box(0)}&nbsp;&nbsp;&nbsp;&nbsp; NO ${box(1)}`;
    const fl = (k, v) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`;
    const fe = parseD(c.fecha);
    const firma = lineasFirma(c.firma_iess);
    cont = `<div class="ti">CERTIFICADO MEDICO</div>
      <div class="bar">Datos Paciente</div>
      <table class="ctab">
        ${fl("Nombres y Apellidos", `${esc(d.tratamiento || "Sra.")}: ${esc(P.apellidos)} ${esc(P.nombres)}`)}
        ${fl("Cedula de Identidad", esc(P.cedula))}
        ${fl("Numero de Historia Clínica", esc(P.hc_numero || P.cedula))}
        ${fl("Teléfono", esc(P.telefono || ""))}
        ${fl("Dirección Domiciliaria", esc([P.direccion, P.canton].filter(Boolean).join(" – ").toUpperCase()))}
        ${fl("Institución / Empresa", esc((d.empresa || "").toUpperCase()))}
        ${fl("Puesto de Trabajo", esc((d.puesto || "").toUpperCase()))}
        ${fl("Correo Electronico", esc(P.email || ""))}
      </table>
      <table class="ctab" style="margin-top:5mm">
        ${fl("Diagnostico", esc(d.diagnostico))}
        ${fl("Código", `(CIE 10 ${esc(d.cie)})`)}
        ${fl("Presenta Síntomas", sn(d.sintomas))}
        ${fl("Enfermedad", sn(d.enfermedad))}
        ${fl("Aislamiento", sn(d.aislamiento))}
        ${fl("Desde", esc(fechaIESS(d.desde, c.fecha)))}
        ${fl("Hasta", esc(fechaIESS(d.hasta, "")))}
      </table>
      <p class="b" style="margin-top:6mm">Es todo cuanto puedo certificar en honor a la verdad.</p>
      <p class="b">${esc(I.ciudad || "Riobamba")}, ${fe.getDate()} de ${MES_UP(fe.getMonth())} de ${fe.getFullYear()}</p>
      <p class="b" style="margin-top:6mm">Atentamente,</p>
      <div style="height:14mm"></div>
      <div class="fl">${firma.map((l, i) => `<div>${i === 0 ? "" : ""}${esc(l)}</div>`).join("")}</div>`;
  } else {
    const fe = parseD(c.fecha);
    const firma = lineasFirma(c.firma_cert);
    const tit = d.subtipo === "embarazo" ? "CERTIFICADO MÉDICO DE EMBARAZO" : "CERTIFICADO MÉDICO";
    cont = `<div class="ti2">${tit}</div>
      <p class="r">${esc(I.ciudad || "Riobamba")}, ${fe.getDate()} de ${MESES[fe.getMonth()]} de ${fe.getFullYear()}</p>
      ${String(d.texto).split(/\n\s*\n/).map(par => `<p class="j">${mdBold(par).replace(/\n/g, "<br>")}</p>`).join("")}
      <div style="height:13mm"></div>
      <div class="fc"><div>_______________________________</div>${firma.map((l, i) => `<div>${i === 0 ? `<b>${esc(l)}</b>` : esc(l)}</div>`).join("")}</div>
      <p class="nt">Nota: El presente certificado se expide a petición de la paciente, quien puede hacer uso del mismo como estime conveniente.</p>`;
  }
  return printDoc(hojaMembretada(d.hoja || "gineco", cont), "A4 portrait");
}

/* ---------- Ajustes: hojas membretadas ---------- */
async function ajMembretes(box) {
  const a = await api("GET", "ajustes"); setAjustes(a);
  const M = { top: 42, bottom: 82, lado: 22, ...(a.membretes || {}) };
  const tarjeta = (k, t) => `<div class="card"><h3>${t}</h3>
    <div class="row" style="margin-top:10px;align-items:flex-start">
      <div style="width:150px;height:212px;border:1px solid var(--line);border-radius:6px;background:#f5f6f9;display:grid;place-items:center;overflow:hidden">${M[k] ? `<img src="${M[k]}" style="width:100%;height:100%;object-fit:cover">` : `<span class="small muted">Sin imagen</span>`}</div>
      <div class="stack grow"><p class="small muted">Suba la hoja membretada en blanco (imagen JPG o PNG de la hoja A4 completa, sin texto del certificado).</p>
        <input type="file" accept="image/*" data-up="${k}">${M[k] ? `<button class="btn sm danger" data-rm="${k}">Quitar</button>` : ""}</div></div></div>`;
  box.innerHTML = `<h2 style="margin-bottom:12px">Hojas membretadas para certificados</h2>
    <div class="grid g2">${tarjeta("embarazo", "Medicina Materno Fetal (embarazo)")}${tarjeta("gineco", "Salud Femenina de Calidad (ginecología)")}</div>
    <div class="card"><h3>Área donde se escribe el texto</h3><p class="small muted">Márgenes en milímetros para que el texto no tape el encabezado ni el pie de la hoja.</p>
      <div class="grid g4" style="margin-top:10px">
        <label class="f"><span>Arriba (mm)</span><input type="number" id="mt" value="${M.top}"></label>
        <label class="f"><span>Abajo (mm)</span><input type="number" id="mbo" value="${M.bottom}"></label>
        <label class="f"><span>Lados (mm)</span><input type="number" id="ml" value="${M.lado}"></label>
        <div style="align-self:end"><button class="btn pri" id="sv">Guardar márgenes</button> <button class="btn" id="pv">Vista de prueba</button></div></div></div>`;
  const guardar = async () => { try { await api("PUT", "ajustes", { membretes: M }); S.membretes = M; toast("Guardado"); ajMembretes(box); } catch (e) { fail(e); } };
  $$("[data-up]", box).forEach(inp => inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => { // reducir a 150 ppp para que sea liviana
        const W = 1240, H = Math.round(W * im.height / im.width);
        const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.drawImage(im, 0, 0, W, H);
        M[inp.dataset.up] = cv.toDataURL("image/jpeg", 0.85); guardar();
      };
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
  });
  $$("[data-rm]", box).forEach(b => b.onclick = () => { delete M[b.dataset.rm]; guardar(); });
  $("#sv", box).onclick = () => { M.top = +$("#mt", box).value; M.bottom = +$("#mbo", box).value; M.lado = +$("#ml", box).value; guardar(); };
  $("#pv", box).onclick = () => {
    const prueba = `<div class="ti2">CERTIFICADO MÉDICO</div><p class="r">Riobamba, 20 de noviembre de 2026</p>${"<p class='j'>Texto de prueba del certificado para revisar que el contenido quede dentro del área blanca de la hoja membretada, sin tapar el encabezado ni el pie.</p>".repeat(5)}<div class="fc" style="margin-top:12mm"><div>_______________________________</div><div><b>Firma del médico</b></div></div>`;
    printDoc(hojaMembretada(S.membretes.embarazo ? "embarazo" : "gineco", prueba), "A4 portrait");
  };
}


/* =====================================================================
   PERMISOS: médico tratante y resumen de historia (recepción / enfermería)
   ===================================================================== */
async function selectMedico(consulta) {
  if (!S.medicos) S.medicos = await api("GET", "medicos").catch(() => []);
  const ms = S.medicos || [];
  if (isClin() && ms.length <= 1) return "";
  const def = consulta?.medico_id || (isClin() ? S.user.id : (ms[0] || {}).id);
  if (!ms.length) return `<div class="warn small spanall">No hay médicos configurados para firmar. El administrador debe registrar la especialidad del médico en Ajustes → Usuarios.</div>`;
  return `<label class="f span2"><span>Médico tratante (firma el documento)</span><select name="medico_id">${ms.map(m => `<option value="${m.id}" ${m.id === def ? "selected" : ""}>${esc(m.nombre)}${m.especialidad ? " — " + esc(m.especialidad) : ""}</option>`).join("")}</select></label>`;
}

async function tHistoriaResumen(box, P) {
  box.innerHTML = `<div class="empty">Cargando…</div>`;
  const vis = await api("GET", "historia-resumen/" + P.id).catch(fail) || [];
  const atendidas = vis.filter(v => v.estado === "atendido" || v.consulta_estado);
  // embarazo actual: la última visita marcada como embarazo (o la FUM de la ficha)
  const ultEmb = vis.find(v => v.embarazo && (v.consulta_estado || v.estado === "atendido"));
  const fum = (ultEmb && ultEmb.fum) || P.fum || "";
  const g = gestacion(fum);
  const gUlt = ultEmb ? gestacion(fum, ultEmb.fecha) : null;
  const proxima = vis.filter(v => v.fecha >= today() && v.estado !== "atendido" && v.estado !== "noasistio").pop();
  const EST = { agendado: ["Agendado", ""], espera: ["En espera", "new"], atendido: ["Atendida", "green"], noasistio: ["No asistió", "grey"] };
  box.innerHTML = `
    <div class="info small" style="margin-bottom:14px">Vista resumida de la historia clínica. El detalle de cada consulta solo lo ven los médicos.</div>
    <div class="grid g3" style="margin-bottom:14px">
      <div class="card" style="margin:0"><div class="small muted">Visitas atendidas</div><div style="font-size:26px;font-weight:600;color:var(--navy)">${atendidas.length}</div>
        <div class="small">Última: <b>${atendidas[0] ? fmtD(atendidas[0].fecha) : "—"}</b>${atendidas[0] && atendidas[0].motivo ? " · " + esc(atendidas[0].motivo) : ""}</div></div>
      <div class="card" style="margin:0;${g ? "border-color:var(--green-line);background:#fbfefc" : ""}"><div class="small muted">Embarazo</div>
        ${g ? `<div style="font-size:22px;font-weight:600;color:var(--green)">${g.sem} semanas ${g.dias ? "y " + g.dias + " días" : ""}</div>
          <div class="small">Hoy, por FUM ${fmtD(fum)} · FPP <b>${fmtD(g.fpp)}</b></div>
          ${ultEmb ? `<div class="small">Último control: <b>${fmtD(ultEmb.fecha)}</b>${gUlt ? ` (tenía ${gUlt.txt})` : ""}</div>` : ""}`
          : `<div style="font-size:16px;color:var(--muted);margin-top:4px">No registra embarazo actual</div>`}</div>
      <div class="card" style="margin:0"><div class="small muted">Próxima cita</div><div style="font-size:18px;font-weight:600;color:var(--navy)">${proxima ? fmtD(proxima.fecha) + " · " + hm12(proxima.hora) : "—"}</div>
        <div class="small">${proxima && proxima.motivo ? esc(proxima.motivo) : ""}</div>
        <div class="small" style="margin-top:4px">Alergias: <b style="color:${P.alergias && !/no refiere/i.test(P.alergias) ? "var(--red)" : "inherit"}">${esc(P.alergias || "no registradas")}</b></div></div>
    </div>
    <h3 style="margin-bottom:8px">Fechas en que vino</h3>
    ${vis.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Hora</th><th>Motivo</th><th>Estado</th><th>Embarazo</th></tr></thead><tbody>
      ${vis.map(v => { const gv = v.embarazo ? gestacion(v.fum || fum, v.fecha) : null; const e = EST[v.estado] || [v.estado, ""];
        return `<tr><td><b>${fmtD(v.fecha)}</b> <span class="small muted">${DIAS[parseD(v.fecha).getDay()]}</span></td><td>${hm12(v.hora)}</td><td>${esc(v.motivo || "—")}${v.tipo === "emergencia" ? ' <span class="badge red">Emergencia</span>' : ""}</td>
          <td><span class="badge ${e[1]}">${e[0]}</span></td><td>${gv ? `<span class="badge green">${gv.txt}</span>` : v.embarazo ? `<span class="badge green">Sí</span>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<div class="card empty">La paciente todavía no tiene visitas registradas.</div>`}`;
}

boot();
