#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SISTEMA MÉDICO ISIM — Instituto de Salud Integral de la Mujer (Riobamba)
Servidor local (red del consultorio). Solo usa Python estándar + SQLite.

Uso:   python server.py            (puerto 8080)
       python server.py 9000       (otro puerto)
"""
import base64, datetime as dt, hashlib, hmac, io, json, mimetypes, os, re, secrets
import socket, sqlite3, sys, threading, time, uuid, zipfile
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import consentimientos as CI

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
FILES = os.path.join(DATA, "archivos")
STATIC = os.path.join(BASE, "static")
DB_PATH = os.path.join(DATA, "isim.db")
os.makedirs(FILES, exist_ok=True)

SESSION_HOURS = 12
MAX_FILE_MB = 30
LOCK = threading.Lock()
FAILED = {}  # usuario -> [intentos, hasta]

# ----------------------------------------------------------------- BASE DE DATOS
SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS usuarios(
  id INTEGER PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK(rol IN ('admin','medico','recepcion','enfermeria')),
  salt TEXT NOT NULL, pass_hash TEXT NOT NULL,
  especialidad TEXT DEFAULT '', registro TEXT DEFAULT '', activo INTEGER DEFAULT 1,
  creado TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS sesiones(token TEXT PRIMARY KEY, usuario_id INTEGER, expira REAL);
CREATE TABLE IF NOT EXISTS pacientes(
  id INTEGER PRIMARY KEY, tipo_doc TEXT DEFAULT 'cedula', cedula TEXT UNIQUE NOT NULL,
  apellidos TEXT NOT NULL, nombres TEXT NOT NULL, fecha_nac TEXT, sexo TEXT DEFAULT 'F',
  estado_civil TEXT, instruccion TEXT, ocupacion TEXT, nacionalidad TEXT DEFAULT 'Ecuatoriana',
  etnia TEXT, direccion TEXT, parroquia TEXT, canton TEXT DEFAULT 'Riobamba', provincia TEXT DEFAULT 'Chimborazo',
  telefono TEXT, email TEXT, contacto_nombre TEXT, contacto_parentesco TEXT, contacto_telefono TEXT,
  seguro TEXT, grupo_sanguineo TEXT, alergias TEXT,
  ant_personales TEXT, ant_quirurgicos TEXT, ant_familiares TEXT, medicacion_habitual TEXT, habitos TEXT,
  menarquia TEXT, ciclos TEXT, gestas TEXT, partos TEXT, cesareas TEXT, abortos TEXT, hijos_vivos TEXT,
  fum TEXT, mac TEXT, ivsa TEXT, parejas TEXT, ultimo_pap TEXT, ultima_mamografia TEXT, nota_importante TEXT,
  consentimiento_datos TEXT, observaciones TEXT,
  creado TEXT DEFAULT (datetime('now','localtime')), actualizado TEXT, creado_por INTEGER);
CREATE INDEX IF NOT EXISTS ix_pac_nom ON pacientes(apellidos, nombres);
CREATE TABLE IF NOT EXISTS turnos(
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, hora TEXT NOT NULL, jornada TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'normal', cupo INTEGER DEFAULT 1,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id), motivo TEXT DEFAULT '',
  estado TEXT DEFAULT 'agendado', creado_por INTEGER, creado TEXT DEFAULT (datetime('now','localtime')));
CREATE INDEX IF NOT EXISTS ix_turno_fecha ON turnos(fecha);
CREATE TABLE IF NOT EXISTS consultas(
  id INTEGER PRIMARY KEY, paciente_id INTEGER NOT NULL, turno_id INTEGER, fecha TEXT NOT NULL,
  medico_id INTEGER, datos TEXT NOT NULL DEFAULT '{}', estado TEXT DEFAULT 'borrador',
  cerrada_en TEXT, creado TEXT DEFAULT (datetime('now','localtime')), actualizado TEXT);
CREATE TABLE IF NOT EXISTS consulta_notas(
  id INTEGER PRIMARY KEY, consulta_id INTEGER, texto TEXT, usuario_id INTEGER,
  fecha TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS recetas(
  id INTEGER PRIMARY KEY, numero INTEGER, paciente_id INTEGER NOT NULL, consulta_id INTEGER,
  fecha TEXT NOT NULL, medico_id INTEGER, datos TEXT NOT NULL,
  creado TEXT DEFAULT (datetime('now','localtime')), anulada INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS medicamentos(
  id INTEGER PRIMARY KEY, comercial TEXT NOT NULL, generico TEXT NOT NULL, forma TEXT, via TEXT,
  unidad TEXT, cantidad INTEGER, indicacion TEXT, activo INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS esquemas(
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, diagnostico TEXT, cie TEXT,
  items TEXT NOT NULL DEFAULT '[]', recomendaciones TEXT DEFAULT '', para_pareja INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS examenes(
  id INTEGER PRIMARY KEY, paciente_id INTEGER NOT NULL, tipo TEXT NOT NULL, fecha TEXT NOT NULL,
  titulo TEXT, texto TEXT, creado_por INTEGER, creado TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS archivos(
  id INTEGER PRIMARY KEY, examen_id INTEGER NOT NULL, nombre TEXT, mime TEXT, ruta TEXT, tamano INTEGER);
CREATE TABLE IF NOT EXISTS pedidos(
  id INTEGER PRIMARY KEY, numero INTEGER, paciente_id INTEGER NOT NULL, tipo TEXT NOT NULL, fecha TEXT NOT NULL,
  datos TEXT NOT NULL, medico_id INTEGER, creado TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS auditoria(
  id INTEGER PRIMARY KEY, fecha TEXT DEFAULT (datetime('now','localtime')), usuario_id INTEGER,
  accion TEXT, entidad TEXT, entidad_id INTEGER, detalle TEXT, ip TEXT);
CREATE TABLE IF NOT EXISTS ajustes(clave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS consentimientos(
  id INTEGER PRIMARY KEY, paciente_id INTEGER NOT NULL, turno_id INTEGER, clave TEXT NOT NULL, titulo TEXT,
  fecha TEXT NOT NULL, estado TEXT DEFAULT 'pendiente', contenido TEXT NOT NULL DEFAULT '{}',
  firmado_en TEXT, negado_en TEXT, revocado_en TEXT, creado_por INTEGER, actualizado_por INTEGER,
  creado TEXT DEFAULT (datetime('now','localtime')));
CREATE INDEX IF NOT EXISTS ix_ci_pac ON consentimientos(paciente_id);
CREATE TABLE IF NOT EXISTS certificados(
  id INTEGER PRIMARY KEY, numero INTEGER, paciente_id INTEGER NOT NULL, tipo TEXT NOT NULL, fecha TEXT NOT NULL,
  datos TEXT NOT NULL, medico_id INTEGER, creado TEXT DEFAULT (datetime('now','localtime')));
"""

DEFAULT_HORARIO = {
    # dia de la semana (0=lunes) -> jornadas
    "lv": {"manana": ["09:30", "10:00", "10:30", "11:00", "11:30"],
           "tarde": ["15:30", "16:00", "16:30", "17:00", "17:30"]},
    "sabado": {"manana": [], "tarde": []},
    "cupos_por_hora": 2,
}
DEFAULT_INSTITUCION = {
    "nombre": "INSTITUTO DE SALUD INTEGRAL DE LA MUJER",
    "siglas": "ISIM",
    "direccion": "Segundo Rosero y Manuel Arauz Jijón, Álamos 1 · Riobamba, Ecuador",
    "telefono": "0983840026",
    "ruc": "0691785494001",
    "pie_receta": "No modificar dosis, frecuencia o duración sin indicación médica.",
}

MEDS = [
    # comercial, generico (DCI + concentracion), forma, via, unidad, cantidad, indicacion
    ("Tinidazol", "tinidazol 1 g", "comprimidos", "vía oral", "comprimidos", 4, "Tomar 2 comprimidos después del almuerzo durante 2 días."),
    ("Fluconazol", "fluconazol 150 mg", "cápsulas", "vía oral", "cápsulas", 2, "Tomar 1 cápsula por la noche durante 2 noches consecutivas."),
    ("Doxifen® óvulos", "nitrato de miconazol 100 mg + tinidazol 150 mg", "óvulos", "vía vaginal", "óvulos", 6, "Colocar 1 óvulo por vía intravaginal por la noche durante 6 noches."),
    ("Doxifen® crema", "nitrato de miconazol + tinidazol", "crema", "uso externo", "tubo", 1, "Aplicar en genitales externos durante 7 días."),
    ("Ciprofloxacino", "ciprofloxacino 750 mg", "comprimidos", "vía oral", "comprimidos", 14, "Tomar 1 comprimido cada 12 horas durante 7 días."),
    ("Ulcozol®", "omeprazol", "cápsulas", "vía oral", "cápsulas", 7, "Tomar 1 cápsula en ayunas cada día mientras dure el tratamiento."),
    ("Nodolex®", "meloxicam", "ampollas", "vía intramuscular", "ampollas", 5, "Aplicar 1 ampolla por vía intramuscular cada día durante 5 días."),
    ("Nitrofurantoína", "nitrofurantoína", "cápsulas", "vía oral", "cápsulas", 20, "Tomar 1 cápsula cada 8 horas durante 7 días."),
    ("Trimetoprim/Sulfametoxazol", "trimetoprim + sulfametoxazol", "comprimidos", "vía oral", "comprimidos", 14, "Tomar 1 comprimido cada 12 horas durante 7 días."),
    ("Cefuroxima", "cefuroxima", "comprimidos", "vía oral", "comprimidos", 20, "Tomar 1 comprimido cada 8 horas hasta completar los 20 comprimidos."),
    ("Estermax®", "(completar composición)", "crema vaginal", "vía vaginal", "tubo", 1, "Aplicar 1 vez al día durante 3 semanas."),
    ("Nomadol® 20 mg", "(completar composición) 20 mg", "comprimidos", "vía oral", "comprimidos", 15, "Tomar 1 comprimido cada 8 horas durante 5 días."),
    ("Altacef®", "cefuroxima", "comprimidos", "vía oral", "comprimidos", 15, "Tomar 1 comprimido cada 8 horas durante 5 días."),
    ("Policresuleno óvulos", "policresuleno", "óvulos", "vía vaginal", "óvulos", 6, "Colocar 1 óvulo por la noche durante 6 noches."),
    ("Vitamina C", "ácido ascórbico", "comprimidos", "vía oral", "comprimidos", 30, "Tomar 1 comprimido al día durante 30 días."),
    ("Ácido láctico óvulos", "ácido láctico", "óvulos", "vía vaginal", "óvulos", 15, "Al terminar policresuleno, colocar 1 óvulo por la noche durante 15 noches."),
    ("Marvelon® 30", "desogestrel 0,15 mg + etinilestradiol 0,03 mg", "comprimidos", "vía oral", "comprimidos", 21, "Tomar 1 comprimido al día, a la misma hora, durante 21 días."),
    ("Gelcavit Natal®", "(completar composición)", "cápsulas", "vía oral", "cápsulas", 30, "Tomar 1 al día."),
    ("FortZink®", "zinc (completar)", "comprimidos", "vía oral", "comprimidos", 30, "Tomar 1 al día."),
    ("Gynoblen-D®", "fluconazol 75 mg + secnidazol 1000 mg", "tabletas recubiertas", "vía oral", "tabletas", 4, "Tomar 1 tableta cada 12 horas durante 2 días."),
    ("Ginna® crema vaginal", "nitrato de fenticonazol 2% (tubo 40 g + 7 aplicadores)", "crema vaginal", "vía vaginal", "tubo", 1, "Aplicar 1 aplicador por vía vaginal cada noche durante 7 días."),
    ("Zalain® crema", "nitrato de sertaconazol 2%", "crema", "uso externo", "tubo", 1, "Aplicar en zona genital externa durante 7 días."),
    ("Juventa sobres", "(completar composición)", "sobres", "vía oral", "sobres", 30, "Tomar 1 sobre al día durante 6 meses."),
    ("Etron nistatina óvulos", "metronidazol 500 mg + nistatina 100.000 UI", "óvulos", "vía vaginal", "óvulos", 6, "Colocar 1 óvulo por la noche durante 6 días."),
    ("Etec 1000", "vitamina E 1000 UI", "cápsulas", "vía oral", "cápsulas", 30, "Tomar 1 al día durante 6 meses."),
]

ESQUEMAS = [
    ("Vaginitis aguda — paciente", "Vaginitis aguda", "N76.0", ["Tinidazol", "Fluconazol", "Doxifen® óvulos"], "Abstinencia sexual durante el tratamiento.\nEvitar duchas vaginales.\nAcudir a control.", 0),
    ("Vaginitis aguda — pareja", "Vaginitis aguda", "N76.0", ["Tinidazol", "Fluconazol", "Doxifen® crema"], "Tratamiento exclusivo para la pareja.\nAbstinencia sexual hasta que ambos completen el tratamiento.", 1),
    ("Anexitis", "Anexitis", "N70.9", ["Ciprofloxacino", "Ulcozol®", "Nodolex®", "Doxifen® óvulos"], "Abstinencia sexual mientras haya sintomatología.\nAcudir a control.", 0),
    ("Anexovaginitis — esquema 1", "Anexovaginitis", "N70.9", ["Tinidazol", "Fluconazol", "Ulcozol®", "Doxifen® óvulos"], "Abstinencia sexual hasta completar el tratamiento de ambos.\nAcudir a control.", 0),
    ("Anexovaginitis — esquema 2", "Anexovaginitis", "N70.9", ["Ciprofloxacino", "Nodolex®", "Doxifen® óvulos"], "Abstinencia sexual durante el tratamiento.\nAcudir a control.", 0),
    ("Vaginitis atrófica — 30 días", "Vaginitis atrófica", "N95.2", ["Nitrofurantoína", "Nodolex®", "Doxifen® óvulos"], "Al terminar, iniciar Estermax® diario por 3 semanas.\nControl en 1 mes.", 0),
    ("Cistitis aguda", "Cistitis aguda", "N30.0", ["Nitrofurantoína", "Trimetoprim/Sulfametoxazol", "Nodolex®", "Doxifen® óvulos"], "Hidratación abundante.\nNo retener la orina.\nAcudir de inmediato si presenta fiebre o dolor lumbar.", 0),
    ("Post-fulguración inmediata", "Post-fulguración cervical", "Z48.8", ["Nomadol® 20 mg", "Altacef®"], "Reposo físico 7 días.\nAbstinencia sexual 2 meses.\nAcudir si presenta sangrado, fiebre, dolor o secreción maloliente.\nControl en 1 mes.", 0),
    ("Primer control post-fulguración", "Control post-fulguración", "Z48.8", ["Policresuleno óvulos", "Vitamina C", "Ácido láctico óvulos"], "Reposo sexual 1 mes más.\nControl en 1 mes.", 0),
    ("Oligomenorrea — primer mes", "Oligomenorrea", "N91.5", ["Marvelon® 30"], "Tomar a la misma hora todos los días.\nControl según evolución.", 0),
    ("Vulvovaginitis — Gynoblen-D", "Vulvovaginitis aguda", "N76.0", ["Gynoblen-D®", "Fluconazol", "Ginna® crema vaginal"], "Abstinencia sexual durante el tratamiento.\nAcudir a control.", 0),
    ("Vulvovaginitis — pareja", "Vulvovaginitis aguda", "N76.0", ["Gynoblen-D®", "Fluconazol", "Zalain® crema"], "Tratamiento exclusivo para la pareja.", 1),
    ("Climaterio — Juventa", "Climaterio", "N95.1", ["Juventa sobres", "Etron nistatina óvulos", "Etec 1000"], "Control en 3 meses.", 0),
]


def db():
    c = sqlite3.connect(DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.create_function("norm", 1, norm, deterministic=True)
    return c


def norm(s):
    """minúsculas y sin tildes (para buscar GUAÑO = guaño = guano)"""
    import unicodedata
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn")


def init_db():
    with db() as c:
        c.executescript(SCHEMA)
        # actualización de bases anteriores (agrega columnas nuevas sin perder datos)
        T, I = "TEXT DEFAULT ''", "INTEGER"
        for tabla, nuevas in (("pacientes", (("nota_importante", T), ("empresa", T), ("puesto", T), ("hc_numero", T))),
                              ("usuarios", (("firma_cert", T), ("firma_iess", T))),
                              ("recetas", (("turno_id", I), ("elaborado_por", I))),
                              ("pedidos", (("turno_id", I), ("estado", "TEXT DEFAULT 'pendiente'"), ("elaborado_por", I))),
                              ("certificados", (("elaborado_por", I),)),
                              ("examenes", (("pedido_id", I),))):
            cols = [r[1] for r in c.execute(f"PRAGMA table_info({tabla})")]
            for col, tipo in nuevas:
                if col not in cols:
                    c.execute(f"ALTER TABLE {tabla} ADD COLUMN {col} {tipo}")
        # rol nuevo "enfermeria": reconstruir la tabla si tiene la restricción antigua
        sql_u = c.execute("SELECT sql FROM sqlite_master WHERE name='usuarios'").fetchone()[0]
        if "'enfermeria'" not in sql_u:
            nuevo = sql_u.replace("('admin','medico','recepcion')", "('admin','medico','recepcion','enfermeria')").replace("CREATE TABLE usuarios", "CREATE TABLE usuarios_n", 1)
            c.execute(nuevo)
            c.execute("INSERT INTO usuarios_n SELECT * FROM usuarios")
            c.execute("DROP TABLE usuarios")
            c.execute("ALTER TABLE usuarios_n RENAME TO usuarios")
        if not c.execute("SELECT 1 FROM ajustes WHERE clave='horario'").fetchone():
            c.execute("INSERT INTO ajustes VALUES('horario',?)", (json.dumps(DEFAULT_HORARIO),))
        if not c.execute("SELECT 1 FROM ajustes WHERE clave='institucion'").fetchone():
            c.execute("INSERT INTO ajustes VALUES('institucion',?)", (json.dumps(DEFAULT_INSTITUCION, ensure_ascii=False),))
        if not c.execute("SELECT 1 FROM ajustes WHERE clave='motivos'").fetchone():
            c.execute("INSERT INTO ajustes VALUES('motivos',?)", (json.dumps(CI.MOTIVOS, ensure_ascii=False),))
        if not c.execute("SELECT 1 FROM ajustes WHERE clave='consentimientos'").fetchone():
            c.execute("INSERT INTO ajustes VALUES('consentimientos',?)", (json.dumps(CI.PLANTILLAS, ensure_ascii=False),))
        if not c.execute("SELECT 1 FROM medicamentos").fetchone():
            for m in MEDS:
                c.execute("INSERT INTO medicamentos(comercial,generico,forma,via,unidad,cantidad,indicacion) VALUES(?,?,?,?,?,?,?)", m)
            ids = {r["comercial"]: r for r in c.execute("SELECT * FROM medicamentos")}
            for nom, dx, cie, items, rec, par in ESQUEMAS:
                its = []
                for n in items:
                    m = ids[n]
                    its.append({"med_id": m["id"], "comercial": m["comercial"], "generico": m["generico"],
                                "forma": m["forma"], "via": m["via"], "unidad": m["unidad"],
                                "cantidad": m["cantidad"], "indicacion": m["indicacion"]})
                c.execute("INSERT INTO esquemas(nombre,diagnostico,cie,items,recomendaciones,para_pareja) VALUES(?,?,?,?,?,?)",
                          (nom, dx, cie, json.dumps(its, ensure_ascii=False), rec, par))


def get_ajuste(c, k):
    r = c.execute("SELECT valor FROM ajustes WHERE clave=?", (k,)).fetchone()
    return json.loads(r["valor"]) if r else None


# ----------------------------------------------------------------- UTILIDADES
def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 240_000).hex()
    return salt, h


def cedula_valida(ced):
    if not re.fullmatch(r"\d{10}", ced or ""):
        return False
    prov = int(ced[:2])
    if not (1 <= prov <= 24 or prov == 30) or int(ced[2]) > 5:
        return False
    s = 0
    for i in range(9):
        d = int(ced[i]) * (2 if i % 2 == 0 else 1)
        s += d - 9 if d > 9 else d
    return (10 - s % 10) % 10 == int(ced[9])


def rows(cur):
    return [dict(r) for r in cur]


def hoy():
    return dt.date.today().isoformat()


class ApiError(Exception):
    def __init__(self, code, msg):
        self.code, self.msg = code, msg


ROLES_CLINICOS = ("admin", "medico")
ROLES = {"admin": "Administrador", "medico": "Médico", "recepcion": "Recepción", "enfermeria": "Auxiliar de enfermería"}
PAC_FIELDS = ["tipo_doc", "cedula", "apellidos", "nombres", "fecha_nac", "sexo", "estado_civil", "instruccion",
              "ocupacion", "nacionalidad", "etnia", "direccion", "parroquia", "canton", "provincia", "telefono",
              "email", "contacto_nombre", "contacto_parentesco", "contacto_telefono", "seguro", "grupo_sanguineo",
              "alergias", "ant_personales", "ant_quirurgicos", "ant_familiares", "medicacion_habitual", "habitos",
              "menarquia", "ciclos", "gestas", "partos", "cesareas", "abortos", "hijos_vivos", "fum", "mac", "ivsa",
              "parejas", "ultimo_pap", "ultima_mamografia", "consentimiento_datos", "observaciones", "nota_importante",
              "empresa", "puesto", "hc_numero"]
# Campos que recepción puede ver/editar (datos de filiación — Formulario 001 Admisión)
# Recepción puede registrar alergias, enfermedades previas y operaciones al crear la ficha
PAC_ADMIN = PAC_FIELDS[:20] + ["alergias", "ant_personales", "ant_quirurgicos", "consentimiento_datos", "observaciones", "empresa", "puesto", "hc_numero"]
# ...y ve la nota importante (solo el médico la edita)
PAC_ADMIN_READ = PAC_ADMIN + ["nota_importante"]
EXAM_TIPOS = {"ecografia": "Informe de ecografía", "colposcopia": "Colposcopia", "penescopia": "Penescopia",
              "laboratorio": "Exámenes de laboratorio", "pap_biopsia": "Resultado Papanicolaou / Biopsia"}
PEDIDO_TIPOS = {"ecografia": "Pedido de ecografía", "colposcopia": "Pedido de colposcopia",
                "biopsia": "Pedido de estudio histopatológico / citológico", "laboratorio": "Pedido de laboratorio"}


# ----------------------------------------------------------------- HANDLER
class H(BaseHTTPRequestHandler):
    server_version = "ISIM/1.0"

    def log_message(self, fmt, *a):
        pass

    # --- respuesta
    def send_json(self, obj, code=200, extra_headers=None):
        b = json.dumps(obj, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def send_bytes(self, data, mime, name=None, download=False):
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        if name:
            disp = "attachment" if download else "inline"
            self.send_header("Content-Disposition", f"{disp}; filename*=UTF-8''{name}")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > (MAX_FILE_MB * 1.4 + 2) * 1024 * 1024 * 5:
            raise ApiError(413, "Archivo demasiado grande")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw or b"{}")
        except Exception:
            raise ApiError(400, "Datos inválidos")

    def ip(self):
        return self.client_address[0]

    def user(self):
        ck = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        tok = ck.get("isim_s")
        if not tok:
            return None
        with db() as c:
            r = c.execute("SELECT u.* FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id "
                          "WHERE s.token=? AND s.expira>? AND u.activo=1", (tok.value, time.time())).fetchone()
            if r:
                c.execute("UPDATE sesiones SET expira=? WHERE token=?", (time.time() + SESSION_HOURS * 3600, tok.value))
            return dict(r) if r else None

    def audit(self, c, u, accion, entidad="", eid=None, detalle=""):
        c.execute("INSERT INTO auditoria(usuario_id,accion,entidad,entidad_id,detalle,ip) VALUES(?,?,?,?,?,?)",
                  (u["id"] if u else None, accion, entidad, eid, detalle, self.ip()))

    # --- static
    def static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        fp = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not fp.startswith(STATIC) or not os.path.isfile(fp):
            fp = os.path.join(STATIC, "index.html")
        with open(fp, "rb") as f:
            data = f.read()
        mime = mimetypes.guess_type(fp)[0] or "application/octet-stream"
        if mime.startswith("text/") or mime.endswith("javascript"):
            mime += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        url = urlparse(self.path)
        p = url.path
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if not p.startswith("/api/"):
            if method == "GET":
                return self.static(p)
            return self.send_json({"error": "No encontrado"}, 404)
        try:
            if method != "GET":
                # protección CSRF básica: exigir cabecera propia
                if self.headers.get("X-ISIM") != "1":
                    raise ApiError(403, "Solicitud no permitida")
            res = self.api(method, p[5:].strip("/").split("/"), q)
            if res is not None:
                self.send_json(res)
        except ApiError as e:
            self.send_json({"error": e.msg}, e.code)
        except sqlite3.IntegrityError as e:
            msg = "Ya existe un registro con ese dato" if "UNIQUE" in str(e) else str(e)
            self.send_json({"error": msg}, 409)
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_json({"error": "Error interno: " + str(e)}, 500)

    # ------------------------------------------------------------- API
    def api(self, m, parts, q):
        r0 = parts[0]
        # --------- públicas
        if r0 == "estado":
            with db() as c:
                n = c.execute("SELECT COUNT(*) FROM usuarios").fetchone()[0]
                inst = get_ajuste(c, "institucion")
            u = self.user()
            return {"necesita_instalacion": n == 0, "usuario": self.pub_user(u), "institucion": inst}
        if r0 == "instalar" and m == "POST":
            return self.instalar()
        if r0 == "login" and m == "POST":
            return self.login()
        if r0 == "logout" and m == "POST":
            ck = cookies.SimpleCookie(self.headers.get("Cookie", ""))
            if ck.get("isim_s"):
                with db() as c:
                    c.execute("DELETE FROM sesiones WHERE token=?", (ck["isim_s"].value,))
            self.send_json({"ok": True}, extra_headers={"Set-Cookie": "isim_s=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"})
            return None

        u = self.user()
        if not u:
            raise ApiError(401, "Sesión expirada. Vuelva a ingresar.")
        clin = u["rol"] in ROLES_CLINICOS

        def need(*roles):
            """admin siempre puede; el resto solo si su rol está en la lista"""
            if u["rol"] != "admin" and u["rol"] not in roles:
                raise ApiError(403, "Su usuario no tiene acceso a esta sección.")

        def medico_tratante(c, b, consulta_id=None):
            """quién firma el documento: el médico que lo hace, o el elegido por recepción"""
            mid = b.get("medico_id")
            if not mid and clin:
                return u["id"]
            if not mid and consulta_id:
                r = c.execute("SELECT medico_id FROM consultas WHERE id=?", (consulta_id,)).fetchone()
                mid = r and r["medico_id"]
            if not mid:
                raise ApiError(400, "Seleccione el médico tratante que firma el documento.")
            ok = c.execute("SELECT 1 FROM usuarios WHERE id=? AND rol IN ('admin','medico') AND activo=1", (int(mid),)).fetchone()
            if not ok:
                raise ApiError(400, "El médico seleccionado no es válido.")
            return int(mid)

        def need_admin():
            if u["rol"] != "admin":
                raise ApiError(403, "Solo el administrador puede hacer esto.")

        with db() as c:
            # ---------------- AJUSTES
            if r0 == "ajustes":
                if m == "GET":
                    return {"horario": get_ajuste(c, "horario"), "institucion": get_ajuste(c, "institucion"),
                            "motivos": get_ajuste(c, "motivos"), "consentimientos": get_ajuste(c, "consentimientos"),
                            "membretes": get_ajuste(c, "membretes") or {},
                            "textos_ci": {"declaracion": CI.DECLARACION, "negativa": CI.NEGATIVA, "revocatoria": CI.REVOCATORIA}}
                need_admin()
                b = self.body()
                for k in ("horario", "institucion", "motivos", "consentimientos", "membretes"):
                    if k in b:
                        c.execute("INSERT OR REPLACE INTO ajustes VALUES(?,?)", (k, json.dumps(b[k], ensure_ascii=False)))
                self.audit(c, u, "editar", "ajustes")
                return {"ok": True}

            # ---------------- USUARIOS
            if r0 == "usuarios":
                if m == "GET":
                    need_admin()
                    return rows(c.execute("SELECT id,usuario,nombre,rol,especialidad,registro,activo,creado,firma_cert,firma_iess FROM usuarios ORDER BY nombre"))
                need_admin()
                b = self.body()
                if b.get("rol") and b["rol"] not in ("admin", "medico", "recepcion", "enfermeria"):
                    raise ApiError(400, "Rol no válido")
                if m == "POST":
                    if len(b.get("password", "")) < 8:
                        raise ApiError(400, "La contraseña debe tener al menos 8 caracteres")
                    s, h = hash_pw(b["password"])
                    cur = c.execute("INSERT INTO usuarios(usuario,nombre,rol,salt,pass_hash,especialidad,registro,firma_cert,firma_iess) VALUES(?,?,?,?,?,?,?,?,?)",
                                    (b["usuario"].strip().lower(), b["nombre"].strip(), b["rol"], s, h, b.get("especialidad", ""), b.get("registro", ""),
                                     b.get("firma_cert", ""), b.get("firma_iess", "")))
                    self.audit(c, u, "crear", "usuario", cur.lastrowid, b["usuario"])
                    return {"id": cur.lastrowid}
                if m == "PUT":
                    uid = int(parts[1])
                    if uid == u["id"] and (b.get("activo") == 0 or b.get("rol", "admin") != "admin"):
                        raise ApiError(400, "No puede quitarse a sí mismo el acceso de administrador")
                    c.execute("UPDATE usuarios SET nombre=?,rol=?,especialidad=?,registro=?,activo=?,firma_cert=?,firma_iess=? WHERE id=?",
                              (b["nombre"], b["rol"], b.get("especialidad", ""), b.get("registro", ""), int(b.get("activo", 1)),
                               b.get("firma_cert", ""), b.get("firma_iess", ""), uid))
                    if b.get("password"):
                        if len(b["password"]) < 8:
                            raise ApiError(400, "La contraseña debe tener al menos 8 caracteres")
                        s, h = hash_pw(b["password"])
                        c.execute("UPDATE usuarios SET salt=?,pass_hash=? WHERE id=?", (s, h, uid))
                        c.execute("DELETE FROM sesiones WHERE usuario_id=?", (uid,))
                    self.audit(c, u, "editar", "usuario", uid)
                    return {"ok": True}

            if r0 == "mi-clave" and m == "POST":
                b = self.body()
                if not hmac.compare_digest(hash_pw(b.get("actual", ""), u["salt"])[1], u["pass_hash"]):
                    raise ApiError(400, "La contraseña actual no es correcta")
                if len(b.get("nueva", "")) < 8:
                    raise ApiError(400, "La nueva contraseña debe tener al menos 8 caracteres")
                s, h = hash_pw(b["nueva"])
                c.execute("UPDATE usuarios SET salt=?,pass_hash=? WHERE id=?", (s, h, u["id"]))
                self.audit(c, u, "cambiar_clave", "usuario", u["id"])
                return {"ok": True}

            # ---------------- PACIENTES
            if r0 == "pacientes":
                fields = PAC_FIELDS if clin else [f for f in PAC_FIELDS if f != "nota_importante"]
                if m == "GET" and len(parts) == 1:
                    t = (q.get("q") or "").strip()
                    if len(t) < 2:
                        return []
                    like = f"%{t}%"
                    words = [norm(w) for w in re.split(r"\s+", t) if w]
                    cond = " AND ".join(["norm(apellidos || ' ' || nombres) LIKE ?"] * len(words))
                    sql = f"SELECT id,cedula,apellidos,nombres,fecha_nac,telefono FROM pacientes WHERE cedula LIKE ? OR ({cond}) ORDER BY apellidos,nombres LIMIT 30"
                    return rows(c.execute(sql, [like] + [f"%{w}%" for w in words]))
                if m == "GET":
                    pid = int(parts[1])
                    r = c.execute("SELECT * FROM pacientes WHERE id=?", (pid,)).fetchone()
                    if not r:
                        raise ApiError(404, "Paciente no encontrada")
                    d = dict(r)
                    self.audit(c, u, "ver", "paciente", pid)
                    return d
                b = self.body()
                if m == "POST":
                    self.validar_paciente(b)
                    data = {k: (b[k].strip() if isinstance(b[k], str) else b[k]) for k in fields if k in b and b[k] not in (None, "")}
                    data["creado_por"] = u["id"]
                    cols = ",".join(data)
                    cur = c.execute(f"INSERT INTO pacientes({cols}) VALUES({','.join('?' * len(data))})", list(data.values()))
                    self.audit(c, u, "crear", "paciente", cur.lastrowid, b.get("cedula"))
                    return {"id": cur.lastrowid}
                if m == "PUT":
                    pid = int(parts[1])
                    self.validar_paciente(b, pid)
                    sets = [k for k in fields if k in b]
                    c.execute(f"UPDATE pacientes SET {','.join(k + '=?' for k in sets)}, actualizado=datetime('now','localtime') WHERE id=?",
                              [(b[k].strip() if isinstance(b[k], str) else b[k]) for k in sets] + [pid])
                    self.audit(c, u, "editar", "paciente", pid)
                    return {"ok": True}

            # ---------------- TURNOS
            if r0 == "turnos":
                if m == "GET":
                    sel_ = ("SELECT t.*, p.cedula, p.apellidos, p.nombres, p.fecha_nac, p.telefono, p.nota_importante, "
                            "(SELECT COUNT(*) FROM consentimientos ci WHERE ci.paciente_id=p.id AND ci.estado='pendiente') AS ci_pendientes, "
                            "(SELECT COUNT(*) FROM consultas cc WHERE cc.paciente_id=p.id AND cc.estado='cerrada' AND (cc.turno_id IS NULL OR cc.turno_id!=t.id)) AS n_consultas, "
                            "(SELECT estado FROM consultas cc WHERE cc.turno_id=t.id) AS consulta_estado "
                            "FROM turnos t JOIN pacientes p ON p.id=t.paciente_id ")
                    if len(parts) > 1:
                        r = c.execute(sel_ + "WHERE t.id=?", (int(parts[1]),)).fetchone()
                        return dict(r) if r else {}
                    f = q.get("fecha") or hoy()
                    hasta = q.get("hasta") or f
                    return rows(c.execute(sel_ + "WHERE t.fecha BETWEEN ? AND ? "
                                          "ORDER BY t.fecha, t.jornada DESC, t.hora, t.tipo, t.cupo", (f, hasta)))
                need("medico", "recepcion")
                b = self.body()
                if m == "POST":
                    if not c.execute("SELECT 1 FROM pacientes WHERE id=?", (b["paciente_id"],)).fetchone():
                        raise ApiError(404, "Paciente no encontrada")
                    if b.get("tipo", "normal") == "normal":
                        ocupado = c.execute("SELECT 1 FROM turnos WHERE fecha=? AND hora=? AND tipo='normal' AND cupo=? AND estado!='cancelado'",
                                            (b["fecha"], b["hora"], b.get("cupo", 1))).fetchone()
                        if ocupado:
                            raise ApiError(409, "Ese cupo ya fue ocupado. Actualice la pantalla.")
                    dup = c.execute("SELECT hora FROM turnos WHERE fecha=? AND paciente_id=? AND estado!='cancelado'",
                                    (b["fecha"], b["paciente_id"])).fetchone()
                    if dup and not b.get("forzar"):
                        raise ApiError(409, f"La paciente ya tiene turno ese día a las {dup['hora']}.")
                    cur = c.execute("INSERT INTO turnos(fecha,hora,jornada,tipo,cupo,paciente_id,motivo,creado_por) VALUES(?,?,?,?,?,?,?,?)",
                                    (b["fecha"], b["hora"], b["jornada"], b.get("tipo", "normal"), b.get("cupo", 1),
                                     b["paciente_id"], b.get("motivo", ""), u["id"]))
                    self.audit(c, u, "crear", "turno", cur.lastrowid, f"{b['fecha']} {b['hora']}")
                    nuevos = self.generar_ci(c, u, b["paciente_id"], cur.lastrowid, b.get("motivo", ""), b["fecha"])
                    return {"id": cur.lastrowid, "consentimientos": nuevos}
                if m == "PUT":
                    tid = int(parts[1])
                    sets = [k for k in ("estado", "motivo", "hora") if k in b]
                    c.execute(f"UPDATE turnos SET {','.join(k + '=?' for k in sets)} WHERE id=?", [b[k] for k in sets] + [tid])
                    self.audit(c, u, "editar", "turno", tid, json.dumps(b, ensure_ascii=False))
                    return {"ok": True}
                if m == "DELETE":
                    tid = int(parts[1])
                    if c.execute("SELECT 1 FROM consultas WHERE turno_id=?", (tid,)).fetchone():
                        raise ApiError(400, "Ese turno ya tiene una consulta registrada; no se puede eliminar (márquelo como cancelado).")
                    c.execute("DELETE FROM turnos WHERE id=?", (tid,))
                    self.audit(c, u, "eliminar", "turno", tid)
                    return {"ok": True}

            # ---------------- CONSENTIMIENTOS (recepción también los gestiona)
            if r0 == "medicos":  # médicos que pueden firmar
                return rows(c.execute("SELECT id,nombre,especialidad,registro FROM usuarios WHERE rol IN ('admin','medico') AND activo=1 "
                                      "AND (especialidad!='' OR registro!='' OR firma_cert!='') ORDER BY nombre"))

            if r0 == "historia-resumen":  # lo que ven recepción y enfermería
                pid = int(parts[1])
                vis = rows(c.execute("SELECT t.id, t.fecha, t.hora, t.tipo, t.motivo, t.estado, cc.estado AS consulta_estado, cc.datos AS cdatos "
                                     "FROM turnos t LEFT JOIN consultas cc ON cc.turno_id=t.id WHERE t.paciente_id=? AND t.fecha<=date('now','localtime','+60 days') "
                                     "ORDER BY t.fecha DESC, t.hora DESC", (pid,)))
                for v in vis:
                    dd = json.loads(v.pop("cdatos") or "{}")
                    v["embarazo"] = 1 if dd.get("embarazo") else 0
                    v["fum"] = dd.get("fum", "")
                self.audit(c, u, "ver", "resumen_hc", pid)
                return vis

            if r0 == "consentimientos":
                need("medico", "recepcion")
                if m == "GET":
                    if len(parts) > 1:
                        r = c.execute("SELECT ci.*, u.nombre AS profesional, u.especialidad, u.registro FROM consentimientos ci "
                                      "LEFT JOIN usuarios u ON u.id=ci.actualizado_por WHERE ci.id=?", (int(parts[1]),)).fetchone()
                        if not r:
                            raise ApiError(404, "No encontrado")
                        return dict(r, contenido=json.loads(r["contenido"]))
                    return [dict(r, contenido=json.loads(r["contenido"])) for r in c.execute(
                        "SELECT ci.*, u.nombre AS usuario FROM consentimientos ci LEFT JOIN usuarios u ON u.id=ci.actualizado_por "
                        "WHERE ci.paciente_id=? ORDER BY ci.id DESC", (int(q["paciente"]),))]
                b = self.body()
                if m == "POST":
                    plant = get_ajuste(c, "consentimientos")
                    if b.get("clave") not in plant:
                        raise ApiError(400, "Plantilla no encontrada")
                    cid = self.crear_ci(c, u, b["paciente_id"], b.get("turno_id"), b["clave"], plant[b["clave"]], b.get("fecha") or hoy())
                    return {"id": cid}
                if m == "PUT":
                    cid = int(parts[1])
                    r = c.execute("SELECT * FROM consentimientos WHERE id=?", (cid,)).fetchone()
                    cont = json.loads(r["contenido"])
                    if "riesgos_especificos" in b:
                        if r["estado"] != "pendiente":
                            raise ApiError(400, "El documento ya fue firmado o negado; no se puede modificar.")
                        cont["riesgos_especificos"] = b["riesgos_especificos"]
                    est = b.get("estado")
                    if est:
                        validos = {"pendiente": ("firmado", "negado"), "firmado": ("revocado",)}
                        if est not in validos.get(r["estado"], ()):
                            raise ApiError(400, f"No se puede pasar de '{r['estado']}' a '{est}'.")
                        col = {"firmado": "firmado_en", "negado": "negado_en", "revocado": "revocado_en"}[est]
                        c.execute(f"UPDATE consentimientos SET estado=?, {col}=datetime('now','localtime'), actualizado_por=? WHERE id=?", (est, u["id"], cid))
                    c.execute("UPDATE consentimientos SET contenido=? WHERE id=?", (json.dumps(cont, ensure_ascii=False), cid))
                    self.audit(c, u, est or "editar", "consentimiento", cid, r["titulo"])
                    return {"ok": True}

            # ---------------- CLÍNICO (permisos por sección)
            if r0 == "historia":
                need("medico")
                pid = int(parts[1])
                cons = rows(c.execute("SELECT c.*, u.nombre AS medico FROM consultas c LEFT JOIN usuarios u ON u.id=c.medico_id "
                                      "WHERE paciente_id=? ORDER BY fecha DESC, id DESC", (pid,)))
                for x in cons:
                    x["datos"] = json.loads(x["datos"])
                    x["recetas"] = [dict(r, datos=json.loads(r["datos"])) for r in c.execute("SELECT * FROM recetas WHERE consulta_id=? ORDER BY id", (x["id"],))]
                    x["notas"] = rows(c.execute("SELECT n.*, u.nombre AS usuario FROM consulta_notas n LEFT JOIN usuarios u ON u.id=n.usuario_id WHERE consulta_id=? ORDER BY id", (x["id"],)))
                # recetas hechas sin consulta registrada (por recepción, con el médico tratante)
                for r in c.execute("SELECT r.*, u.nombre AS medico FROM recetas r LEFT JOIN usuarios u ON u.id=r.medico_id WHERE r.paciente_id=? AND r.consulta_id IS NULL ORDER BY r.id", (pid,)):
                    ent = next((x for x in cons if x.get("sin_consulta") and x["fecha"] == r["fecha"]), None)
                    if not ent:
                        ent = {"id": -r["id"], "fecha": r["fecha"], "sin_consulta": 1, "estado": "sin", "medico": r["medico"], "datos": {}, "recetas": [], "notas": []}
                        cons.append(ent)
                    ent["recetas"].append(dict(r, datos=json.loads(r["datos"])))
                cons.sort(key=lambda x: (x["fecha"], x["id"]), reverse=True)
                self.audit(c, u, "ver", "historia_clinica", pid)
                return cons

            if r0 == "consultas":
                if m == "GET":
                    # por turno o por id
                    if q.get("turno"):
                        r = c.execute("SELECT * FROM consultas WHERE turno_id=?", (int(q["turno"]),)).fetchone()
                    else:
                        r = c.execute("SELECT * FROM consultas WHERE id=?", (int(parts[1]),)).fetchone()
                    if not r:
                        return {}
                    d = dict(r)
                    d["datos"] = json.loads(d["datos"])
                    if not clin:  # recepción/enfermería solo reciben lo necesario para recetas, pedidos y certificados
                        dd = d["datos"]
                        d["datos"] = {"diagnosticos": dd.get("diagnosticos", []), "embarazo": dd.get("embarazo"), "fum": dd.get("fum", "")}
                    return d
                need("medico")
                b = self.body()
                if m == "POST" and len(parts) == 3 and parts[2] == "nota":
                    cid = int(parts[1])
                    if not b.get("texto", "").strip():
                        raise ApiError(400, "Escriba la nota")
                    c.execute("INSERT INTO consulta_notas(consulta_id,texto,usuario_id) VALUES(?,?,?)", (cid, b["texto"].strip(), u["id"]))
                    self.audit(c, u, "nota_aclaratoria", "consulta", cid)
                    return {"ok": True}
                if m == "POST":
                    if b.get("turno_id") and c.execute("SELECT 1 FROM consultas WHERE turno_id=?", (b["turno_id"],)).fetchone():
                        raise ApiError(409, "Ya existe una consulta para este turno")
                    cur = c.execute("INSERT INTO consultas(paciente_id,turno_id,fecha,medico_id,datos) VALUES(?,?,?,?,?)",
                                    (b["paciente_id"], b.get("turno_id"), b.get("fecha") or hoy(), u["id"], json.dumps(b.get("datos", {}), ensure_ascii=False)))
                    self.audit(c, u, "crear", "consulta", cur.lastrowid)
                    cid = cur.lastrowid
                    if b.get("cerrar"):
                        self.cerrar(c, u, cid, b.get("datos", {}))
                    return {"id": cid}
                if m == "PUT":
                    cid = int(parts[1])
                    r = c.execute("SELECT * FROM consultas WHERE id=?", (cid,)).fetchone()
                    if r["estado"] == "cerrada":
                        raise ApiError(400, "La consulta ya está firmada y cerrada. Solo puede añadir una nota aclaratoria.")
                    c.execute("UPDATE consultas SET datos=?, actualizado=datetime('now','localtime') WHERE id=?",
                              (json.dumps(b.get("datos", {}), ensure_ascii=False), cid))
                    self.audit(c, u, "editar", "consulta", cid)
                    if b.get("cerrar"):
                        self.cerrar(c, u, cid, b.get("datos", {}))
                    return {"id": cid}

            if r0 == "recetas":
                need("medico", "recepcion")
                if m == "GET":
                    if len(parts) > 1:
                        r = c.execute("SELECT r.*, u.nombre AS medico, u.especialidad, u.registro, e.nombre AS elaborado FROM recetas r LEFT JOIN usuarios u ON u.id=r.medico_id "
                                      "LEFT JOIN usuarios e ON e.id=r.elaborado_por WHERE r.id=?", (int(parts[1]),)).fetchone()
                        d = dict(r)
                        d["datos"] = json.loads(d["datos"])
                        return d
                    return [dict(r, datos=json.loads(r["datos"])) for r in c.execute(
                        "SELECT r.*, u.nombre AS medico FROM recetas r LEFT JOIN usuarios u ON u.id=r.medico_id WHERE paciente_id=? ORDER BY r.id DESC", (int(q["paciente"]),))]
                b = self.body()
                if m == "POST":
                    if not b.get("consulta_id") and not b.get("turno_id"):
                        raise ApiError(400, "La receta debe estar asociada a la atención (turno) del día.")
                    if not (b["datos"].get("diagnostico") or "").strip():
                        raise ApiError(400, "Escriba el diagnóstico de la receta")
                    mid = medico_tratante(c, b, b.get("consulta_id"))
                    items = b["datos"].get("items", [])
                    if not items:
                        raise ApiError(400, "Agregue al menos un medicamento")
                    for it in items:
                        if not it.get("generico") or not it.get("cantidad") or not it.get("indicacion"):
                            raise ApiError(400, "Cada medicamento necesita nombre genérico, cantidad e indicaciones")
                    num = (c.execute("SELECT MAX(numero) FROM recetas").fetchone()[0] or 0) + 1
                    cur = c.execute("INSERT INTO recetas(numero,paciente_id,consulta_id,turno_id,fecha,medico_id,elaborado_por,datos) VALUES(?,?,?,?,?,?,?,?)",
                                    (num, b["paciente_id"], b.get("consulta_id"), b.get("turno_id"), b.get("fecha") or hoy(), mid, u["id"], json.dumps(b["datos"], ensure_ascii=False)))
                    self.audit(c, u, "crear", "receta", cur.lastrowid, f"N.º {num}")
                    return {"id": cur.lastrowid, "numero": num}
                if m == "PUT":  # solo anular
                    need("medico")
                    rid = int(parts[1])
                    c.execute("UPDATE recetas SET anulada=1 WHERE id=?", (rid,))
                    self.audit(c, u, "anular", "receta", rid, b.get("motivo", ""))
                    return {"ok": True}

            if r0 == "medicamentos":
                need("medico", "recepcion")  # recepción también ingresa y edita medicamentos
                if m == "GET":
                    return rows(c.execute("SELECT * FROM medicamentos ORDER BY activo DESC, comercial"))
                b = self.body()
                vals = (b["comercial"].strip(), b["generico"].strip(), b.get("forma", ""), b.get("via", ""), b.get("unidad", ""),
                        int(b.get("cantidad") or 0) or None, b.get("indicacion", ""), int(b.get("activo", 1)))
                if m == "POST":
                    cur = c.execute("INSERT INTO medicamentos(comercial,generico,forma,via,unidad,cantidad,indicacion,activo) VALUES(?,?,?,?,?,?,?,?)", vals)
                    self.audit(c, u, "crear", "medicamento", cur.lastrowid, vals[0])
                    return {"id": cur.lastrowid}
                if m == "PUT":
                    c.execute("UPDATE medicamentos SET comercial=?,generico=?,forma=?,via=?,unidad=?,cantidad=?,indicacion=?,activo=? WHERE id=?", vals + (int(parts[1]),))
                    self.audit(c, u, "editar", "medicamento", int(parts[1]), vals[0])
                    return {"ok": True}

            if r0 == "esquemas":
                need("medico", "recepcion")
                if m == "GET":
                    return [dict(r, items=json.loads(r["items"])) for r in c.execute("SELECT * FROM esquemas ORDER BY nombre")]
                need("medico")
                b = self.body()
                vals = (b["nombre"], b.get("diagnostico", ""), b.get("cie", ""), json.dumps(b.get("items", []), ensure_ascii=False),
                        b.get("recomendaciones", ""), int(b.get("para_pareja", 0)))
                if m == "POST":
                    return {"id": c.execute("INSERT INTO esquemas(nombre,diagnostico,cie,items,recomendaciones,para_pareja) VALUES(?,?,?,?,?,?)", vals).lastrowid}
                if m == "PUT":
                    c.execute("UPDATE esquemas SET nombre=?,diagnostico=?,cie=?,items=?,recomendaciones=?,para_pareja=? WHERE id=?", vals + (int(parts[1]),))
                    return {"ok": True}
                if m == "DELETE":
                    c.execute("DELETE FROM esquemas WHERE id=?", (int(parts[1]),))
                    return {"ok": True}

            if r0 == "examenes":
                need("medico", "recepcion", "enfermeria")
                if m == "GET":
                    ex = rows(c.execute("SELECT e.*, u.nombre AS autor FROM examenes e LEFT JOIN usuarios u ON u.id=e.creado_por "
                                        "WHERE paciente_id=? ORDER BY fecha DESC, id DESC", (int(q["paciente"]),)))
                    for e in ex:
                        e["archivos"] = rows(c.execute("SELECT id,nombre,mime,tamano FROM archivos WHERE examen_id=?", (e["id"],)))
                    return ex
                b = self.body()
                if m == "POST":
                    if b["tipo"] not in EXAM_TIPOS:
                        raise ApiError(400, "Tipo de examen no válido")
                    if not (b.get("texto", "").strip() or b.get("archivos")):
                        raise ApiError(400, "Escriba el informe o adjunte al menos un archivo")
                    cur = c.execute("INSERT INTO examenes(paciente_id,tipo,fecha,titulo,texto,creado_por,pedido_id) VALUES(?,?,?,?,?,?,?)",
                                    (b["paciente_id"], b["tipo"], b.get("fecha") or hoy(), b.get("titulo", ""), b.get("texto", ""), u["id"], b.get("pedido_id")))
                    eid = cur.lastrowid
                    if b.get("pedido_id"):  # el pedido ya tiene su resultado
                        c.execute("UPDATE pedidos SET estado='resultado' WHERE id=?", (b["pedido_id"],))
                    for a in b.get("archivos", []):
                        raw = base64.b64decode(a["data"].split(",", 1)[-1])
                        if len(raw) > MAX_FILE_MB * 1024 * 1024:
                            raise ApiError(413, f"{a['nombre']} supera {MAX_FILE_MB} MB")
                        mime = a.get("mime") or "application/octet-stream"
                        if not (mime.startswith("image/") or mime == "application/pdf"):
                            raise ApiError(400, f"{a['nombre']}: solo se permiten imágenes o PDF")
                        ext = os.path.splitext(a["nombre"])[1].lower()[:6]
                        rel = f"{b['paciente_id']}/{uuid.uuid4().hex}{ext}"
                        os.makedirs(os.path.join(FILES, str(b["paciente_id"])), exist_ok=True)
                        with open(os.path.join(FILES, rel), "wb") as f:
                            f.write(raw)
                        c.execute("INSERT INTO archivos(examen_id,nombre,mime,ruta,tamano) VALUES(?,?,?,?,?)", (eid, a["nombre"], mime, rel, len(raw)))
                    self.audit(c, u, "crear", "examen", eid, b["tipo"])
                    return {"id": eid}

            if r0 == "archivo" and m == "GET":
                need("medico", "recepcion", "enfermeria")
                r = c.execute("SELECT a.*, e.paciente_id FROM archivos a JOIN examenes e ON e.id=a.examen_id WHERE a.id=?", (int(parts[1]),)).fetchone()
                if not r:
                    raise ApiError(404, "Archivo no encontrado")
                with open(os.path.join(FILES, r["ruta"]), "rb") as f:
                    data = f.read()
                self.audit(c, u, "ver", "archivo", r["id"])
                from urllib.parse import quote
                self.send_bytes(data, r["mime"], quote(r["nombre"]))
                return None

            if r0 == "pedidos":
                need("medico", "recepcion", "enfermeria")
                if m == "GET":
                    if len(parts) > 1:
                        r = c.execute("SELECT p.*, u.nombre AS medico, u.especialidad, u.registro FROM pedidos p LEFT JOIN usuarios u ON u.id=p.medico_id WHERE p.id=?", (int(parts[1]),)).fetchone()
                        return dict(r, datos=json.loads(r["datos"]))
                    return [dict(r, datos=json.loads(r["datos"])) for r in c.execute(
                        "SELECT * FROM pedidos WHERE paciente_id=? ORDER BY id DESC", (int(q["paciente"]),))]
                need("medico", "recepcion")
                b = self.body()
                if m == "PUT":  # marcar sin resultado / con resultado
                    c.execute("UPDATE pedidos SET estado=? WHERE id=?", (b.get("estado", "pendiente"), int(parts[1])))
                    return {"ok": True}
                if m == "POST":
                    if b["tipo"] not in PEDIDO_TIPOS:
                        raise ApiError(400, "Tipo de pedido no válido")
                    mid = medico_tratante(c, b)
                    num = (c.execute("SELECT MAX(numero) FROM pedidos").fetchone()[0] or 0) + 1
                    cur = c.execute("INSERT INTO pedidos(numero,paciente_id,tipo,fecha,datos,medico_id,turno_id,estado,elaborado_por) VALUES(?,?,?,?,?,?,?,?,?)",
                                    (num, b["paciente_id"], b["tipo"], b.get("fecha") or hoy(), json.dumps(b["datos"], ensure_ascii=False), mid, b.get("turno_id"), "pendiente", u["id"]))
                    self.audit(c, u, "crear", "pedido", cur.lastrowid, b["tipo"])
                    return {"id": cur.lastrowid, "numero": num}

            if r0 == "certificados":
                need("medico", "recepcion")
                if m == "GET":
                    if len(parts) > 1:
                        r = c.execute("SELECT ce.*, u.nombre AS medico, u.firma_cert, u.firma_iess FROM certificados ce LEFT JOIN usuarios u ON u.id=ce.medico_id WHERE ce.id=?", (int(parts[1]),)).fetchone()
                        return dict(r, datos=json.loads(r["datos"]))
                    return [dict(r, datos=json.loads(r["datos"])) for r in c.execute(
                        "SELECT ce.*, u.nombre AS medico FROM certificados ce LEFT JOIN usuarios u ON u.id=ce.medico_id WHERE paciente_id=? ORDER BY ce.id DESC", (int(q["paciente"]),))]
                b = self.body()
                if m == "POST":
                    if b.get("tipo") not in ("iess", "atencion"):
                        raise ApiError(400, "Tipo de certificado no válido")
                    d = b.get("datos") or {}
                    if b["tipo"] == "iess":
                        for k, l in (("diagnostico", "el diagnóstico"), ("cie", "el código CIE-10"), ("desde", "la fecha desde"), ("hasta", "la fecha hasta")):
                            if not str(d.get(k, "")).strip():
                                raise ApiError(400, f"Falta {l}")
                        if d["hasta"] < d["desde"]:
                            raise ApiError(400, "La fecha 'hasta' no puede ser anterior a 'desde'")
                        # guardar lugar y puesto de trabajo en la ficha
                        c.execute("UPDATE pacientes SET empresa=?, puesto=? WHERE id=?", (d.get("empresa", ""), d.get("puesto", ""), b["paciente_id"]))
                    mid = medico_tratante(c, b)
                    num = (c.execute("SELECT MAX(numero) FROM certificados").fetchone()[0] or 0) + 1
                    cur = c.execute("INSERT INTO certificados(numero,paciente_id,tipo,fecha,datos,medico_id,elaborado_por) VALUES(?,?,?,?,?,?,?)",
                                    (num, b["paciente_id"], b["tipo"], b.get("fecha") or hoy(), json.dumps(d, ensure_ascii=False), mid, u["id"]))
                    self.audit(c, u, "crear", "certificado", cur.lastrowid, b["tipo"])
                    return {"id": cur.lastrowid, "numero": num}

            if r0 == "auditoria":
                need_admin()
                return rows(c.execute("SELECT a.*, u.nombre AS usuario FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id ORDER BY a.id DESC LIMIT 500"))

            if r0 == "respaldo" and m == "GET":
                need_admin()
                self.audit(c, u, "respaldo", "sistema")
                c.commit()
                buf = io.BytesIO()
                tmp = os.path.join(DATA, "_respaldo_tmp.db")
                if os.path.exists(tmp):
                    os.remove(tmp)
                src, dst = sqlite3.connect(DB_PATH), sqlite3.connect(tmp)
                src.backup(dst)
                src.close()
                dst.close()
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                    z.write(tmp, "isim.db")
                    for root, _, fs in os.walk(FILES):
                        for fn in fs:
                            full = os.path.join(root, fn)
                            z.write(full, os.path.join("archivos", os.path.relpath(full, FILES)))
                os.remove(tmp)
                name = f"respaldo_isim_{dt.datetime.now():%Y%m%d_%H%M}.zip"
                self.send_bytes(buf.getvalue(), "application/zip", name, download=True)
                return None

        raise ApiError(404, "Ruta no encontrada")

    # ------------------------------------------------------------- helpers
    def pub_user(self, u):
        if not u:
            return None
        return {k: u.get(k) or "" if k.startswith("firma") else u[k] for k in ("id", "usuario", "nombre", "rol", "especialidad", "registro", "firma_cert", "firma_iess")}

    def crear_ci(self, c, u, pid, tid, clave, plantilla, fecha):
        cont = dict(plantilla)
        p = c.execute("SELECT alergias, ant_personales, ant_quirurgicos, nota_importante FROM pacientes WHERE id=?", (pid,)).fetchone()
        if clave != "datos" and p:
            esp = []
            if p["alergias"] and norm(p["alergias"]) not in ("no refiere", "ninguna", "no"):
                esp.append("Alergias: " + p["alergias"])
            if p["ant_personales"] and norm(p["ant_personales"]) not in ("no refiere", "ninguna", "no"):
                esp.append("Enfermedades: " + p["ant_personales"])
            if p["nota_importante"]:
                esp.append(p["nota_importante"])
            cont["riesgos_especificos"] = ". ".join(esp)
        cur = c.execute("INSERT INTO consentimientos(paciente_id,turno_id,clave,titulo,fecha,contenido,creado_por,actualizado_por) VALUES(?,?,?,?,?,?,?,?)",
                        (pid, tid, clave, plantilla.get("titulo", clave), fecha, json.dumps(cont, ensure_ascii=False), u["id"], u["id"]))
        self.audit(c, u, "generar", "consentimiento", cur.lastrowid, plantilla.get("titulo", clave))
        return cur.lastrowid

    def generar_ci(self, c, u, pid, tid, motivo, fecha):
        """Al asignar turno: autorización de datos (una vez) + consentimiento del procedimiento según el motivo."""
        plant = get_ajuste(c, "consentimientos") or {}
        mot = {x["motivo"]: x.get("consentimiento") for x in (get_ajuste(c, "motivos") or [])}
        nuevos = []
        vivos = "estado IN ('pendiente','firmado')"
        if "datos" in plant and not c.execute(f"SELECT 1 FROM consentimientos WHERE paciente_id=? AND clave='datos' AND {vivos}", (pid,)).fetchone():
            nuevos.append(self.crear_ci(c, u, pid, tid, "datos", plant["datos"], fecha))
        clave = mot.get(motivo)
        if clave and clave in plant:
            if clave == "atencion_gineco":  # el general vale por un año
                ya = c.execute(f"SELECT 1 FROM consentimientos WHERE paciente_id=? AND clave=? AND {vivos} AND fecha>=date(?, '-365 days')", (pid, clave, fecha)).fetchone()
            else:  # procedimientos: uno por cada turno
                ya = c.execute(f"SELECT 1 FROM consentimientos WHERE turno_id=? AND clave=?", (tid, clave)).fetchone()
            if not ya:
                nuevos.append(self.crear_ci(c, u, pid, tid, clave, plant[clave], fecha))
        return nuevos

    def cerrar(self, c, u, cid, datos):
        if not (datos.get("motivo") or "").strip():
            raise ApiError(400, "Para firmar la consulta llene el motivo de consulta.")
        if not datos.get("diagnosticos"):
            raise ApiError(400, "Para firmar la consulta registre al menos un diagnóstico (CIE-10).")
        c.execute("UPDATE consultas SET estado='cerrada', cerrada_en=datetime('now','localtime'), medico_id=? WHERE id=?", (u["id"], cid))
        t = c.execute("SELECT turno_id FROM consultas WHERE id=?", (cid,)).fetchone()["turno_id"]
        if t:
            c.execute("UPDATE turnos SET estado='atendido' WHERE id=?", (t,))
        self.audit(c, u, "firmar", "consulta", cid)

    def validar_paciente(self, b, pid=None):
        for k, lab in (("cedula", "cédula / documento"), ("apellidos", "apellidos"), ("nombres", "nombres")):
            if k in b and not (b.get(k) or "").strip():
                raise ApiError(400, f"Falta {lab}")
        if pid is None:
            for k, lab in (("cedula", "cédula"), ("apellidos", "apellidos"), ("nombres", "nombres"), ("fecha_nac", "fecha de nacimiento"), ("telefono", "teléfono")):
                if not (b.get(k) or "").strip():
                    raise ApiError(400, f"Falta {lab}")
            if not b.get("consentimiento_datos"):
                raise ApiError(400, "Debe registrar el consentimiento de la paciente para el tratamiento de sus datos personales (LOPDP).")
        if "cedula" in b and b.get("tipo_doc", "cedula") == "cedula" and not cedula_valida(b["cedula"].strip()):
            raise ApiError(400, "El número de cédula no es válido (verifique los 10 dígitos).")
        if b.get("apellidos"):
            b["apellidos"] = b["apellidos"].strip().upper()
        if b.get("nombres"):
            b["nombres"] = b["nombres"].strip().upper()

    def instalar(self):
        b = self.body()
        with LOCK, db() as c:
            if c.execute("SELECT COUNT(*) FROM usuarios").fetchone()[0]:
                raise ApiError(400, "El sistema ya fue instalado")
            if len(b.get("password", "")) < 8:
                raise ApiError(400, "La contraseña debe tener al menos 8 caracteres")
            s, h = hash_pw(b["password"])
            nom, esp = b["nombre"].strip(), b.get("especialidad", "").strip()
            c.execute("INSERT INTO usuarios(usuario,nombre,rol,salt,pass_hash,especialidad,registro,firma_cert,firma_iess) VALUES(?,?,?,?,?,?,?,?,?)",
                      (b["usuario"].strip().lower(), nom, "admin", s, h, esp, b.get("registro", ""),
                       "\n".join(x for x in (nom, esp, "Director Médico – Instituto de Salud Integral de la Mujer (ISIM)") if x),
                       "\n".join(x for x in (nom, esp.upper()) if x)))
        return self.login(b)

    def login(self, b=None):
        b = b or self.body()
        usr = (b.get("usuario") or "").strip().lower()
        f = FAILED.get(usr)
        if f and f[0] >= 5 and f[1] > time.time():
            raise ApiError(429, "Demasiados intentos. Espere 5 minutos.")
        with db() as c:
            r = c.execute("SELECT * FROM usuarios WHERE usuario=? AND activo=1", (usr,)).fetchone()
            ok = r and hmac.compare_digest(hash_pw(b.get("password", ""), r["salt"])[1], r["pass_hash"])
            if not ok:
                n = (f[0] if f and f[1] > time.time() else 0) + 1
                FAILED[usr] = [n, time.time() + 300]
                self.audit(c, None, "login_fallido", "usuario", None, usr)
                raise ApiError(401, "Usuario o contraseña incorrectos")
            FAILED.pop(usr, None)
            tok = secrets.token_urlsafe(32)
            c.execute("DELETE FROM sesiones WHERE expira<?", (time.time(),))
            c.execute("INSERT INTO sesiones VALUES(?,?,?)", (tok, r["id"], time.time() + SESSION_HOURS * 3600))
            self.audit(c, dict(r), "login", "usuario", r["id"])
        self.send_json({"usuario": self.pub_user(dict(r))},
                       extra_headers={"Set-Cookie": f"isim_s={tok}; Path=/; HttpOnly; SameSite=Strict"})
        return None


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    init_db()
    srv = ThreadingHTTPServer(("0.0.0.0", port), H)
    print("=" * 60)
    print("  SISTEMA MÉDICO ISIM — en funcionamiento")
    print(f"  En esta computadora:      http://localhost:{port}")
    print(f"  Desde otras de la red:    http://{local_ip()}:{port}")
    print("  (No cierre esta ventana mientras se use el sistema)")
    print("=" * 60)
    if "--no-browser" not in sys.argv:
        try:
            import webbrowser
            threading.Timer(1.2, lambda: webbrowser.open(f"http://localhost:{port}")).start()
        except Exception:
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
