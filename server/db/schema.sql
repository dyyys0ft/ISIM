PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Usuarios y sesiones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  cedula        TEXT UNIQUE,
  username      TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  rol           TEXT NOT NULL DEFAULT 'operador' CHECK (rol IN ('admin', 'medico', 'operador', 'lectura', 'enfermero')),
  pin_hash      TEXT NOT NULL,
  activo        INTEGER NOT NULL DEFAULT 1,
  firma_png_path TEXT,
  firma_hash    TEXT,
  firma_actualizada_en TEXT,
  senecit       TEXT,
  especialidad  TEXT,
  foto_png_path TEXT,
  foto_actualizada_en TEXT,
  ultimo_acceso_en TEXT,
  creado_en     TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creada_en  TEXT NOT NULL,
  expira_en  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- Roles y permisos dinámicos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  slug           TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  descripcion    TEXT,
  protegido      INTEGER NOT NULL DEFAULT 0,
  activo         INTEGER NOT NULL DEFAULT 1,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_slug TEXT NOT NULL REFERENCES roles(slug) ON DELETE CASCADE,
  permiso   TEXT NOT NULL,
  PRIMARY KEY (role_slug, permiso)
);

-- ---------------------------------------------------------------------------
-- Pacientes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id               TEXT PRIMARY KEY,
  cedula           TEXT NOT NULL UNIQUE,
  nombres          TEXT NOT NULL,
  apellidos        TEXT NOT NULL,
  fecha_nacimiento TEXT,
  sexo             TEXT DEFAULT '' CHECK (sexo IN ('F', 'M', 'X', '')),
  telefono         TEXT,
  email            TEXT,
  direccion        TEXT,
  ocupacion        TEXT,
  estado_civil     TEXT,
  ciudad           TEXT,
  fecha_registro_informacion TEXT,
  alergias         TEXT,
  fum              TEXT,
  embarazada       INTEGER NOT NULL DEFAULT 0,
  embarazo_nota    TEXT,
  tipo_doc         TEXT NOT NULL DEFAULT 'cedula',
  instruccion      TEXT,
  nacionalidad     TEXT,
  etnia            TEXT,
  seguro           TEXT,
  parroquia        TEXT,
  canton           TEXT,
  provincia        TEXT,
  contacto_nombre  TEXT,
  contacto_parentesco TEXT,
  contacto_telefono TEXT,
  empresa          TEXT,
  puesto           TEXT,
  hc_numero        TEXT,
  ant_personales   TEXT,
  ant_quirurgicos  TEXT,
  ant_familiares   TEXT,
  grupo_sanguineo  TEXT,
  habitos          TEXT,
  medicacion_habitual TEXT,
  menarquia        TEXT,
  ciclos           TEXT,
  gestas           TEXT,
  partos           TEXT,
  cesareas         TEXT,
  abortos          TEXT,
  hijos_vivos      TEXT,
  mac              TEXT,
  ivsa             TEXT,
  parejas          TEXT,
  ultimo_pap       TEXT,
  ultima_mamografia TEXT,
  consentimiento_datos TEXT,
  consentimiento_evidencia_path TEXT,
  consentimiento_evidencia_mime TEXT,
  consentimiento_evidencia_hash TEXT,
  consentimiento_evidencia_nombre TEXT,
  consentimiento_evidencia_en TEXT,
  nota_importante  TEXT,
  notas            TEXT,
  datos_incompletos INTEGER NOT NULL DEFAULT 0,
  datos_incompletos_detalle TEXT,
  representante1_nombre     TEXT,
  representante1_cedula     TEXT,
  representante1_parentesco TEXT,
  representante1_telefono   TEXT,
  representante2_nombre     TEXT,
  representante2_cedula     TEXT,
  representante2_parentesco TEXT,
  representante2_telefono   TEXT,
  demo             INTEGER NOT NULL DEFAULT 0,
  activo           INTEGER NOT NULL DEFAULT 1,
  creado_en        TEXT NOT NULL,
  actualizado_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patients_nombre ON patients(apellidos, nombres);

-- ---------------------------------------------------------------------------
-- Plantillas de consentimiento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id         TEXT PRIMARY KEY,
  nombre     TEXT NOT NULL,
  tipo       TEXT NOT NULL DEFAULT 'general',
  cuerpo_html TEXT NOT NULL,
  firma_modo TEXT NOT NULL DEFAULT 'ambas'
             CHECK (firma_modo IN ('paciente', 'medico', 'ambas')),
  activo     INTEGER NOT NULL DEFAULT 1,
  creado_en  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Documentos y versiones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  patient_id      TEXT NOT NULL REFERENCES patients(id),
  appointment_id  TEXT REFERENCES appointments(id),
  template_id     TEXT REFERENCES templates(id),
  titulo          TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'borrador'
                  CHECK (estado IN ('borrador', 'pendiente_firma', 'firmado', 'anulado')),
  codigo          TEXT UNIQUE,
  version_actual  INTEGER NOT NULL DEFAULT 1,
  numero          INTEGER,
  subtipo         TEXT NOT NULL DEFAULT 'consentimiento',
  datos           TEXT,
  medico_id       TEXT,
  medico_firma_path TEXT,
  firma_modo      TEXT NOT NULL DEFAULT 'ambas'
                  CHECK (firma_modo IN ('paciente', 'medico', 'ambas')),
  anulado_en      TEXT,
  created_by      TEXT REFERENCES users(id),
  creado_en       TEXT NOT NULL,
  actualizado_en  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_patient ON documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_documents_estado ON documents(estado);

-- Negativas y revocatorias de consentimientos.
CREATE TABLE IF NOT EXISTS consent_events (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('negativa', 'revocatoria')),
  motivo      TEXT,
  usuario_id  TEXT REFERENCES users(id),
  creado_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consent_events_document
  ON consent_events(document_id, creado_en DESC);
-- idx_documents_appointment se crea después de la migración de appointment_id
-- en server/db/index.js, para bases existentes sin esa columna.

CREATE TABLE IF NOT EXISTS document_versions (
  id             TEXT PRIMARY KEY,
  document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  numero         INTEGER NOT NULL,
  contenido_html TEXT NOT NULL,
  hash           TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'borrador'
                 CHECK (estado IN ('borrador', 'pendiente_firma', 'firmada', 'anulada')),
  creado_por     TEXT REFERENCES users(id),
  creado_en      TEXT NOT NULL,
  UNIQUE (document_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_versions_document ON document_versions(document_id);

-- ---------------------------------------------------------------------------
-- Agenda de citas y historia clínica
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id             TEXT PRIMARY KEY,
  patient_id     TEXT NOT NULL REFERENCES patients(id),
  medico_id      TEXT REFERENCES users(id),
  fecha_hora     TEXT NOT NULL,
  duracion_min   INTEGER NOT NULL DEFAULT 30,
  motivo         TEXT,
  estado         TEXT NOT NULL DEFAULT 'programada'
                 CHECK (estado IN ('programada', 'confirmada', 'en_progreso', 'atendida',
                                   'cancelada', 'reagendada', 'no_asistio')),
  motivo_reagenda TEXT,
  notas          TEXT,
  jornada        TEXT,
  tipo           TEXT NOT NULL DEFAULT 'normal',
  cupo           INTEGER NOT NULL DEFAULT 1,
  motivo_grupo   TEXT,
  demo           INTEGER NOT NULL DEFAULT 0,
  creado_por     TEXT REFERENCES users(id),
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_fecha ON appointments(fecha_hora);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_medico ON appointments(medico_id);
CREATE INDEX IF NOT EXISTS idx_appointments_estado ON appointments(estado);

CREATE TABLE IF NOT EXISTS clinical_records (
  id              TEXT PRIMARY KEY,
  appointment_id  TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id      TEXT NOT NULL REFERENCES patients(id),
  medico_id       TEXT REFERENCES users(id),
  fecha           TEXT NOT NULL,
  duracion_estimada_min INTEGER NOT NULL DEFAULT 30,
  motivo_consulta TEXT,
  notas           TEXT,
  diagnostico     TEXT,
  tratamiento     TEXT,
  receta          TEXT,
  indicaciones    TEXT,
  recomendaciones TEXT,
  datos           TEXT,
  enfermedad_actual TEXT,
  pa_sis          TEXT,
  pa_dia          TEXT,
  fc              TEXT,
  fr              TEXT,
  temp            TEXT,
  sat             TEXT,
  peso            TEXT,
  talla           TEXT,
  imc             TEXT,
  fum             TEXT,
  embarazo        INTEGER NOT NULL DEFAULT 0,
  eg              TEXT,
  fpp             TEXT,
  au              TEXT,
  fcf             TEXT,
  presentacion    TEXT,
  edemas          TEXT,
  examen_fisico   TEXT,
  examen_gineco   TEXT,
  plan            TEXT,
  proxima_cita    TEXT,
  demo            INTEGER NOT NULL DEFAULT 0,
  creado_por      TEXT REFERENCES users(id),
  actualizado_por TEXT REFERENCES users(id),
  creado_en       TEXT NOT NULL,
  actualizado_en  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_records_patient ON clinical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_records_fecha ON clinical_records(fecha);

CREATE TABLE IF NOT EXISTS clinical_diagnoses (
  id          TEXT PRIMARY KEY,
  record_id   TEXT NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
  cie10       TEXT,
  descripcion TEXT,
  tipo        TEXT NOT NULL DEFAULT 'PRE' CHECK (tipo IN ('PRE', 'DEF')),
  orden       INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_diagnoses_record
  ON clinical_diagnoses(record_id);
CREATE INDEX IF NOT EXISTS idx_clinical_diagnoses_cie
  ON clinical_diagnoses(cie10);

CREATE TABLE IF NOT EXISTS clinical_orders (
  id             TEXT PRIMARY KEY,
  numero         INTEGER NOT NULL,
  patient_id     TEXT NOT NULL REFERENCES patients(id),
  record_id      TEXT REFERENCES clinical_records(id) ON DELETE SET NULL,
  tipo           TEXT NOT NULL
                 CHECK (tipo IN ('ecografia', 'colposcopia', 'biopsia', 'laboratorio')),
  fecha          TEXT NOT NULL,
  datos          TEXT,
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente', 'con_resultado', 'sin_resultado')),
  medico_id      TEXT REFERENCES users(id),
  creado_por     TEXT REFERENCES users(id),
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_orders_patient
  ON clinical_orders(patient_id, fecha DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_orders_numero ON clinical_orders(numero);

CREATE TABLE IF NOT EXISTS clinical_exams (
  id             TEXT PRIMARY KEY,
  record_id      TEXT NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
  patient_id     TEXT REFERENCES patients(id),
  pedido_id      TEXT REFERENCES clinical_orders(id) ON DELETE SET NULL,
  nombre         TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'clinico'
                 CHECK (tipo IN ('clinico', 'laboratorio', 'imagen', 'otro')),
  indicaciones   TEXT,
  descripcion    TEXT,
  estado         TEXT NOT NULL DEFAULT 'solicitado'
                 CHECK (estado IN ('solicitado', 'recibido', 'evaluado')),
  observaciones  TEXT,
  referencias_archivo TEXT,
  demo           INTEGER NOT NULL DEFAULT 0,
  creado_por     TEXT REFERENCES users(id),
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_exams_record ON clinical_exams(record_id);

CREATE TABLE IF NOT EXISTS clinical_addenda (
  id         TEXT PRIMARY KEY,
  record_id  TEXT NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
  texto      TEXT NOT NULL,
  usuario_id TEXT REFERENCES users(id),
  creado_en  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_addenda_record
  ON clinical_addenda(record_id, creado_en ASC);

CREATE TABLE IF NOT EXISTS clinical_attachments (
  id          TEXT PRIMARY KEY,
  record_id   TEXT NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
  patient_id  TEXT REFERENCES patients(id),
  exam_id     TEXT,
  nombre      TEXT NOT NULL,
  mime        TEXT NOT NULL,
  tamano      INTEGER NOT NULL,
  ruta        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  subido_por  TEXT REFERENCES users(id),
  creado_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_attachments_record ON clinical_attachments(record_id);

-- ---------------------------------------------------------------------------
-- Notificaciones de citas (WhatsApp / SMS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_notifications (
  id             TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  canal          TEXT NOT NULL DEFAULT 'whatsapp',
  destino        TEXT NOT NULL,
  plantilla      TEXT,
  estado         TEXT NOT NULL DEFAULT 'enviado'
                 CHECK (estado IN ('enviado', 'error')),
  proveedor_id   TEXT,
  error          TEXT,
  creado_por     TEXT REFERENCES users(id),
  creado_en      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointment_notifications_cita
  ON appointment_notifications(appointment_id, creado_en);

-- ---------------------------------------------------------------------------
-- Sesiones de firma en pantalla externa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sign_sessions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  version_id  TEXT NOT NULL REFERENCES document_versions(id),
  token_hash  TEXT NOT NULL UNIQUE,
  estado      TEXT NOT NULL DEFAULT 'abierta'
              CHECK (estado IN ('abierta', 'completada', 'cancelada', 'expirada')),
  creada_por  TEXT REFERENCES users(id),
  creada_en   TEXT NOT NULL,
  expira_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sign_sessions_version ON sign_sessions(version_id);

-- ---------------------------------------------------------------------------
-- Firmas (inmutables)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signatures (
  id               TEXT PRIMARY KEY,
  sign_session_id  TEXT UNIQUE REFERENCES sign_sessions(id),
  document_id      TEXT NOT NULL REFERENCES documents(id),
  version_id       TEXT NOT NULL REFERENCES document_versions(id),
  patient_snapshot TEXT NOT NULL,
  user_snapshot    TEXT,
  gestionado_por   TEXT,
  gestionado_nombre TEXT,
  gestionado_rol   TEXT,
  documento_titulo TEXT,
  firma_png_path   TEXT NOT NULL,
  firma_hash       TEXT NOT NULL,
  documento_hash   TEXT NOT NULL,
  firmado_en       TEXT NOT NULL,
  copia_solicitada INTEGER NOT NULL DEFAULT 0,
  copia_entregada  INTEGER NOT NULL DEFAULT 0,
  copia_actualizada_en TEXT,
  ip               TEXT,
  user_agent       TEXT,
  UNIQUE (version_id)
);

CREATE INDEX IF NOT EXISTS idx_signatures_document ON signatures(document_id);

-- ---------------------------------------------------------------------------
-- Bitácora de auditoría (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  accion     TEXT NOT NULL,
  entidad    TEXT NOT NULL,
  entidad_id TEXT,
  detalle    TEXT,
  creado_en  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entidad ON audit_log(entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_fecha ON audit_log(user_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_audit_fecha ON audit_log(creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_audit_accion ON audit_log(accion, creado_en DESC);

-- ---------------------------------------------------------------------------
-- Configuración del sistema (logo de encabezado, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  clave          TEXT PRIMARY KEY,
  valor          TEXT,
  actualizado_en TEXT NOT NULL
);

-- Historial de respaldos cifrados.
CREATE TABLE IF NOT EXISTS backups (
  id          TEXT PRIMARY KEY,
  archivo     TEXT NOT NULL,
  ruta        TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  hash        TEXT,
  items       TEXT,
  estado      TEXT NOT NULL DEFAULT 'ok'
              CHECK (estado IN ('ok', 'error', 'en_progreso')),
  error       TEXT,
  creado_por  TEXT REFERENCES users(id),
  creado_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backups_fecha ON backups(creado_en DESC);

-- Lista blanca de IPs (o rangos CIDR) autorizados a entrar por la intranet.
CREATE TABLE IF NOT EXISTS ips_permitidas (
  ip              TEXT PRIMARY KEY,
  mac             TEXT,
  descripcion     TEXT,
  creado_por      TEXT REFERENCES users(id),
  creado_en       TEXT NOT NULL,
  ultimo_acceso_en TEXT,
  accesos         INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Migración desde la base anterior
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_runs (
  id             TEXT PRIMARY KEY,
  nombre_archivo TEXT,
  archivo        TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'analizado'
                 CHECK (estado IN ('analizado', 'migrando', 'completado', 'error')),
  resumen        TEXT,
  error          TEXT,
  creado_por     TEXT REFERENCES users(id),
  creado_en      TEXT NOT NULL,
  finalizado_en  TEXT
);

CREATE TABLE IF NOT EXISTS migration_map (
  entidad    TEXT NOT NULL,
  old_id     TEXT NOT NULL,
  new_id     TEXT NOT NULL,
  run_id     TEXT,
  creado_en  TEXT NOT NULL,
  PRIMARY KEY (entidad, old_id)
);

CREATE INDEX IF NOT EXISTS idx_migration_map_run ON migration_map(run_id);

-- Motivos de cita agrupados para la agenda ISIM.
CREATE TABLE IF NOT EXISTS motivos_cita (
  id          TEXT PRIMARY KEY,
  grupo       TEXT NOT NULL DEFAULT 'Consultas',
  motivo      TEXT NOT NULL,
  orden       INTEGER NOT NULL DEFAULT 1,
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_motivos_cita_grupo
  ON motivos_cita(grupo, orden);

-- Catálogos importados del sistema anterior
CREATE TABLE IF NOT EXISTS catalogo_diagnosticos (
  id           TEXT PRIMARY KEY,
  legacy_id    TEXT UNIQUE,
  cie10        TEXT,
  diagnostico  TEXT NOT NULL,
  observacion  TEXT,
  creado_en    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalogo_medicinas (
  id           TEXT PRIMARY KEY,
  legacy_id    TEXT UNIQUE,
  medicina     TEXT,
  dci          TEXT,
  forma        TEXT,
  via          TEXT,
  dosis        TEXT,
  frecuencia   TEXT,
  duracion     TEXT,
  advertencia  TEXT,
  creado_en    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalogo_tratamientos (
  id           TEXT PRIMARY KEY,
  legacy_id    TEXT UNIQUE,
  nombre       TEXT,
  descripcion  TEXT,
  cantidad     INTEGER,
  medicina     TEXT,
  dci          TEXT,
  forma        TEXT,
  via          TEXT,
  dosis        TEXT,
  frecuencia   TEXT,
  duracion     TEXT,
  advertencia  TEXT,
  datos        TEXT,
  creado_en    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalogo_informes (
  id           TEXT PRIMARY KEY,
  legacy_id    TEXT UNIQUE,
  nombre       TEXT,
  informe      TEXT,
  observacion  TEXT,
  creado_en    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalogo_diagnosticos_cie10
  ON catalogo_diagnosticos(cie10);

-- ---------------------------------------------------------------------------
-- Reglas de inmutabilidad a nivel de base de datos
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_version_firmada_no_update
BEFORE UPDATE ON document_versions
WHEN OLD.estado = 'firmada'
BEGIN
  SELECT RAISE(ABORT, 'Una versión firmada no puede modificarse');
END;

CREATE TRIGGER IF NOT EXISTS trg_version_firmada_no_delete
BEFORE DELETE ON document_versions
WHEN OLD.estado = 'firmada'
BEGIN
  SELECT RAISE(ABORT, 'Una versión firmada no puede eliminarse');
END;

CREATE TRIGGER IF NOT EXISTS trg_signature_no_update
BEFORE UPDATE ON signatures
WHEN OLD.id IS NOT NEW.id
  OR OLD.sign_session_id IS NOT NEW.sign_session_id
  OR OLD.document_id IS NOT NEW.document_id
  OR OLD.version_id IS NOT NEW.version_id
  OR OLD.patient_snapshot IS NOT NEW.patient_snapshot
  OR OLD.user_snapshot IS NOT NEW.user_snapshot
  OR OLD.gestionado_por IS NOT NEW.gestionado_por
  OR OLD.gestionado_nombre IS NOT NEW.gestionado_nombre
  OR OLD.gestionado_rol IS NOT NEW.gestionado_rol
  OR OLD.documento_titulo IS NOT NEW.documento_titulo
  OR OLD.firma_png_path IS NOT NEW.firma_png_path
  OR OLD.firma_hash IS NOT NEW.firma_hash
  OR OLD.documento_hash IS NOT NEW.documento_hash
  OR OLD.firmado_en IS NOT NEW.firmado_en
  OR OLD.ip IS NOT NEW.ip
  OR OLD.user_agent IS NOT NEW.user_agent
BEGIN
  SELECT RAISE(ABORT, 'Una firma no puede modificarse');
END;

CREATE TRIGGER IF NOT EXISTS trg_signature_no_delete
BEFORE DELETE ON signatures
BEGIN
  SELECT RAISE(ABORT, 'Una firma no puede eliminarse');
END;

-- ---------------------------------------------------------------------------
-- �ndices y vistas para consultas frecuentes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_patients_activo_nombre
  ON patients(activo, apellidos, nombres);
CREATE INDEX IF NOT EXISTS idx_patients_incompletos
  ON patients(datos_incompletos);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_fecha
  ON appointments(patient_id, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_appointments_medico_fecha
  ON appointments(medico_id, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_appointments_estado_fecha
  ON appointments(estado, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_clinical_records_patient_fecha
  ON clinical_records(patient_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_exams_record_estado
  ON clinical_exams(record_id, estado);
CREATE INDEX IF NOT EXISTS idx_documents_patient_estado
  ON documents(patient_id, estado);

CREATE VIEW IF NOT EXISTS vista_pacientes_resumen AS
SELECT p.id, p.cedula, p.nombres, p.apellidos, p.activo, p.demo, p.datos_incompletos,
       (SELECT COUNT(*) FROM clinical_records cr WHERE cr.patient_id = p.id) AS total_consultas,
       (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) AS total_citas,
       (SELECT MAX(cr.fecha) FROM clinical_records cr WHERE cr.patient_id = p.id) AS ultima_consulta
FROM patients p;

CREATE VIEW IF NOT EXISTS vista_consultas_paciente AS
SELECT cr.id, cr.patient_id, cr.appointment_id, cr.fecha, cr.motivo_consulta,
       cr.diagnostico, cr.tratamiento, cr.receta,
       p.nombres, p.apellidos, p.cedula, p.fecha_nacimiento,
       a.fecha_hora, a.estado AS cita_estado, a.motivo AS cita_motivo,
       u.nombre AS medico_nombre
FROM clinical_records cr
JOIN patients p ON p.id = cr.patient_id
JOIN appointments a ON a.id = cr.appointment_id
LEFT JOIN users u ON u.id = cr.medico_id;

CREATE VIEW IF NOT EXISTS vista_agenda_citas AS
SELECT a.id, a.patient_id, a.medico_id, a.fecha_hora, a.duracion_min, a.motivo,
       a.estado, a.notas,
       p.nombres, p.apellidos, p.cedula AS paciente_cedula,
       u.nombre AS medico_nombre,
       cr.id AS historia_id
FROM appointments a
JOIN patients p ON p.id = a.patient_id
LEFT JOIN users u ON u.id = a.medico_id
LEFT JOIN clinical_records cr ON cr.appointment_id = a.id;

CREATE VIEW IF NOT EXISTS vista_examenes_pendientes AS
SELECT ce.id, ce.record_id, ce.nombre, ce.tipo, ce.estado,
       cr.patient_id, cr.fecha AS fecha_consulta
FROM clinical_exams ce
JOIN clinical_records cr ON cr.id = ce.record_id
WHERE ce.estado != 'evaluado';

-- ---------------------------------------------------------------------------
-- Receta m�dica digital
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prescriptions (
  id                 TEXT PRIMARY KEY,
  record_id          TEXT NOT NULL UNIQUE REFERENCES clinical_records(id) ON DELETE CASCADE,
  patient_id         TEXT NOT NULL REFERENCES patients(id),
  medico_id          TEXT REFERENCES users(id),
  fecha              TEXT NOT NULL,
  hora               TEXT,
  lugar              TEXT,
  encabezado         TEXT,
  pie                TEXT,
  indicaciones       TEXT,
  datos              TEXT,
  numero             INTEGER,
  diagnostico        TEXT,
  cie10              TEXT,
  alergias           TEXT,
  recomendaciones    TEXT,
  para_pareja        INTEGER NOT NULL DEFAULT 0,
  anulada_en         TEXT,
  anulada_por        TEXT REFERENCES users(id),
  motivo_anulacion   TEXT,
  medico_nombre      TEXT,
  medico_especialidad TEXT,
  medico_cedula      TEXT,
  medico_senecit     TEXT,
  firma_png_path     TEXT,
  firma_hash         TEXT,
  estado             TEXT NOT NULL DEFAULT 'borrador'
                     CHECK (estado IN ('borrador', 'finalizada')),
  share_token        TEXT UNIQUE,
  enviado_en         TEXT,
  creado_por         TEXT REFERENCES users(id),
  creado_en          TEXT NOT NULL,
  actualizado_en     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_medico ON prescriptions(medico_id);

CREATE TABLE IF NOT EXISTS prescription_items (
  id              TEXT PRIMARY KEY,
  prescription_id TEXT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  orden           INTEGER NOT NULL DEFAULT 1,
  medicamento     TEXT NOT NULL,
  presentacion    TEXT,
  dosis           TEXT,
  via             TEXT,
  frecuencia      TEXT,
  duracion        TEXT,
  cantidad        TEXT,
  unidad          TEXT,
  dci             TEXT,
  concentracion   TEXT,
  indicaciones    TEXT,
  creado_en       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prescription_items_receta
  ON prescription_items(prescription_id, orden);

-- ---------------------------------------------------------------------------
-- Enlaces p�blicos para compartir documentos de una paciente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_share_links (
  id              TEXT PRIMARY KEY,
  patient_id      TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  creado_por      TEXT REFERENCES users(id),
  creado_en       TEXT NOT NULL,
  revocado_en     TEXT,
  ultimo_acceso_en TEXT
);

CREATE INDEX IF NOT EXISTS idx_patient_share_patient
  ON patient_share_links(patient_id, revocado_en);

-- ---------------------------------------------------------------------------
-- CRM: contactos, conversaciones y tareas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_conversations (
  id                TEXT PRIMARY KEY,
  patient_id        TEXT NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  telefono          TEXT,
  wa_id             TEXT,
  estado            TEXT NOT NULL DEFAULT 'abierta'
                    CHECK (estado IN ('abierta', 'cerrada')),
  no_leidos         INTEGER NOT NULL DEFAULT 0,
  ultimo_mensaje    TEXT,
  ultimo_mensaje_en TEXT,
  creado_en         TEXT NOT NULL,
  actualizado_en    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_conversations_ultimo
  ON crm_conversations(ultimo_mensaje_en DESC);

CREATE TABLE IF NOT EXISTS crm_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES crm_conversations(id) ON DELETE CASCADE,
  patient_id      TEXT NOT NULL REFERENCES patients(id),
  appointment_id  TEXT REFERENCES appointments(id),
  direccion       TEXT NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  tipo            TEXT NOT NULL DEFAULT 'texto',
  contenido       TEXT,
  proveedor_id    TEXT,
  estado          TEXT NOT NULL DEFAULT 'enviado',
  error           TEXT,
  creado_por      TEXT REFERENCES users(id),
  creado_en       TEXT NOT NULL,
  metadata        TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_messages_conversacion
  ON crm_messages(conversation_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_crm_messages_paciente
  ON crm_messages(patient_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_proveedor
  ON crm_messages(proveedor_id);

CREATE TABLE IF NOT EXISTS crm_tasks (
  id             TEXT PRIMARY KEY,
  patient_id     TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL DEFAULT 'tarea'
                 CHECK (tipo IN ('tarea', 'queja', 'sugerencia')),
  motivo         TEXT NOT NULL,
  descripcion    TEXT,
  prioridad      TEXT NOT NULL DEFAULT 'media'
                 CHECK (prioridad IN ('baja', 'media', 'alta', 'urgente')),
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente', 'en_proceso', 'resuelta', 'cancelada')),
  fecha_limite   TEXT,
  asignado_a     TEXT REFERENCES users(id),
  creado_por     TEXT REFERENCES users(id),
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_paciente
  ON crm_tasks(patient_id, estado, fecha_limite);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_estado
  ON crm_tasks(estado, fecha_limite, prioridad);
