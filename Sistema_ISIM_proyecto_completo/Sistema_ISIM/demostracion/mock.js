/* ===== DEMOSTRACIÓN: servidor simulado dentro del navegador ===== */
(function () {
  const KEY = "isim_demo_v5";
  const pad = n => String(n).padStart(2, "0");
  const d0 = new Date();
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hoy = () => iso(new Date());
  const ahora = () => { const d = new Date(); return `${iso(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const addD = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const clone = o => JSON.parse(JSON.stringify(o));

  function seed() {
    const db = {
      seq: {}, sesion: null,
      usuarios: [
        { id: 1, usuario: "medico", pw: "demo1234", nombre: "Dr. Jorge Augusto Paredes Pérez", rol: "admin", especialidad: "Gineco-Obstetra · Medicina Materno Fetal", registro: "(su registro)", activo: 1, creado: ahora(),
          firma_cert: "Dr. Jorge Augusto Paredes Pérez\nGineco-Obstetra – Medicina Materno Fetal\nDirector Médico – Instituto de Salud Integral de la Mujer (ISIM)",
          firma_iess: "Dr. Jorge Augusto Paredes Pérez\nGINECOLOGO OBSTETRA\nC.I 060147063-6\nMail: jorgeparedes_perez@yahoo.com" },
        { id: 2, usuario: "recepcion", pw: "demo1234", nombre: "Recepción ISIM", rol: "recepcion", especialidad: "", registro: "", activo: 1, creado: ahora() },
        { id: 3, usuario: "enfermeria", pw: "demo1234", nombre: "Irma Villa", rol: "enfermeria", especialidad: "", registro: "", activo: 1, creado: ahora() },
        { id: 4, usuario: "admin", pw: "demo1234", nombre: "Administrador del sistema", rol: "admin", especialidad: "", registro: "", activo: 1, creado: ahora() }],
      pacientes: [
        { id: 1, tipo_doc: "cedula", cedula: "0603002791", apellidos: "GUAÑO TOABANDA", nombres: "SUSANA", fecha_nac: "1981-03-10", sexo: "F", telefono: "0999999999", canton: "Riobamba", provincia: "Chimborazo", nacionalidad: "Ecuatoriana", alergias: "No refiere", ant_personales: "Hipertensión arterial (enalapril 10 mg/día)", nota_importante: "HIPERTENSA en tratamiento con enalapril. Controlar PA en cada consulta.", gestas: "3", partos: "2", cesareas: "1", abortos: "0", hijos_vivos: "3", mac: "Ninguno", consentimiento_datos: "Demo", creado: ahora() },
        { id: 2, tipo_doc: "cedula", cedula: "1710034065", apellidos: "PÉREZ LÓPEZ", nombres: "MARÍA JOSÉ", fecha_nac: "1993-05-20", sexo: "F", telefono: "0987654321", canton: "Riobamba", provincia: "Chimborazo", nacionalidad: "Ecuatoriana", fum: addD(-140), gestas: "1", partos: "0", cesareas: "0", abortos: "0", consentimiento_datos: "Demo", creado: ahora() }],
      turnos: [], consultas: [], certificados: [], consulta_notas: [], recetas: [], examenes: [], archivos: [], pedidos: [], auditoria: [],
      medicamentos: clone(SEED_MEDS), esquemas: clone(SEED_ESQ),
      ajustes: { horario: clone(SEED_HOR), institucion: clone(SEED_INST), motivos: clone(SEED_MOT), consentimientos: clone(SEED_PLANT) }, consentimientos: [],
    };
    db.seq = { usuarios: 4, pacientes: 2, turnos: 0, consultas: 0, consulta_notas: 0, recetas: 0, examenes: 0, archivos: 0, pedidos: 0, auditoria: 0, medicamentos: db.medicamentos.length, esquemas: db.esquemas.length, consentimientos: 0, certificados: 0 };
    // consulta anterior de Susana (hace 2 meses)
    const tPrev = { id: ++db.seq.turnos, fecha: addD(-60), hora: "10:00", jornada: "manana", tipo: "normal", cupo: 1, paciente_id: 1, motivo: "Consulta por síntomas", estado: "atendido", creado_por: 2, creado: ahora() };
    db.turnos.push(tPrev);
    db.consultas.push({ id: ++db.seq.consultas, paciente_id: 1, turno_id: tPrev.id, fecha: tPrev.fecha, medico_id: 1, estado: "cerrada", cerrada_en: tPrev.fecha + " 10:25:00", creado: ahora(),
      datos: { motivo: "Dolor pélvico bajo y leucorrea de 1 semana", enfermedad_actual: "Refiere dolor en hipogastrio tipo cólico, intensidad 5/10, acompañado de leucorrea amarillenta.", pa_sis: "115", pa_dia: "75", fc: "78", temp: "36.8", peso: "62", talla: "155", examen_gineco: "Dolor a la movilización de anexos. Leucorrea amarillenta.", diagnosticos: [{ cie: "N70.9", desc: "Salpingitis y ooforitis, no especificadas (anexitis)", tipo: "DEF" }], plan: "Tratamiento antibiótico y control en 15 días." } });
    db.recetas.push({ id: ++db.seq.recetas, numero: 1, paciente_id: 1, consulta_id: 1, fecha: tPrev.fecha, medico_id: 1, anulada: 0, creado: ahora(),
      datos: { diagnostico: "Anexitis", cie: "N70.9", alergias: "No refiere", para_pareja: 0, recomendaciones: "Completar el tratamiento prescrito.\nAbstinencia sexual durante el tratamiento.\nAcudir a control.",
        items: db.esquemas.find(e => e.nombre === "Anexitis").items } });
    const tPrev2 = { id: ++db.seq.turnos, fecha: addD(-30), hora: "16:00", jornada: "tarde", tipo: "normal", cupo: 1, paciente_id: 1, motivo: "Control de tratamiento", estado: "atendido", creado_por: 2, creado: ahora() };
    db.turnos.push(tPrev2);
    db.consultas.push({ id: ++db.seq.consultas, paciente_id: 1, turno_id: tPrev2.id, fecha: tPrev2.fecha, medico_id: 1, estado: "cerrada", cerrada_en: tPrev2.fecha + " 16:20:00", creado: ahora(),
      datos: { motivo: "Control post tratamiento de anexitis", enfermedad_actual: "Refiere mejoría del dolor pélvico. Persiste leucorrea escasa blanquecina.", pa_sis: "140", pa_dia: "90", fc: "80", peso: "62", talla: "155",
        examen_gineco: "Cérvix con ectropión. Leucorrea blanquecina escasa. Anexos no dolorosos.", diagnosticos: [{ cie: "N76.0", desc: "Vaginitis aguda", tipo: "DEF" }, { cie: "N86", desc: "Erosión y ectropión del cuello del útero", tipo: "PRE" }, { cie: "I10", desc: "Hipertensión esencial (primaria)", tipo: "DEF" }],
        plan: "Tratamiento de vaginitis. Programar colposcopia. Continuar enalapril.", proxima_cita: addD(0) } });
    db.consentimientos.push({ id: ++db.seq.consentimientos, paciente_id: 1, turno_id: 1, clave: "datos", titulo: SEED_PLANT.datos.titulo, fecha: addD(-60), estado: "firmado", firmado_en: addD(-60) + " 09:58:00", contenido: clone(SEED_PLANT.datos), creado_por: 2, actualizado_por: 2, creado: ahora() });
    db.consentimientos.push({ id: ++db.seq.consentimientos, paciente_id: 1, turno_id: 1, clave: "atencion_gineco", titulo: SEED_PLANT.atencion_gineco.titulo, fecha: addD(-60), estado: "firmado", firmado_en: addD(-60) + " 10:02:00", contenido: { ...clone(SEED_PLANT.atencion_gineco), riesgos_especificos: "Enfermedades: Hipertensión arterial" }, creado_por: 2, actualizado_por: 1, creado: ahora() });
    db.pedidos = [{ id: 1, numero: 1, paciente_id: 1, tipo: "colposcopia", fecha: addD(-30), datos: { fecha: addD(-30), diagnostico: "Erosión y ectropión del cuello del útero", cie: "N86", motivos: ["Lesión cervical visible"], incluye: "Colposcopia con biopsia dirigida" }, medico_id: 1, turno_id: tPrev2.id, estado: "pendiente", elaborado_por: 1, creado: ahora() },
      { id: 2, numero: 2, paciente_id: 1, tipo: "laboratorio", fecha: addD(-30), datos: { fecha: addD(-30), diagnostico: "Vaginitis aguda", cie: "N76.0", examenes: ["Biometría hemática completa", "Elemental y microscópico de orina (EMO)"], preparacion: "Ayuno de 8 a 12 horas" }, medico_id: 1, turno_id: tPrev2.id, estado: "pendiente", elaborado_por: 1, creado: ahora() }];
    db.seq.pedidos = 2;
    // turnos de hoy
    const H = db.ajustes.horario.lv;
    const dw = new Date().getDay();
    const hm = dw >= 1 && dw <= 5 ? H.manana : ["08:30"];
    db.turnos.push({ id: ++db.seq.turnos, fecha: hoy(), hora: hm[0], jornada: "manana", tipo: dw >= 1 && dw <= 5 ? "normal" : "extra", cupo: 1, paciente_id: 1, motivo: "Control de tratamiento", estado: "espera", creado_por: 2, creado: ahora() });
    db.turnos.push({ id: ++db.seq.turnos, fecha: hoy(), hora: hm[1] || "09:00", jornada: "manana", tipo: dw >= 1 && dw <= 5 ? "normal" : "extra", cupo: 1, paciente_id: 2, motivo: "Control de embarazo + ecografía obstétrica", estado: "agendado", creado_por: 2, creado: ahora() });
    db.consentimientos.push({ id: ++db.seq.consentimientos, paciente_id: 2, turno_id: db.seq.turnos, clave: "datos", titulo: SEED_PLANT.datos.titulo, fecha: hoy(), estado: "pendiente", contenido: clone(SEED_PLANT.datos), creado_por: 2, actualizado_por: 2, creado: ahora() });
    db.consentimientos.push({ id: ++db.seq.consentimientos, paciente_id: 2, turno_id: db.seq.turnos, clave: "control_prenatal", titulo: SEED_PLANT.control_prenatal.titulo, fecha: hoy(), estado: "pendiente", contenido: { ...clone(SEED_PLANT.control_prenatal), riesgos_especificos: "" }, creado_por: 2, actualizado_por: 2, creado: ahora() });
    return db;
  }
  let DB;
  try { DB = JSON.parse(localStorage.getItem(KEY)); } catch (e) { }
  if (!DB) DB = seed();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(DB, (k, v) => k === "url" && String(v).startsWith("blob:") ? undefined : v)); } catch (e) { } };
  window.DEMO_RESET = () => { try { localStorage.removeItem(KEY); } catch (e) { } location.hash = ""; location.reload(); };

  class E extends Error { }
  const err = m => { throw new E(m); };
  const nid = t => ++DB.seq[t];
  const user = () => DB.usuarios.find(u => u.id === DB.sesion && u.activo);
  const pub = u => u && { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, especialidad: u.especialidad, registro: u.registro, firma_cert: u.firma_cert || "", firma_iess: u.firma_iess || "" };
  const audit = (u, accion, entidad, eid, detalle) => { DB.auditoria.unshift({ id: nid("auditoria"), fecha: ahora(), usuario_id: u && u.id, accion, entidad, entidad_id: eid ?? null, detalle: detalle || "", ip: "demo" }); DB.auditoria.length = Math.min(DB.auditoria.length, 500); };
  const cedOk = c => { if (!/^\d{10}$/.test(c)) return false; const p = +c.slice(0, 2); if (!((p >= 1 && p <= 24) || p === 30) || +c[2] > 5) return false; let s = 0; for (let i = 0; i < 9; i++) { let d = +c[i] * (i % 2 ? 1 : 2); s += d > 9 ? d - 9 : d; } return (10 - s % 10) % 10 === +c[9]; };
  const ADMIN_F = ["tipo_doc", "cedula", "apellidos", "nombres", "fecha_nac", "sexo", "estado_civil", "instruccion", "ocupacion", "nacionalidad", "etnia", "direccion", "parroquia", "canton", "provincia", "telefono", "email", "contacto_nombre", "contacto_parentesco", "contacto_telefono", "alergias", "ant_personales", "ant_quirurgicos", "consentimiento_datos", "observaciones", "empresa", "puesto", "hc_numero"];
  const ADMIN_R = [...ADMIN_F, "nota_importante"];
  const turnoView = t => { const p = DB.pacientes.find(x => x.id === t.paciente_id); const c = DB.consultas.find(x => x.turno_id === t.id);
    return { ...t, cedula: p.cedula, apellidos: p.apellidos, nombres: p.nombres, fecha_nac: p.fecha_nac, telefono: p.telefono, nota_importante: p.nota_importante,
      ci_pendientes: DB.consentimientos.filter(c => c.paciente_id === p.id && c.estado === "pendiente").length,
      n_consultas: DB.consultas.filter(x => x.paciente_id === p.id && x.estado === "cerrada" && x.turno_id !== t.id).length, consulta_estado: c ? c.estado : null }; };
  const medInfo = id => { const u = DB.usuarios.find(x => x.id === id) || {}; return { medico: u.nombre, especialidad: u.especialidad, registro: u.registro, firma_cert: u.firma_cert, firma_iess: u.firma_iess }; };
  function validarPac(b, pid) {
    for (const [k, l] of [["cedula", "cédula / documento"], ["apellidos", "apellidos"], ["nombres", "nombres"]]) if (k in b && !(b[k] || "").trim()) err("Falta " + l);
    if (pid == null) {
      for (const [k, l] of [["cedula", "cédula"], ["apellidos", "apellidos"], ["nombres", "nombres"], ["fecha_nac", "fecha de nacimiento"], ["telefono", "teléfono"]]) if (!(b[k] || "").trim()) err("Falta " + l);
      if (!b.consentimiento_datos) err("Debe registrar el consentimiento de la paciente para el tratamiento de sus datos personales (LOPDP).");
    }
    if ("cedula" in b && (b.tipo_doc || "cedula") === "cedula" && !cedOk(b.cedula.trim())) err("El número de cédula no es válido (verifique los 10 dígitos).");
    if ("cedula" in b && DB.pacientes.some(p => p.cedula === b.cedula.trim() && p.id !== pid)) err("Ya existe una paciente con esa cédula");
    if (b.apellidos) b.apellidos = b.apellidos.trim().toUpperCase();
    if (b.nombres) b.nombres = b.nombres.trim().toUpperCase();
  }
  function crearCI(u, pid, tid, clave, pl, fecha) {
    const p = DB.pacientes.find(x => x.id === pid) || {}; const cont = clone(pl);
    if (clave !== "datos") {
      const nr = v => v && !["no refiere", "ninguna", "no"].includes(norm(v));
      cont.riesgos_especificos = [nr(p.alergias) ? "Alergias: " + p.alergias : "", nr(p.ant_personales) ? "Enfermedades: " + p.ant_personales : "", p.nota_importante || ""].filter(Boolean).join(". ");
    }
    const c = { id: nid("consentimientos"), paciente_id: pid, turno_id: tid || null, clave, titulo: pl.titulo, fecha, estado: "pendiente", contenido: cont, creado_por: u.id, actualizado_por: u.id, creado: ahora() };
    DB.consentimientos.push(c); audit(u, "generar", "consentimiento", c.id, c.titulo); return c.id;
  }
  function generarCI(u, pid, tid, motivo, fecha) {
    const pl = DB.ajustes.consentimientos, nuevos = [], vivo = c => ["pendiente", "firmado"].includes(c.estado);
    if (pl.datos && !DB.consentimientos.some(c => c.paciente_id === pid && c.clave === "datos" && vivo(c))) nuevos.push(crearCI(u, pid, tid, "datos", pl.datos, fecha));
    const clave = (DB.ajustes.motivos.find(x => x.motivo === motivo) || {}).consentimiento;
    if (clave && pl[clave]) {
      const lim = new Date(fecha); lim.setDate(lim.getDate() - 365); const limS = iso(lim);
      const ya = clave === "atencion_gineco" ? DB.consentimientos.some(c => c.paciente_id === pid && c.clave === clave && vivo(c) && c.fecha >= limS)
        : DB.consentimientos.some(c => c.turno_id === tid && c.clave === clave);
      if (!ya) nuevos.push(crearCI(u, pid, tid, clave, pl[clave], fecha));
    }
    return nuevos;
  }
  function cerrar(u, c, datos) {
    if (!(datos.motivo || "").trim()) err("Para firmar la consulta llene el motivo de consulta.");
    if (!datos.diagnosticos || !datos.diagnosticos.length) err("Para firmar la consulta registre al menos un diagnóstico (CIE-10).");
    c.estado = "cerrada"; c.cerrada_en = ahora(); c.medico_id = u.id;
    const t = DB.turnos.find(x => x.id === c.turno_id); if (t) t.estado = "atendido";
    audit(u, "firmar", "consulta", c.id);
  }

  function handle(m, path, b) {
    const [p0, qs] = path.split("?"); const q = Object.fromEntries(new URLSearchParams(qs || ""));
    const parts = p0.split("/").filter(Boolean), r0 = parts[0], id1 = +parts[1];
    b = b ? clone(b) : {};
    if (r0 === "estado") return { necesita_instalacion: false, usuario: pub(user()), institucion: DB.ajustes.institucion };
    if (r0 === "login") {
      const u = DB.usuarios.find(x => x.usuario === (b.usuario || "").trim().toLowerCase() && x.activo && x.pw === b.password);
      if (!u) err("Usuario o contraseña incorrectos"); DB.sesion = u.id; audit(u, "login", "usuario", u.id); return { usuario: pub(u) };
    }
    if (r0 === "logout") { DB.sesion = null; return { ok: true }; }
    const u = user(); if (!u) err("Sesión expirada. Vuelva a ingresar.");
    const clin = u.rol === "admin" || u.rol === "medico";
    const need = (...roles) => { if (u.rol !== "admin" && !roles.includes(u.rol)) err("Su usuario no tiene acceso a esta sección."); };
    const tratante = (consulta_id) => {
      let mid = b.medico_id;
      if (!mid && clin) return u.id;
      if (!mid && consulta_id) mid = (DB.consultas.find(c => c.id === consulta_id) || {}).medico_id;
      if (!mid) err("Seleccione el médico tratante que firma el documento.");
      if (!DB.usuarios.some(x => x.id === +mid && ["admin", "medico"].includes(x.rol) && x.activo)) err("El médico seleccionado no es válido.");
      return +mid;
    };
    if (r0 === "medicos") return DB.usuarios.filter(x => ["admin", "medico"].includes(x.rol) && x.activo && (x.especialidad || x.registro || x.firma_cert)).map(x => ({ id: x.id, nombre: x.nombre, especialidad: x.especialidad, registro: x.registro }));
    if (r0 === "historia-resumen") {
      audit(u, "ver", "resumen_hc", id1);
      return DB.turnos.filter(t => t.paciente_id === id1).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora)).map(t => {
        const c = DB.consultas.find(x => x.turno_id === t.id);
        return { id: t.id, fecha: t.fecha, hora: t.hora, tipo: t.tipo, motivo: t.motivo, estado: t.estado, consulta_estado: c ? c.estado : null, embarazo: c && c.datos.embarazo ? 1 : 0, fum: c ? c.datos.fum || "" : "" };
      });
    }
    const needAdmin = () => { if (u.rol !== "admin") err("Solo el administrador puede hacer esto."); };

    if (r0 === "consentimientos") {
      need("medico", "recepcion");
      if (m === "GET") {
        if (parts[1]) { const c = DB.consentimientos.find(x => x.id === id1); if (!c) err("No encontrado"); return { ...clone(c), profesional: medInfo(c.actualizado_por).medico }; }
        return DB.consentimientos.filter(c => c.paciente_id === +q.paciente).slice().reverse().map(c => ({ ...clone(c), usuario: medInfo(c.actualizado_por).medico }));
      }
      if (m === "POST") { const pl = DB.ajustes.consentimientos[b.clave]; if (!pl) err("Plantilla no encontrada"); return { id: crearCI(u, b.paciente_id, b.turno_id, b.clave, pl, b.fecha || hoy()) }; }
      const c = DB.consentimientos.find(x => x.id === id1);
      if ("riesgos_especificos" in b) { if (c.estado !== "pendiente") err("El documento ya fue firmado o negado; no se puede modificar."); c.contenido.riesgos_especificos = b.riesgos_especificos; }
      if (b.estado) {
        const ok = { pendiente: ["firmado", "negado"], firmado: ["revocado"] }[c.estado] || [];
        if (!ok.includes(b.estado)) err(`No se puede pasar de '${c.estado}' a '${b.estado}'.`);
        c.estado = b.estado; c[{ firmado: "firmado_en", negado: "negado_en", revocado: "revocado_en" }[b.estado]] = ahora(); c.actualizado_por = u.id;
      }
      audit(u, b.estado || "editar", "consentimiento", c.id, c.titulo); return { ok: true };
    }
    if (r0 === "ajustes") { if (m === "GET") return { ...clone(DB.ajustes), textos_ci: SEED_TXT }; needAdmin(); Object.assign(DB.ajustes, b); audit(u, "editar", "ajustes"); return { ok: true }; }
    if (r0 === "usuarios") {
      needAdmin();
      if (m === "GET") return DB.usuarios.map(({ pw, ...x }) => x);
      if (m === "POST") { if ((b.password || "").length < 8) err("La contraseña debe tener al menos 8 caracteres"); if (DB.usuarios.some(x => x.usuario === b.usuario.trim().toLowerCase())) err("Ya existe ese usuario");
        const x = { id: nid("usuarios"), usuario: b.usuario.trim().toLowerCase(), pw: b.password, nombre: b.nombre, rol: b.rol, especialidad: b.especialidad || "", registro: b.registro || "", activo: 1, creado: ahora() }; DB.usuarios.push(x); return { id: x.id }; }
      const x = DB.usuarios.find(y => y.id === id1);
      if (x.id === u.id && (b.activo == 0 || b.rol !== "admin")) err("No puede quitarse a sí mismo el acceso de administrador");
      Object.assign(x, { nombre: b.nombre, rol: b.rol, especialidad: b.especialidad, registro: b.registro, activo: +(b.activo ?? 1), firma_cert: b.firma_cert || "", firma_iess: b.firma_iess || "" });
      if (b.password) { if (b.password.length < 8) err("La contraseña debe tener al menos 8 caracteres"); x.pw = b.password; }
      return { ok: true };
    }
    if (r0 === "mi-clave") { if (b.actual !== u.pw) err("La contraseña actual no es correcta"); if ((b.nueva || "").length < 8) err("La nueva contraseña debe tener al menos 8 caracteres"); u.pw = b.nueva; return { ok: true }; }

    if (r0 === "pacientes") {
      if (m === "GET" && !parts[1]) {
        const t = (q.q || "").trim(); if (t.length < 2) return [];
        const ws = t.split(/\s+/).map(norm);
        return DB.pacientes.filter(p => p.cedula.includes(t) || ws.every(w => norm(p.apellidos + " " + p.nombres).includes(w)))
          .sort((a, b) => (a.apellidos + a.nombres).localeCompare(b.apellidos + b.nombres)).slice(0, 30)
          .map(p => ({ id: p.id, cedula: p.cedula, apellidos: p.apellidos, nombres: p.nombres, fecha_nac: p.fecha_nac, telefono: p.telefono }));
      }
      if (m === "GET") { const p = DB.pacientes.find(x => x.id === id1); if (!p) err("Paciente no encontrada"); audit(u, "ver", "paciente", p.id);
        return clone(p); }
      if (m === "POST") { validarPac(b); const keys = Object.keys(b).filter(k => clin || k !== "nota_importante");
        const p = { id: nid("pacientes"), sexo: "F", nacionalidad: "Ecuatoriana", canton: "Riobamba", provincia: "Chimborazo", tipo_doc: "cedula", creado: ahora(), creado_por: u.id };
        keys.forEach(k => { if (b[k] !== "" && b[k] != null) p[k] = typeof b[k] === "string" ? b[k].trim() : b[k]; }); DB.pacientes.push(p); audit(u, "crear", "paciente", p.id, p.cedula); return { id: p.id }; }
      if (m === "PUT") { validarPac(b, id1); const p = DB.pacientes.find(x => x.id === id1); const keys = Object.keys(b).filter(k => clin || k !== "nota_importante");
        keys.forEach(k => p[k] = typeof b[k] === "string" ? b[k].trim() : b[k]); p.actualizado = ahora(); audit(u, "editar", "paciente", p.id); return { ok: true }; }
    }
    if (r0 === "turnos") {
      if (m === "GET") {
        if (parts[1]) { const t = DB.turnos.find(x => x.id === id1); return t ? turnoView(t) : {}; }
        const f = q.fecha || hoy(), h = q.hasta || f;
        return DB.turnos.filter(t => t.fecha >= f && t.fecha <= h).map(turnoView);
      }
      need("medico", "recepcion");
      if (m === "POST") {
        if (!DB.pacientes.some(p => p.id === b.paciente_id)) err("Paciente no encontrada");
        if ((b.tipo || "normal") === "normal" && DB.turnos.some(t => t.fecha === b.fecha && t.hora === b.hora && t.tipo === "normal" && t.cupo === (b.cupo || 1))) err("Ese cupo ya fue ocupado. Actualice la pantalla.");
        const dup = DB.turnos.find(t => t.fecha === b.fecha && t.paciente_id === b.paciente_id);
        if (dup && !b.forzar) err(`La paciente ya tiene turno ese día a las ${dup.hora}.`);
        const t = { id: nid("turnos"), fecha: b.fecha, hora: b.hora, jornada: b.jornada, tipo: b.tipo || "normal", cupo: b.cupo || 1, paciente_id: b.paciente_id, motivo: b.motivo || "", estado: "agendado", creado_por: u.id, creado: ahora() };
        DB.turnos.push(t); audit(u, "crear", "turno", t.id, t.fecha + " " + t.hora); return { id: t.id, consentimientos: generarCI(u, t.paciente_id, t.id, t.motivo, t.fecha) };
      }
      if (m === "PUT") { const t = DB.turnos.find(x => x.id === id1); ["estado", "motivo", "hora"].forEach(k => { if (k in b) t[k] = b[k]; }); audit(u, "editar", "turno", t.id); return { ok: true }; }
      if (m === "DELETE") { if (DB.consultas.some(c => c.turno_id === id1)) err("Ese turno ya tiene una consulta registrada; no se puede eliminar."); DB.turnos = DB.turnos.filter(t => t.id !== id1); audit(u, "eliminar", "turno", id1); return { ok: true }; }
    }
    if (r0 === "historia") {
      need("medico");
      audit(u, "ver", "historia_clinica", id1);
      const cons = DB.consultas.filter(c => c.paciente_id === id1).map(c => ({ ...clone(c), medico: medInfo(c.medico_id).medico,
        recetas: clone(DB.recetas.filter(r => r.consulta_id === c.id)), notas: DB.consulta_notas.filter(n => n.consulta_id === c.id).map(n => ({ ...n, usuario: medInfo(n.usuario_id).medico })) }));
      DB.recetas.filter(r => r.paciente_id === id1 && !r.consulta_id).forEach(r => {
        let ent = cons.find(x => x.sin_consulta && x.fecha === r.fecha);
        if (!ent) { ent = { id: -r.id, fecha: r.fecha, sin_consulta: 1, estado: "sin", medico: medInfo(r.medico_id).medico, datos: {}, recetas: [], notas: [] }; cons.push(ent); }
        ent.recetas.push(clone(r));
      });
      return cons.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
    }
    if (r0 === "consultas") {
      if (m === "GET") { const c = q.turno ? DB.consultas.find(x => x.turno_id === +q.turno) : DB.consultas.find(x => x.id === id1); if (!c) return {};
        const r = clone(c); if (!clin) r.datos = { diagnosticos: c.datos.diagnosticos || [], embarazo: c.datos.embarazo, fum: c.datos.fum || "" }; return r; }
      need("medico");
      if (m === "POST" && parts[2] === "nota") { if (!(b.texto || "").trim()) err("Escriba la nota"); DB.consulta_notas.push({ id: nid("consulta_notas"), consulta_id: id1, texto: b.texto.trim(), usuario_id: u.id, fecha: ahora() }); audit(u, "nota_aclaratoria", "consulta", id1); return { ok: true }; }
      if (m === "POST") {
        if (b.turno_id && DB.consultas.some(c => c.turno_id === b.turno_id)) err("Ya existe una consulta para este turno");
        const c = { id: DB.seq.consultas + 1, paciente_id: b.paciente_id, turno_id: b.turno_id, fecha: b.fecha || hoy(), medico_id: u.id, datos: b.datos || {}, estado: "borrador", creado: ahora() };
        if (b.cerrar) cerrar(u, c, c.datos);
        DB.seq.consultas++; DB.consultas.push(c); audit(u, "crear", "consulta", c.id); return { id: c.id };
      }
      if (m === "PUT") { const c = DB.consultas.find(x => x.id === id1); if (c.estado === "cerrada") err("La consulta ya está firmada y cerrada. Solo puede añadir una nota aclaratoria.");
        if (b.cerrar) { const tmp = { ...c }; cerrar(u, tmp, b.datos || {}); Object.assign(c, tmp); }
        c.datos = b.datos || {}; c.actualizado = ahora(); audit(u, "editar", "consulta", c.id); return { id: c.id }; }
    }
    if (r0 === "recetas") {
      need("medico", "recepcion");
      if (m === "GET") { if (parts[1]) { const r = DB.recetas.find(x => x.id === id1); return { ...clone(r), ...medInfo(r.medico_id), elaborado: medInfo(r.elaborado_por).medico }; }
        return clone(DB.recetas.filter(r => r.paciente_id === +q.paciente)).reverse().map(r => ({ ...r, medico: medInfo(r.medico_id).medico })); }
      if (m === "POST") {
        if (!b.consulta_id && !b.turno_id) err("La receta debe estar asociada a la atención (turno) del día.");
        if (!(b.datos.diagnostico || "").trim()) err("Escriba el diagnóstico de la receta");
        const mid = tratante(b.consulta_id);
        const items = b.datos.items || []; if (!items.length) err("Agregue al menos un medicamento");
        if (items.some(i => !i.generico || !i.cantidad || !i.indicacion)) err("Cada medicamento necesita nombre genérico, cantidad e indicaciones");
        const num = Math.max(0, ...DB.recetas.map(r => r.numero)) + 1;
        const r = { id: nid("recetas"), numero: num, paciente_id: b.paciente_id, consulta_id: b.consulta_id || null, turno_id: b.turno_id || null, fecha: b.fecha || hoy(), medico_id: mid, elaborado_por: u.id, datos: b.datos, anulada: 0, creado: ahora() };
        DB.recetas.push(r); audit(u, "crear", "receta", r.id, "N.º " + num); return { id: r.id, numero: num };
      }
    }
    if (r0 === "medicamentos") {
      need("medico", "recepcion");
      if (m === "GET") return clone(DB.medicamentos).sort((a, b) => b.activo - a.activo || a.comercial.localeCompare(b.comercial));
      const v = { comercial: b.comercial.trim(), generico: b.generico.trim(), forma: b.forma || "", via: b.via || "", unidad: b.unidad || "", cantidad: +b.cantidad || null, indicacion: b.indicacion || "", activo: +(b.activo ?? 1) };
      if (m === "POST") { const x = { id: nid("medicamentos"), ...v }; DB.medicamentos.push(x); return { id: x.id }; }
      Object.assign(DB.medicamentos.find(x => x.id === id1), v); return { ok: true };
    }
    if (r0 === "esquemas") {
      need("medico", "recepcion"); if (m !== "GET") need("medico");
      if (m === "GET") return clone(DB.esquemas).sort((a, b) => a.nombre.localeCompare(b.nombre));
      if (m === "DELETE") { DB.esquemas = DB.esquemas.filter(x => x.id !== id1); return { ok: true }; }
      const v = { nombre: b.nombre, diagnostico: b.diagnostico || "", cie: b.cie || "", items: b.items || [], recomendaciones: b.recomendaciones || "", para_pareja: +b.para_pareja || 0 };
      if (m === "POST") { const x = { id: nid("esquemas"), ...v }; DB.esquemas.push(x); return { id: x.id }; }
      Object.assign(DB.esquemas.find(x => x.id === id1), v); return { ok: true };
    }
    if (r0 === "examenes") {
      need("medico", "recepcion", "enfermeria");
      if (m === "GET") return DB.examenes.filter(e => e.paciente_id === +q.paciente).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
        .map(e => ({ ...e, autor: medInfo(e.creado_por).medico, archivos: DB.archivos.filter(a => a.examen_id === e.id).map(a => ({ id: a.id, nombre: a.nombre, mime: a.mime, tamano: a.tamano, url: a.url })) }));
      if (!(b.texto || "").trim() && !(b.archivos || []).length) err("Escriba el informe o adjunte al menos un archivo");
      const e = { id: nid("examenes"), paciente_id: b.paciente_id, tipo: b.tipo, fecha: b.fecha || hoy(), titulo: b.titulo || "", texto: b.texto || "", creado_por: u.id, pedido_id: b.pedido_id || null, creado: ahora() };
      if (b.pedido_id) { const pd = DB.pedidos.find(x => x.id === b.pedido_id); if (pd) pd.estado = "resultado"; }
      DB.examenes.push(e);
      (b.archivos || []).forEach(a => { let url = a.data; if (a.data.length > 1500000) try { const bin = atob(a.data.split(",")[1]); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); url = URL.createObjectURL(new Blob([arr], { type: a.mime })); } catch (x) { }
        DB.archivos.push({ id: nid("archivos"), examen_id: e.id, nombre: a.nombre, mime: a.mime, tamano: 0, url }); });
      audit(u, "crear", "examen", e.id, e.tipo); return { id: e.id };
    }
    if (r0 === "pedidos") {
      need("medico", "recepcion", "enfermeria");
      if (m === "GET") { if (parts[1]) { const p = DB.pedidos.find(x => x.id === id1); return { ...clone(p), ...medInfo(p.medico_id) }; }
        return clone(DB.pedidos.filter(p => p.paciente_id === +q.paciente)).reverse(); }
      need("medico", "recepcion");
      if (m === "PUT") { DB.pedidos.find(x => x.id === id1).estado = b.estado || "pendiente"; return { ok: true }; }
      const mid = tratante();
      const num = Math.max(0, ...DB.pedidos.map(p => p.numero)) + 1;
      const p = { id: nid("pedidos"), numero: num, paciente_id: b.paciente_id, tipo: b.tipo, fecha: b.fecha || hoy(), datos: b.datos, medico_id: mid, turno_id: b.turno_id || null, estado: "pendiente", elaborado_por: u.id, creado: ahora() };
      DB.pedidos.push(p); audit(u, "crear", "pedido", p.id, p.tipo); return { id: p.id, numero: num };
    }
    if (r0 === "certificados") {
      need("medico", "recepcion");
      if (m === "GET") { if (parts[1]) { const c = DB.certificados.find(x => x.id === id1); return { ...clone(c), ...medInfo(c.medico_id) }; }
        return DB.certificados.filter(c => c.paciente_id === +q.paciente).slice().reverse().map(c => ({ ...clone(c), medico: medInfo(c.medico_id).medico })); }
      const d = b.datos || {};
      if (!["iess", "atencion"].includes(b.tipo)) err("Tipo de certificado no válido");
      if (b.tipo === "iess") {
        for (const [k, l] of [["diagnostico", "el diagnóstico"], ["cie", "el código CIE-10"], ["desde", "la fecha desde"], ["hasta", "la fecha hasta"]]) if (!String(d[k] || "").trim()) err("Falta " + l);
        if (d.hasta < d.desde) err("La fecha 'hasta' no puede ser anterior a 'desde'");
        const p = DB.pacientes.find(x => x.id === b.paciente_id); p.empresa = d.empresa || ""; p.puesto = d.puesto || "";
      }
      const num = Math.max(0, ...DB.certificados.map(c => c.numero)) + 1;
      const c = { id: nid("certificados"), numero: num, paciente_id: b.paciente_id, tipo: b.tipo, fecha: b.fecha || hoy(), datos: d, medico_id: tratante(), elaborado_por: u.id, creado: ahora() };
      DB.certificados.push(c); audit(u, "crear", "certificado", c.id, c.tipo); return { id: c.id, numero: num };
    }
    if (r0 === "auditoria") { needAdmin(); return DB.auditoria.map(a => ({ ...a, usuario: medInfo(a.usuario_id).medico })); }
    err("Ruta no encontrada");
  }

  window.DEMO_API = async (m, path, body) => {
    await new Promise(r => setTimeout(r, 40));
    try { const res = handle(m, path, body); save(); return res; }
    catch (e) { if (e instanceof E) { save(); throw new Error(e.message); } console.error(e); throw new Error("Error en la demostración: " + e.message); }
  };

  // vista previa de impresión (el visor no permite imprimir)
  window.DEMO_PRINT = (html, page) => new Promise(res => {
    const dims = { "A5 landscape": [210, 148], "A5 portrait": [148, 210], "A4 portrait": [210, 297] }[page] || [210, 297];
    const w = document.createElement("div"); w.className = "mback";
    w.innerHTML = `<div class="modal wide" style="max-width:${dims[0] * 3.78 + 60}px"><header><h2>Vista previa de impresión · ${page.replace("landscape", "horizontal").replace("portrait", "vertical")}</h2><button class="btn ghost" data-x>✕</button></header>
      <div class="b" style="background:#e9ecf2"><div class="info small" style="margin-bottom:12px">En la demostración solo se muestra la vista previa. En el sistema instalado este botón abre el cuadro de impresión (o "Guardar como PDF").</div>
      <iframe style="width:${dims[0]}mm;height:${dims[1] + 14}mm;border:0;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.18);display:block;margin:0 auto"></iframe></div>
      <footer><button class="btn pri" data-x>Cerrar</button></footer></div>`;
    document.getElementById("modal-root").appendChild(w);
    w.querySelector("iframe").srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>${html}${FIT_JS}</body></html>`;
    w.querySelectorAll("[data-x]").forEach(b => b.onclick = () => { w.remove(); res(); });
  });

  // franja de demostración
  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:60;background:#fff6e0;color:#7a5210;border:1px solid #f0d9a0;border-radius:10px;padding:8px 12px;font:12px Poppins,system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.1);max-width:330px";
    bar.innerHTML = `<span id="dfull"><b>DEMOSTRACIÓN</b> — datos de prueba, solo en este navegador.<br>Usuarios: <b>medico</b> (Dr. Paredes) · <b>admin</b> · <b>recepcion</b> · <b>enfermeria</b> (Irma Villa)<br>Clave de todos: <b>demo1234</b><br><a href="#" id="dreset" style="color:#7a5210">Borrar todo y empezar de nuevo</a> · <a href="#" id="dmin" style="color:#7a5210">Ocultar</a></span><span id="dmini" style="display:none;cursor:pointer"><b>DEMO</b> ▸</span>`;
    document.body.appendChild(bar);
    const tog = mini => { bar.querySelector("#dfull").style.display = mini ? "none" : ""; bar.querySelector("#dmini").style.display = mini ? "" : "none"; bar.style.padding = mini ? "4px 10px" : "8px 12px"; };
    bar.querySelector("#dmin").onclick = e => { e.preventDefault(); tog(true); };
    bar.querySelector("#dmini").onclick = () => tog(false);
    bar.querySelector("#dreset").onclick = e => { e.preventDefault(); window.DEMO_RESET(); };
  });
})();
