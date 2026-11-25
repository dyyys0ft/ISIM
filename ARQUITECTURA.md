# Arquitectura — SGCPM-ISIM

Sistema de Gestión de Consentimientos de Procedimientos Médicos
Instituto de la Mujer Riobamba · Ejecución local · Interfaz web responsive

---

## 1. Decisiones técnicas

| Tema | Decisión | Motivo |
|---|---|---|
| Runtime | Node.js 24 (mínimo 23) | Usa `node:sqlite`, incluido en Node. Sin dependencias nativas. |
| Servidor HTTP | `node:http` + router propio | Cero frameworks, arranque inmediato, fácil de auditar. |
| Base de datos | SQLite en modo WAL | Un solo equipo, sin servidor de BD, transacciones ACID y respaldo por archivo. |
| Tiempo real | WebSocket (`ws`) | La firma viaja de la pantalla externa al servidor y ambos lados reciben el resultado. |
| Frontend | HTML5 + CSS + JavaScript ES Modules | Sin build, sin frameworks, según el README. |
| PDF | Impresión del navegador (`@media print`) | Evita dependencias; el documento firmado se imprime o guarda como PDF. |
| Autenticación | Usuario + contraseña (scrypt) + cookie HttpOnly | Usuarios únicos sin distinguir mayúsculas; contraseñas de 8+ caracteres. |

> `node:sqlite` es una API experimental de Node: al arrancar muestra un aviso
> `ExperimentalWarning`. No afecta el funcionamiento; desaparecerá cuando Node la estabilice.

---

## 2. Estructura de carpetas

```
SISTEMA_CONSENTIMIENTOS_ISIM/
├─ server/
│  ├─ index.js                 Arranque HTTP + WebSocket + estáticos
│  ├─ config.js                Rutas, puerto, host y tiempos
│  ├─ lib/
│  │  ├─ http.js               Router, JSON, cookies, archivos estáticos
│  │  ├─ audit.js              Bitácora append-only
│  │  ├─ images.js             Validación de PNG (logo y firmas)
│  │  └─ permissions.js        Matriz de permisos por rol
│  ├─ db/
│  │  ├─ index.js              Conexión SQLite, helpers, transacciones
│  │  ├─ schema.sql            Tablas, índices y triggers de inmutabilidad
│  │  └─ seed.js               Datos iniciales idempotentes
│  ├─ modules/
│  │  ├─ auth.js               Login, sesiones, usuario y contraseña
│  │  ├─ users.js              Usuarios, perfiles y contraseñas (admin)
│  │  ├─ patients.js           CRUD de pacientes (baja lógica)
│  │  ├─ documents.js          Documentos, versiones, enlaces de firma
│  │  ├─ registry.js           Registro histórico de firmas
│  │  ├─ settings.js           Logo del encabezado, pie de página y datos del sistema
│  │  └─ signatures.js         Validación y guardado de la firma
│  ├─ ws/
│  │  └─ hub.js                Canal /ws/firma y salas por token
│  └─ scripts/
│     └─ set-password.js       Cambio de contraseña por consola
├─ public/
│  ├─ index.html               Acceso con usuario y contraseña (sin lista de usuarios)
│  ├─ documentos.html          Listado y creación de documentos
│  ├─ documento.html           Visor, versiones, firma e impresión
│  ├─ pacientes.html           CRUD de pacientes
│  ├─ usuarios.html            Administración de usuarios (solo admin)
│  ├─ registro.html            Registro histórico de firmas
│  ├─ cuenta.html              Perfil propio, contraseña y firma del médico
│  ├─ ajustes.html             Encabezado, pie de página e información del sistema
│  ├─ firma.html               Pantalla externa de firma
│  ├─ css/
│  │  ├─ tokens.css            Variables de diseño
│  │  ├─ base.css              Reset, tipografía, impresión
│  │  └─ components.css        Componentes y pantallas
│  └─ js/
│     ├─ api.js                Cliente fetch
│     ├─ ui.js                 Utilidades de interfaz
│     ├─ permisos.js           Comprobación de permisos en el cliente
│     ├─ chrome.js             Cabecera común, navegación y sesión
│     ├─ components/
│     │  ├─ hoja.js            Encabezado y firma precargada del profesional
│     │  └─ signature-pad.js   Canvas de firma (pointer events)
│     └─ pages/
│        ├─ login.js
│        ├─ documentos.js
│        ├─ documento.js
│        ├─ pacientes.js
│        ├─ usuarios.js
│        ├─ registro.js
│        ├─ cuenta.js
│        ├─ ajustes.js
│        └─ firma.js
├─ data/                       (no versionar) base y firmas
│  ├─ sgcpm.db
│  └─ firmas/*.png
├─ package.json
├─ .env.example
└─ README.txt                  Especificación original
```

---

## 3. Modelo de datos

```
users ──< sessions
users ──< documents >── patients
documents ──< document_versions ──< sign_sessions ──1 signatures
users ──< audit_log (referencia lógica)
```

| Tabla | Campos relevantes | Notas |
|---|---|---|
| `users` | nombre, cédula, `username` único, `password_hash`, rol, activo, firma del médico | Roles: cualquier `roles.slug`; `pin_hash` queda solo como columna heredada. |
| `roles` | slug, nombre, descripción, protegido, activo | Los roles del sistema (`protegido = 1`) se pueden editar pero no eliminar. |
| `role_permissions` | role_slug, permiso | Permisos efectivos por rol. Cambios aplican en la siguiente petición. |
| `sessions` | token, user_id, expira_en | Una sola sesión activa por usuario; al entrar desde otro dispositivo se invalida la anterior. Expira a las 8 h. |
| `patients` | cédula única, nombres, apellidos, ocupación, estado civil, ciudad, datos clínicos, representantes legales, fecha de actualización, activo | Baja lógica: nunca se borra. Si es menor de 18 años exige representante legal 1; el 2 es opcional. |
| `templates` | nombre, tipo, cuerpo_html, `firma_modo` | Variables `{{paciente.*}}` (incluye `edad_texto` y representantes), `{{usuario.*}}`, `{{fecha}}`, `{{hora}}`, `{{fecha_hora}}` y bloques `{{#menor}}…{{/menor}}` / `{{#adulto}}…{{/adulto}}`. `firma_modo`: paciente, medico o ambas. |
| `documents` | patient_id, título, estado, version_actual, médico responsable, firma del médico, modo de firma | Estado: borrador, pendiente_firma, firmado, anulado. `firma_modo`: paciente, medico o ambas. |
| `document_versions` | numero, contenido_html, hash, estado | `UNIQUE(document_id, numero)`. |
| `appointments` | patient_id, medico_id, fecha_hora, duracion_min, motivo, estado, notas | Agenda. Estados: programada, confirmada, en_progreso, atendida, cancelada, reagendada, no_asistio. |
| `clinical_records` | appointment_id único, patient_id, medico_id, fecha, motivo_consulta, notas, diagnostico, tratamiento, receta, indicaciones, recomendaciones | Una historia clínica por cita (consulta). |
| `clinical_exams` | record_id, patient_id, nombre, tipo, descripcion, indicaciones, estado, observaciones | Exámenes de la consulta. Se pueden crear con nombre, descripción y archivos en un solo paso. Estados: solicitado, recibido, evaluado. |
| `clinical_attachments` | record_id, patient_id, exam_id, nombre, mime, tamano, ruta, hash | Archivos en `data/historias`; siempre asociados a un examen. Máximo 10 documentos por paciente. PNG/JPG/WEBP/PDF hasta 8 MB. |
| `appointment_notifications` | appointment_id, canal, destino, plantilla, estado, proveedor_id, error | Registro de confirmaciones enviadas por WhatsApp. |
| `sign_sessions` | token_hash, version_id, estado, expira_en | Token de un solo uso, 10 min. |
| `signatures` | snapshots, `gestionado_*`, título, ruta PNG, hashes, fecha, IP | `UNIQUE(version_id)`: una firma por versión. |
| `settings` | clave, valor, actualizado_en | Nombre y dirección del centro médico, logo del encabezado, pie de página y metadatos. |
| `migration_runs` | archivo, estado, resumen, error | Análisis y ejecuciones de migración. |
| `migration_map` | entidad, old_id, new_id, run_id | Mapa idempotente entre códigos antiguos y nuevos. |
| `catalogo_diagnosticos` | legacy_id, cie10, diagnostico, observacion | Catálogo CIE10 importado. |
| `catalogo_medicinas` | legacy_id, medicina, dci, forma, vía, dosis, frecuencia | Catálogo de medicinas importado. |
| `catalogo_tratamientos` | legacy_id, nombre, medicina, dosis, frecuencia | Catálogo de tratamientos importado. |
| `catalogo_informes` | legacy_id, nombre, informe, observacion | Plantillas de informe importadas. |
| `prescriptions` | record_id único, patient_id, médico, fecha, hora, lugar, encabezado, pie, firma, SENECYT, token | Receta digital; el token permite compartirla. |
| `prescription_items` | prescription_id, orden, medicamento, presentación, dosis, vía, frecuencia, duración, cantidad, indicaciones | Medicamentos de la receta. |
| `patient_share_links` | patient_id, token, creado_por, revocado_en, ultimo_acceso_en | Enlaces públicos para compartir documentos de exámenes. |
| `crm_conversations` | patient_id único, teléfono, wa_id, no_leídos, último mensaje | Conversación de WhatsApp por paciente. |
| `crm_messages` | conversation_id, patient_id, appointment_id, dirección, tipo, contenido, proveedor_id, estado | Mensajes entrantes/salientes; las confirmaciones de citas se vinculan con `appointment_id`. |
| `crm_tasks` | patient_id, tipo, motivo, descripción, prioridad, estado, fecha_límite, asignado_a | Tareas, quejas y sugerencias. |
| `audit_log` | acción, entidad, autor, fecha | Solo inserción. |

### Reglas de integridad

1. **Una versión firmada es inmutable.** Triggers de SQLite bloquean `UPDATE` y `DELETE`
   sobre `document_versions` con estado `firmada`.
2. **Una firma es inmutable.** Triggers bloquean `UPDATE` y `DELETE` sobre `signatures`.
3. **Los datos del paciente no alteran firmas pasadas.** Al firmar se guarda un
   `patient_snapshot` y un `user_snapshot` en JSON, además del hash del documento.
4. **Una versión tiene una sola firma.** Restricción `UNIQUE(version_id)`.
5. **Editar después de firmar crea una versión nueva.** La versión firmada queda intacta
   y se agrega V2, V3… como borrador.
6. **El enlace de firma caduca.** Token aleatorio de 32 bytes, guardado solo como SHA-256,
   válido 10 minutos y de un solo uso.
7. **Baja lógica de pacientes.** `activo = 0`; sus documentos se conservan.
8. **Cada firma conserva su contexto.** Se guardan `gestionado_por`, `gestionado_nombre`,
   `gestionado_rol`, `documento_titulo` y `firmado_en`, de modo que cambiar después el nombre
   del empleado, del paciente o el título del documento no altera el registro histórico.
9. **El logo del encabezado es global.** Se guarda como PNG en `data/sistema/logo.png` y se
   muestra arriba de cada documento y de la pantalla de firma.
10. **La firma del médico se precarga.** Al crear un documento se elige el médico responsable
    (por defecto el usuario médico que lo crea) y se copia su firma a una instantánea del
    documento (`medico_id`, `medico_firma_path`); si el médico la cambia después, los
    documentos anteriores conservan la firma con la que se generaron.
11. **Pacientes menores de edad.** Si `fecha_nacimiento` indica menos de 18 años, el sistema
    exige registrar al representante legal 1 (nombre y cédula); el representante legal 2 es
    opcional. El consentimiento lo firma el representante legal 1 y su nombre, cédula y
    parentesco se guardan en el snapshot de la firma.
12. **El pie de página es texto global.** Se guarda en `settings` (`pie_texto`) y se muestra
    al final de cada documento y de la pantalla de firma. Se configura desde
    Ajustes del sistema → Pie de página.
13. **Firma externa con QR.** Además de firmar en el equipo, el operador puede generar un QR
    con un token único por consentimiento. El QR usa la IP local del servidor para que el
    celular del paciente lo alcance. Al escanearlo, el paciente confirma sus datos antes de
    firmar; si rechaza, la sesión se cancela y el operador recibe el aviso por WebSocket.
14. **Copia impresa sin casilla en el documento.** El paciente decide al terminar de firmar.
    Si pide copia, la página del operador muestra una alerta roja permanente hasta que se
    pulsa Imprimir; en ese momento se registra `copia_entregada` y la alerta desaparece.
15. **HTTPS local.** El servidor HTTP del puerto 3000 se mantiene como respaldo. Si existe
    `data/sistema/https/server.pfx`, se inicia un segundo servidor HTTPS en el puerto 3443.
    El certificado lo genera `GENERAR_CERTIFICADO_HTTPS.bat` con una CA local; la CA se
    instala en Windows y se distribuye como `public/isim-ca.crt` para instalarla en el
    celular. El QR usa HTTPS solo con `QR_HTTPS=1`; por defecto usa HTTP para que el teléfono
    no instale certificados.
16. **Concurrencia de la base de datos.** SQLite trabaja en modo WAL, con
    `busy_timeout = 15000`, `synchronous = NORMAL` y transacciones `BEGIN IMMEDIATE`.
    Las escrituras críticas (código único de documentos, firma, sesiones) se hacen dentro
    de una transacción; si la base está ocupada, se reintenta o se responde 503. Las
    transacciones anidadas reutilizan la transacción exterior.
17. **Agenda e historia clínica.** Cada cita pertenece a una paciente. El médico solo ve
    su propia agenda y no puede crear, editar ni cancelar citas; el operador (Secretario/a)
    y el admin gestionan la agenda. Cada cita puede tener una única consulta
    (`UNIQUE appointment_id`). Al pulsar “Empezar consulta” se crea la consulta, la cita pasa
    a **en_progreso** y el médico registra notas, diagnóstico, tratamiento, receta,
    indicaciones y recomendaciones. Dentro de la consulta el médico ve un resumen y la lista
    de consultas anteriores de la paciente, con acceso a su historia completa. Al pulsar
    “Finalizar consulta” la cita pasa a **atendida** y en la agenda se muestra como
    **Finalizada**. El Secretario/a puede actualizar el estado con un solo botón desde la
    agenda (En progreso, Finalizada, Cancelada, Reagendada, etc.).
18. **Exámenes.** En la consulta el usuario puede añadir un examen con nombre, tipo,
    descripción y archivos en un solo paso, sin una solicitud previa separada. Cada examen tiene
    estado (solicitado, recibido, evaluado), descripción y una **observación** que solo puede
    modificar el rol médico. Se puede editar, eliminar, visualizar y descargar. La historia del
    paciente muestra cada consulta con sus exámenes y archivos.
19. **Adjuntos clínicos.** Las imágenes y PDF se guardan de forma escalable en
    `data/historias/<shard>/<patient_id>/<exam_id>/`, con índices por paciente y examen. Se
    valida el contenido real y se limita a 8 MB por archivo y 10 documentos por paciente. Deben
    estar asociados a un examen; no se permiten archivos sueltos. La descarga exige sesión y
    permiso `historias.ver`; la carga y eliminación exigen `historias.gestionar`.
20. **Vistas de agenda y navegación.** La agenda ofrece vista de lista y calendario mensual;
    el calendario muestra una vista previa de hasta **3 citas por día** y un botón **+N más**
    cuando hay más. Así una celda con 100 citas no se expande ni satura la cuadrícula; al pulsar
    **+N más** se abre ese día completo en la vista de lista. Al seleccionar una cita se
    abre su detalle con la acción “Empezar consulta” para el médico. El menú principal
    prioriza Agenda, Dashboard, Pacientes e Historias; Estadísticas de consentimientos,
    Documentos, Plantillas y Registro se agrupan en la pestaña Consentimientos.
21. **Ficha de la paciente.** Desde el enlace Historia de cada paciente se abre su ficha
    resumen con edad, número de consultas, exámenes pendientes, última consulta y próxima
    cita, seguida de sus consultas y exámenes. El listado general de Historias se describe en
    la regla 26.
22. **Alerta de exámenes pendientes.** Si está activa la preferencia
    `alerta_examenes_pendientes` (por defecto sí), las historias muestran una alerta con los
    exámenes en estado solicitado que aún no tienen resultado subido. La preferencia se
    configura en Ajustes → Alertas y se expone a todos los usuarios en `/api/auth/me`.
23. **Visitas simultáneas.** La preferencia `permitir_citas_simultaneas` (por defecto
    desactivada) controla si un médico puede tener varias citas en el mismo horario. Se
    configura en Ajustes → Agenda. Si está desactivada, la API rechaza el solapamiento con
    un mensaje; si está activada, permite agendar visitas simultáneas.
24. **Confirmaciones por WhatsApp Business API.** Se configura en Ajustes → WhatsApp con
    `whatsapp_phone_number_id`, `whatsapp_token`, versión de Graph API, plantilla, idioma y
    código de país. La plantilla debe tener 4 parámetros: nombre, fecha, hora y médico. El
    envío manual se hace desde el detalle de la cita; el envío automático al crear la cita
    se activa con `whatsapp_auto`. Cada intento se registra en
    `appointment_notifications`. El token nunca se devuelve al frontend.
25. **Modo DEMO.** Ajustes → DEMO permite cargar 1000 pacientes, 5000 citas y sus historias
    clínicas con exámenes para probar rendimiento y concurrencia. Todos los registros se marcan
    con `demo = 1`. Al desactivar el modo se eliminan únicamente esos registros; si alguna
    paciente de demostración tiene documentos, citas o historias reales asociadas, se conserva
    para no romper la integridad referencial. También está disponible por consola:
    `npm run demo -- on|off|estado`.
26. **Carpetas de historias y consultas.** La pantalla Historias mantiene una carpeta por
    paciente. Al abrir una carpeta se muestra la lista de consultas de esa paciente, siempre
    de la más reciente a la más antigua, con un separador entre cada cita. Cada consulta
    indica fecha, motivo, diagnóstico, profesional, cantidad de exámenes y pendientes.
27. **Dashboard de citas.** Es una página independiente en el menú principal, junto a Agenda
    y Pacientes. Muestra indicadores de citas y pacientes de hoy, próximos 7 y 30 días,
    embarazos atendidos en los últimos 12 meses y seis gráficos: pacientes/citas por día,
    semana o mes; citas por estado (dona interactiva); citas por día de la semana; citas por
    hora; citas por médico; y motivos de consulta más frecuentes de los últimos 6 meses. Al
    hacer clic en un día del gráfico principal se abre la agenda filtrada a esa fecha.
28. **Menús de navegación.** Los grupos Consentimientos y Ajustes del sistema funcionan como
    acordeón: al abrir uno se cierra el otro; al hacer clic fuera o presionar Escape se cierran
    y sueltan el foco. En la tarjeta de cada paciente ya no aparece el acceso a Documentos:
    los archivos clínicos solo se cargan dentro de los exámenes solicitados en una consulta.
29. **Previsualización de plantillas.** En Consentimientos → Plantillas cada plantilla tiene
    el botón Previsualizar. La API `/api/templates/:id/preview` renderiza la plantilla con una
    paciente y un profesional reales, sin crear un documento. La vista incluye logo, encabezado,
    firmas y pie configurado.
30. **Calendario de agenda.** Cada día muestra el mes arriba y el número grande; la fecha
    seleccionada queda resaltada. Las citas muestran la hora en grande a la izquierda y el
    nombre a la derecha. El botón “Ver agenda del día” abre la lista de esa fecha.
31. **Edición de consultas.** Al abrir una consulta desde Historias o la agenda, un usuario con
    `historias.gestionar` puede modificar los campos y agregar o actualizar exámenes, incluso si
    la cita ya está finalizada. Fuera de la tarjeta se muestra la fecha de la última modificación
    y el usuario que la realizó (`clinical_records.actualizado_por`).
32. **Visualización de resultados.** Cada archivo de examen tiene botones Visualizar y
    Descargar. El servidor entrega imágenes y PDF con `content-disposition: inline`, de modo
    que ambos formatos se abren directamente en el navegador.
33. **Migración desde `old_db.sql`.** Ajustes → Migración permite subir el respaldo MySQL
    antiguo. Primero se analiza y muestra un resumen; al confirmar se crea un respaldo
    automático de SQLite y se ejecuta la migración en una transacción. Se importan catálogos,
    pacientes, citas, citas históricas para consultas sin cita, consultas, recetas agrupadas y
    exámenes. La migración es idempotente mediante `migration_map` y se fusiona con los datos
    actuales sin eliminar registros.
34. **Datos incompletos de pacientes migrados.** Los pacientes con cédula temporal, cédula
    duplicada, fecha de nacimiento o sexo pendientes quedan marcados con
    `datos_incompletos = 1` y el detalle en `datos_incompletos_detalle`. La pantalla Pacientes
    muestra el distintivo “Datos por actualizar”; al editar y guardar la ficha se limpia la
    marca.
35. **Catálogos antiguos.** La migración crea y llena `catalogo_diagnosticos`,
    `catalogo_medicinas`, `catalogo_tratamientos` y `catalogo_informes` con los códigos
    antiguos en `legacy_id`.
36. **Paginación y búsqueda de pacientes e historias.** Los listados usan paginación en el
    servidor con 24 registros por página y un máximo de 100. Las rutas
    `/api/patients/paginated` y `/api/clinical-history/patients/paginated` devuelven
    `items`, `total`, `page`, `pages` y `limit`. La búsqueda tiene campos separados
    `nombre`, `apellido` y `cedula`, y usa la función SQLite `sin_tildes` para ignorar
    mayúsculas y tildes. La paginación de historias primero selecciona la página de pacientes
    y luego calcula sus indicadores solo para esos IDs.
37. **Datos demográficos de la paciente.** `patients` incluye `ocupacion`, `estado_civil`,
    `ciudad` y `fecha_registro_informacion`. La fecha se actualiza al crear o editar la ficha.
    Al iniciar el sistema se revisan notas antiguas de migración: si contienen
    `Ocupación:`, `Estado civil:` o `Ciudad:`, se copian a sus columnas y se eliminan del
    texto de notas.
38. **Cédula única.** Crear o editar una paciente con una cédula ya registrada devuelve
    `409` y el mensaje “Ya existe una paciente registrada con esa cédula.”.
39. **Depuración de duplicados.** Ajustes → Migración permite revisar y depurar duplicados.
    Los pacientes se agrupan por cédula base (incluyendo `DUP-...`) y por nombre completo +
    fecha de nacimiento cuando no hay cédulas válidas distintas. Las consultas se agrupan por
    paciente, fecha, motivo, diagnóstico, notas y receta. Antes de depurar se crea un respaldo.
    Las citas, historias y exámenes de las fichas duplicadas se mueven a la ficha conservada.
40. **Referencias de archivos.** `clinical_exams.referencias_archivo` conserva los nombres de
    imágenes o documentos del sistema anterior en formato JSON. La interfaz muestra
    “Pendiente de cargar”; los archivos pueden adjuntarse después al examen.
41. **Rendimiento e índices.** Se agregan índices compuestos para pacientes, citas, historias,
    exámenes y documentos, además de las vistas `vista_pacientes_resumen`,
    `vista_consultas_paciente`, `vista_agenda_citas` y `vista_examenes_pendientes`. SQLite no
    implementa procedimientos almacenados; las consultas frecuentes se preparan una vez y se
    reutilizan desde el servidor.
42. **Filtros de agenda.** Los filtros de búsqueda, estado y médico están ocultos por defecto
    detrás del botón Filtros. El botón se expande y se pliega; muestra cuántos filtros están
    activos.
43. **Receta médica digital.** Cada consulta puede tener una receta estructurada en
    `prescriptions` y `prescription_items`. El médico agrega medicamentos, presentación, dosis,
    vía, frecuencia, duración, cantidad e indicaciones. La receta tiene encabezado, lugar,
    fecha, hora y pie editables. El logo institucional se toma de Ajustes.
44. **Firma y SENECYT en la receta.** Al guardar se copia el nombre, especialidad, cédula,
    firma PNG y código SENECYT del médico responsable. La receta se puede imprimir o guardar
    como PDF desde el navegador. El enlace público `/receta.html?t=<token>` muestra la misma
    receta con su firma.
45. **Envío de receta por WhatsApp.** Si Meta Cloud API está configurado se intenta enviar un
    mensaje con el enlace seguro de la receta. Si no está configurado o falla, se abre WhatsApp
    Web con el mensaje preparado. El enlace contiene la firma digital y el código SENECYT.
46. **Ordenamiento de listados.** Pacientes e Historias permiten ordenar por nombre, cédula y
    fecha, en orden ascendente o descendente. El orden se aplica en el servidor mediante el
    parámetro `orden` antes de paginar.
47. **Texto UTF-8 y tildes.** La base SQLite almacena texto UTF-8. La migración lee el respaldo
    MySQL como UTF-8 y se ejecutó una reparación de mojibake sobre pacientes, citas, historias,
    exámenes y catálogos para recuperar tildes y eñes.
48. **Enlaces públicos de documentos.** Desde la historia de una paciente se puede generar un
    enlace para compartir las imágenes y PDF de sus exámenes. El enlace usa un token aleatorio
    en `patient_share_links`, se puede revocar y regenerar, y no requiere inicio de sesión.
    La página pública es `/documentos-paciente.html?t=<token>`. El enlace se puede copiar o
    enviar por WhatsApp con el mismo mecanismo de envío/alternativa manual de las recetas.
49. **CRM de pacientes.** La página `/crm.html` tiene tres pestañas: **Pacientes** (contactos,
    conversación de WhatsApp, citas próximas y solicitudes de la paciente), **Solicitudes**
    (tabla de tareas, quejas y sugerencias con búsqueda y filtros por tipo, estado y prioridad)
    y **Kanban** (tablero para priorizar arrastrando tarjetas). La pestaña activa se refleja en
    la URL (`#pacientes`, `#solicitudes`, `#kanban`).
50. **Solicitudes del CRM.** `crm_tasks` permite crear tareas, quejas o sugerencias con paciente,
    motivo, descripción, prioridad, estado y fecha límite. Se pueden crear desde cualquier
    pestaña con el buscador de pacientes, editar y cambiar prioridad/estado desde la tabla o el
    panel del contacto. El Kanban se agrupa por prioridad o por estado; al arrastrar una tarjeta
    a otra columna se actualiza el campo correspondiente.
51. **Webhook de WhatsApp.** En Ajustes → WhatsApp se configura el token de verificación y,
    opcionalmente, el App Secret de Meta. `GET /api/whatsapp/webhook` valida la suscripción y
    `POST /api/whatsapp/webhook` recibe mensajes y estados, verifica la firma HMAC cuando hay
    App Secret y vincula el mensaje con la paciente por teléfono.
52. **Firmas por plantilla.** Cada plantilla define si usa **solo paciente**, **solo
    profesional** o **ambas** (`templates.firma_modo`). En Plantillas se puede cambiar desde el
    selector de cada fila o desde el formulario de edición. Al crear un documento se copia el
    modo de su plantilla a `documents.firma_modo`; los documentos anteriores conservan el suyo.
    La configuración de firmas vive únicamente en Documentos → Plantillas; los documentos en
    blanco usan **ambas** por defecto. En el visor y en la vista previa solo se dibujan las celdas
    activas. Con **solo profesional** el documento se emite directamente como `firmado`, no se
    crean enlaces de firma de paciente y la pantalla de firma los rechaza.
53. **Certificado médico.** El seed crea la plantilla **Certificado médico** (tipo
    `certificado`, firma **solo profesional**) con la fecha y hora de emisión (`{{fecha}}`,
    `{{hora}}`, `{{fecha_hora}}`), los datos del profesional y un recuadro que indica que el
    documento solo es válido con el sello de recepción de la institución.
54. **Ver historia desde el CRM.** El botón “Ver historia” del chat abre
    `/historia.html?patientId=…` en una pestaña nueva (`target="_blank"`), para no perder la
    conversación ni el estado del CRM.
55. **Navegación parcial.** Los enlaces del menú principal y el logo se interceptan en
    `public/js/navegacion.js`: se descarga la página destino, se conserva la cabecera y se
    reemplaza solo el contenido, actualizando título, URL e historial. Antes de cambiar se
    ejecutan las limpiezas registradas con `alSalir` (intervalos, sockets y listeners globales).
    Si algo falla, se recurre a una navegación normal.
56. **Centro médico.** En Ajustes → Centro médico se configuran `centro_nombre` y
    `centro_direccion`, además del logo. El nombre reemplaza a `{{institucion}}` en las
    plantillas y está disponible como `{{centro.nombre}}`; la dirección como
    `{{centro.direccion}}`. Si no hay logo, el nombre y la dirección forman el encabezado del
    documento; si hay logo, la dirección se muestra como línea discreta.
57. **Agenda como inicio.** Después de iniciar sesión y al pulsar el logo se abre
    `/agenda.html`. El logo de todas las páginas apunta a la agenda.
58. **Carpetas de Historias.** El listado de historias usa tarjetas verticales con pestaña
    superior, acento institucional y estadísticas de consultas, exámenes pendientes y citas.
59. **Citas simultáneas.** En la vista de lista de la agenda, las citas con intervalos
    solapados se agrupan en una misma fila y se muestran en columnas paralelas; si no caben,
    la fila permite desplazamiento horizontal.
60. **Codificación de los respaldos SQL.** El cargador de `old_db.sql` decodifica UTF-8 y, si
    encuentra bytes sueltos de Windows-1252/Latin-1, los convierte sin perder tildes ni ñ. Así
    se evitan los caracteres `�` en nombres, notas y recetas migradas.
61. **Exámenes con archivos en un paso.** En la consulta, la sección **Exámenes** permite crear
    un examen con nombre, descripción y hasta varios archivos (PDF, JPG, PNG, WebP) sin pasar
    antes por una solicitud separada. El examen se puede editar, eliminar, visualizar y
    descargar. Los archivos se pueden seguir añadiendo después desde el mismo examen.
62. **Límite y almacenamiento escalable.** Cada paciente puede tener como máximo 10 documentos
    en total, contados en `clinical_attachments.patient_id`; el servidor rechaza el archivo 11
    y también lo valida la interfaz. Los archivos nuevos se guardan en
    `data/historias/<2 primeros caracteres del paciente>/<patient_id>/<exam_id>/<archivo>.<ext>`,
    con índices por paciente y examen para consultas rápidas aunque haya miles de documentos.
63. **Cargador global.** Las operaciones lentas (subida de exámenes, guardado con archivos)
    muestran un overlay con un logo médico animado y el progreso del archivo.
64. **Una sesión por usuario.** Al iniciar sesión se eliminan las sesiones anteriores del mismo
    usuario. Si otra persona entra con el mismo usuario desde otro dispositivo, la sesión anterior
    recibe 401 y vuelve al acceso.
65. **Menú móvil.** En pantallas pequeñas el menú principal se oculta y se abre con un botón
    hamburguesa; se cierra al elegir una opción, al hacer clic fuera o con Escape.
66. **Sesión única en tiempo real.** Al iniciar sesión se cierran las sesiones anteriores del
    mismo usuario mediante Server-Sent Events (`/api/auth/session-events`). La pestaña o equipo
    anterior recibe `sesion-cerrada` inmediatamente y vuelve al login. Como respaldo, cada página
    consulta `/api/auth/me` cada 8 segundos y al recuperar el foco.
67. **Reportes de usuarios.** La página `/reportes.html` (permiso `reportes.ver`, solo admin)
    muestra por fecha la actividad de cada usuario a partir de `audit_log`: eventos, inicios y
    cierres de sesión, sesión activa, última actividad y detalle cronológico. Permite buscar,
    exportar CSV y cerrar las sesiones activas de un usuario. Las consultas usan los índices
    `idx_audit_user_fecha`, `idx_audit_fecha` e `idx_audit_accion`.
68. **Vista de pacientes.** Los filtros de nombre, apellido y cédula están en una tarjeta
    formal y se combinan con el orden. La barra de columnas permite elegir entre 3 y 7
    columnas; la selección se guarda en `localStorage` y la grilla se desplaza horizontalmente
    cuando el ancho no alcanza.
69. **Historial de firmas.** El antiguo “Registro” se llama **Historial** y se muestra como
    línea de tiempo agrupada por día. Incluye filtros por rango de fechas, empleado y texto,
    rangos rápidos (hoy, 7 días, mes, todos), exportación CSV y accesos para abrir el documento
    o visualizar la firma.
70. **Documentos por paciente.** Cada tarjeta de Pacientes tiene el botón **Documentos**, que
    abre el historial de documentos de esa paciente con estado, código, versión, número de
    firmas y acceso directo al documento.
71. **Pruebas E2E.** Todas levantan un servidor aislado con una base temporal, puerto aleatorio
    y un cliente HTTP por rol; al terminar detienen el servidor y eliminan la base temporal.
    - `npm run test:e2e`: autenticación, creación de paciente, agendamiento, inicio y
      finalización de consulta, emisión de certificado, consulta de historia clínica y
      verificación de documentos.
    - `npm run test:e2e:doctor`: crea un médico nuevo con su usuario y contraseña, le asigna una cita, y ese
      médico inicia y finaliza la consulta y emite el certificado firmado.
    - `npm run test:e2e:agenda`: registra 5 pacientes, agenda 40 citas en la semana, cancela
      30 y reagenda las 10 restantes con nueva fecha y motivo.
    - `npm run test:e2e:auth`: crea usuarios con usuario y contraseña; valida usuarios
      duplicados (incluidas mayúsculas y espacios), contraseñas repetidas, contraseñas débiles,
      cambio propio, restablecimiento con cierre de sesión, cambio de nombre de usuario y
      carreras concurrentes de unicidad.
    - `npm run test:e2e:roles`: valida el catálogo de permisos de lectura/edición, creación y
      edición de roles, aplicación inmediata de permisos, protección del rol Administrador,
      roles del sistema, roles en uso y escalada de privilegios.
    - `npm run test:e2e:calendar`: crea 100 citas por día durante 5 días y valida la API del
      calendario y el navegador real: 3 citas visibles por celda, botón “+97 más”, altura
      acotada, sin desbordamiento y acceso al día completo en la vista de lista.
    - `npm run test:e2e:readonly`: crea roles de solo lectura (uno con todos los módulos y otro
      solo con agenda), verifica lecturas permitidas, bloqueos 403 y lanza 140 intentos de
      escritura concurrentes. Comprueba que la estructura de roles, permisos y datos no cambió.
    - `npm run test:e2e:migration`: construye un subconjunto representativo de `old_db.sql`,
      migra, repite la migración, borra la base conservando los usuarios y vuelve a migrar.
      Compara pacientes, citas, consultas, exámenes, calendario y texto contra el origen.
    - `npm run test:e2e:concurrency`: seis escenarios de saturación con los usuarios A–H
      escribiendo a la vez: 100 pacientes concurrentes, 120 citas con disputa del mismo
      horario, 60 certificados de dos médicos, edición simultánea de las mismas historias,
      tormenta mixta de 270 operaciones y carreras de cédula/cancelación/reagenda. Comprueba
      unicidad de IDs y códigos, ausencia de códigos duplicados, consistencia de campos y
      que el servidor siga saludable. Imprime una tabla con ops, aciertos, p50, p95 y op/s.
    - `npm run test:e2e:all`: ejecuta las siete pruebas funcionales en secuencia.
    - `npm run test:e2e:completo`: ejecuta las pruebas funcionales, de roles, calendario,
      solo lectura, migración, concurrencia y estrés.
    - `npm run test:e2e:stress`: prueba de estrés máximo en tres fases. Por defecto usa
      20 usuarios y 20 s, configurable con `STRESS_USERS` y `STRESS_SECONDS`.
      1. **Carga sostenida:** N usuarios conectados ejecutan lecturas y escrituras reales
         sin pausa; mide ops/s, p50/p95/p99, errores y datos generados.
      2. **Sincronización local:** verifica que un paciente, una cita, una historia y un
         certificado recién creados se vean en 12 clientes simultáneos; comprueba que todos
         lean el mismo total y que el cierre de sesión por SSE (`otra_sesion`) invalide la
         sesión anterior.
      3. **Validación de información:** 42 casos de datos inválidos, malformados o
         peligrosos (campos faltantes, fechas y estados inválidos, cédulas duplicadas,
         permisos, JSON roto, límite de tamaño, inyección SQL, rutas fuera del directorio
         público, tildes/eñes y recorte de campos) se ejecutan en paralelo y deben ser
         rechazados con 4xx sin errores 500 ni cambios inesperados en la base.
72. **Versión visible y actualizaciones.** La versión sale de `package.json` y se muestra
    siempre en la cabecera (`v1.3.0`) y en la pantalla de acceso. `GET /api/version` es
    público y devuelve `version`, `buildId` y `actualizacionesAutomaticas`. Cada pantalla
    consulta ese endpoint cada 60 s; si cambia la versión o el build aparece un aviso
    **Actualizar ahora**. En Ajustes → Actualizaciones se decide si la recarga es automática
    (solo cuando no hay diálogo abierto ni un campo en edición) o manual. Esta preferencia no
    instala código en el servidor: el despliegue lo hace la plataforma.
73. **Despliegue.** `DATA_DIR` mueve base, firmas, fotos, logo e historias a un disco
    persistente. `BUILD_ID` (o `RENDER_GIT_COMMIT`, `RAILWAY_GIT_COMMIT_SHA`,
    `SOURCE_VERSION`) identifica cada despliegue. `PUBLIC_URL` fija los enlaces y el QR; si no
    se define, se autodetecta en Render, Railway y Fly.io. El sistema requiere una sola
    instancia por SQLite y SSE. La guía completa está en `DEPLOY.md`; el proyecto incluye
    `Dockerfile` y `render.yaml`.

---

## 4. API REST

Todas las respuestas son JSON. Los errores usan `{ "error": "mensaje" }` con el código HTTP
correspondiente. `sesión` = cookie `sgcpm_sid`; `token` = token del enlace de firma.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/health` | — | Estado del servidor, versión y build. |
| GET | `/api/version` | — | Versión, build y si las actualizaciones son automáticas. |
| POST | `/api/auth/login` | — | `{ username, password }` → cookie de sesión. |
| GET | `/api/auth/me` | sesión | Usuario actual y lista de `permisos`. |
| POST | `/api/auth/logout` | sesión | Cierra la sesión. |
| GET | `/api/users` | admin | Listar usuarios con su número de firmas gestionadas. |
| POST | `/api/users` | admin | Crear usuario con `username` y contraseña inicial. |
| PATCH | `/api/users/:id` | admin | Editar nombre, cédula, usuario, rol o estado. |
| POST | `/api/users/:id/password` | admin | Restablecer la contraseña de un usuario. |
| POST | `/api/users/me/firma` | firma.medico | Registrar la firma precargada del médico. |
| DELETE | `/api/users/me/firma` | firma.medico | Quitar la firma del médico. |
| GET | `/api/users/:id/firma` | sesión | PNG de la firma del médico. |
| GET | `/api/medicos` | documentos.ver | Médicos activos para asignar a un documento. |
| PATCH | `/api/users/me` | sesión | Editar el propio nombre y cédula. |
| POST | `/api/users/me/password` | sesión | Cambiar la contraseña propia validando la anterior. |
| GET | `/api/roles/nombres` | sesión | Nombres de roles para las etiquetas de la interfaz. |
| GET | `/api/roles` | configuración.ver o usuarios.gestionar | Roles, permisos y catálogo de lectura/edición. |
| POST | `/api/roles` | configuración.gestionar | Crear un rol personalizado. |
| PATCH | `/api/roles/:slug` | configuración.gestionar | Editar nombre, descripción o permisos. |
| DELETE | `/api/roles/:slug` | configuración.gestionar | Eliminar un rol sin usuarios asignados. |
| GET | `/api/patients?q=` | sesión | Buscar pacientes activos. |
| POST | `/api/patients` | sesión | Crear paciente. |
| GET | `/api/patients/:id` | sesión | Detalle. |
| PATCH | `/api/patients/:id` | sesión | Editar datos. |
| DELETE | `/api/patients/:id` | sesión | Baja lógica. |
| GET | `/api/patients/:id/documents` | sesión | Documentos del paciente. |
| GET | `/api/templates` | sesión | Plantillas activas. |
| GET | `/api/documents?q=&estado=&patientId=` | sesión | Listado con paciente, versión y firmas. |
| POST | `/api/documents` | sesión | `{ patientId, titulo, templateId?, contenidoHtml? }`. |
| GET | `/api/documents/:id` | sesión | Documento + versiones + firmas. |
| POST | `/api/documents/:id/versions` | sesión | Guarda contenido; crea versión si la actual está firmada. |
| POST | `/api/documents/:id/sign-session` | sesión | Crea enlace de firma y devuelve `{ token, url, expiraEn }`. |
| POST | `/api/documents/:id/annul` | sesión | Anula el documento (no toca versiones firmadas). |
| GET | `/api/documents/:id/medico-firma` | sesión | Firma del profesional precargada en el documento. |
| GET | `/api/settings` | configuracion.ver | Logo, versión y datos del sistema. |
| GET | `/api/settings/logo` | — | PNG del encabezado institucional. |
| POST | `/api/settings/logo` | configuracion.gestionar | Subir o reemplazar el logo (PNG). |
| DELETE | `/api/settings/logo` | configuracion.gestionar | Quitar el logo del encabezado. |
| GET | `/api/sign-sessions/:token` | token | Datos públicos para la pantalla de firma. |
| POST | `/api/sign-sessions/:token/cancel` | token | Cancela la firma pendiente. |
| GET | `/api/signatures?desde=&hasta=&userId=&documentId=&q=` | sesión | Registro de firmas con empleado, paciente, fecha y hora. |
| GET | `/api/signatures/employees` | sesión | Empleados que tienen firmas registradas. |
| GET | `/api/signatures/:id/image` | sesión | PNG de la firma. |

---

## 5. Protocolo WebSocket

Endpoint: `ws://<host>/ws/firma?t=<token>&role=signer|controller`

- `signer`: pantalla externa que captura la firma.
- `controller`: ventana principal que espera el resultado.

### Mensajes

| Dirección | Tipo | Contenido |
|---|---|---|
| servidor → cliente | `ready` | `{ role, sessionId, expiraEn }` |
| servidor → controller | `signer-connected` | La pantalla de firma se conectó. |
| servidor → controller | `signer-disconnected` | Se cerró la pantalla de firma. |
| signer → servidor | `submit` | `{ image: "data:image/png;base64,..." }` |
| servidor → todos | `signed` | `{ signatureId, documentId, version, firmadoEn }` |
| servidor → todos | `cancelled` | Firma cancelada. |
| servidor → cliente | `error` | `{ message }` |
| cualquiera → servidor | `ping` / `pong` | Mantener viva la conexión. |

Validaciones del servidor al recibir `submit`:

- La sesión sigue `abierta` y no expiró (se revalida contra SQLite).
- La imagen es PNG real (firma binaria), entre 400 bytes y 4 MB.
- La versión no fue firmada y el documento no está anulado.
- Se guarda el PNG en `data/firmas/`, se calcula su SHA-256 y se registra todo en una
  transacción: firma + estado de versión + estado del documento + auditoría.
- El token queda `completada`, por lo que un segundo envío se rechaza.

---

## 6. Trazabilidad de la firma

El acceso es con **usuario y contraseña**; el usuario identifica al empleado y cada firma
queda vinculada a él.

- Al pulsar **Firmar**, `sign_sessions.creada_por` guarda el usuario de la sesión.
- Al confirmarse la firma se copian a `signatures`: `gestionado_por` (id),
  `gestionado_nombre`, `gestionado_rol`, `documento_titulo`, `patient_snapshot`
  y `firmado_en` (UTC, con milisegundos).
- La pantalla **Registro** muestra el día de la semana, la fecha, la hora, la paciente,
  el documento, la versión y el empleado que gestionó la firma.
- Se puede filtrar por rango de fechas, empleado, documento o texto, y exportar a CSV.
- Los filtros de fecha se interpretan en la zona horaria local y se convierten a instantes
  UTC: una firma de las 20:00 no aparece en el día siguiente.
- Cambiar después el nombre del empleado, de la paciente o el título del documento no
  modifica el registro: se conserva el snapshot del momento de la firma.

### Encabezado y firma del médico

- **Ajustes → Encabezado** permite subir o quitar un PNG que se muestra arriba de todos los
  documentos y de la pantalla de firma. Solo el rol admin puede cambiarlo.
- **Ajustes → Información** muestra la versión, “desarrollado por dyyys0ft con <3” y
  “OpenCode DeepSeek V4.1 Flash”.
- En **Mi cuenta**, los usuarios con rol médico dibujan o suben su firma.
- Al crear un documento, esa firma se copia a una instantánea del documento y se muestra
  sobre la línea “Firma del profesional”.
- La pantalla externa de firma recibe el logo y la firma del médico, incluso si se abre en
  otro dispositivo sin sesión.

---

## 7. Flujo de firma en monitor externo

1. El operador abre el documento y pulsa **Firmar Vn**.
2. La ventana principal abre un popup **antes** de la petición (para que el navegador no lo
   bloquee) y solicita `POST /api/documents/:id/sign-session`.
3. El servidor crea el token de 10 minutos y marca la versión como `pendiente_firma`.
4. El popup navega a `/firma.html?t=<token>`.
   - Si el navegador soporta *Window Management API*, se intenta mover a la segunda pantalla.
   - Si no, la ventana puede arrastrarse manualmente al monitor externo.
   - Si el popup fue bloqueado, se muestra un diálogo con el enlace para abrirlo a mano.
5. La pantalla de firma muestra el documento completo, la vigencia del enlace y el recuadro
   de firma; se conecta al WebSocket como `signer`.
6. La ventana principal se conecta como `controller` y queda a la espera.
7. El paciente firma, acepta la declaración y pulsa **Firmar documento**.
8. El servidor valida, guarda la firma y emite `signed` a ambas ventanas.
9. La ventana principal recarga el documento y muestra la firma al pie de la versión firmada;
   la pantalla externa muestra la confirmación.

También se puede firmar desde una tablet o teléfono en la misma red local
(`HOST=0.0.0.0`); el enlace se copia o se abre en el dispositivo.

---

## 8. Diseño responsive

Enfoque **mobile-first**, sin frameworks.

### Puntos de quiebre

| Ancho | Cambios |
|---|---|
| < 620 px | Navegación compacta; nombre de usuario oculto; todo en una columna. |
| ≥ 620 px | Se muestra el nombre del usuario en la cabecera. |
| ≥ 760 px | Navegación principal visible. |
| ≥ 980 px | Pantalla de firma en dos columnas (documento / pad). |
| ≥ 1000 px | Documento + panel lateral de versiones con `sticky`. |

### Patrones

- Contenedor máximo 1180 px con padding fluido (`clamp`).
- Tipografía y espacios fluidos; objetivos táctiles de al menos 44 px.
- Navegación horizontal desplazable en móvil; en escritorio se muestra completa.
- Listados como tarjetas con `grid auto-fill`; tablas que se convierten en fichas por debajo
  de 900 px usando `data-label`.
- El listado de documentos usa **items de una sola columna** (no cuadrícula), incluidos los
  anulados, ordenados del más reciente al más antiguo.
- Diálogos nativos `<dialog>` con ancho `min(…, 100vw − 32px)`.
- `prefers-reduced-motion` desactiva animaciones.
- Foco visible para navegación por teclado.

### Firma en canvas

- El canvas ocupa el 100 % del recuadro y usa `devicePixelRatio` (máx. 2.5) para trazos nítidos.
- `touch-action: none` evita el scroll mientras se firma.
- Los puntos se guardan normalizados (0..1), así la firma sobrevive a rotaciones y cambios
  de tamaño.
- Se exporta un PNG recortado al área dibujada (fondo transparente) para no guardar espacio vacío.
- Botones **Deshacer** y **Limpiar**; el botón de firmar se habilita solo con trazo y
  declaración aceptada.

### Impresión

`@media print` oculta cabecera, acciones y panel de versiones, y deja únicamente la hoja del
documento con la firma al pie. Desde el navegador se puede guardar como PDF.

---

## 9. Roles y permisos

El acceso es con **usuario y contraseña**. Los permisos se validan en el servidor y la interfaz
oculta las acciones que el rol no puede realizar. No se muestra la lista de usuarios.

| Permiso | admin | medico | operador | enfermero | lectura |
|---|:--:|:--:|:--:|:--:|:--:|
| `usuarios.gestionar` | ✓ | | | ✓ | |
| `pacientes.ver` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `pacientes.crear` / `editar` / `desactivar` | ✓ | | ✓ | ✓ | |
| `documentos.ver` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `documentos.crear` / `editar` | ✓ | ✓ | ✓ | ✓ | |
| `documentos.firmar` | ✓ | ✓ | ✓ | | |
| `documentos.anular` | ✓ | | | ✓ | |
| `registro.ver` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `configuracion.ver` | ✓ | | ✓ | ✓ | ✓ |
| `configuracion.gestionar` (logo) | ✓ | | | | |
| `firma.medico` (firma precargada) | ✓ | ✓ | | | |
| `dashboard.ver` | ✓ | | | | |
| `plantillas.gestionar` | ✓ | | | | |

- Las rutas de escritura responden **403** cuando el rol no tiene el permiso.
- `GET /api/auth/me` devuelve la lista `permisos`; la cabecera y los botones se adaptan.
- **lectura** solo consulta documentos, pacientes y registro: no crea, no edita, no firma y
  no administra usuarios.
- **medico** crea/edita/firma documentos, registra su firma precargada, pero no añade
  pacientes, no gestiona usuarios y no accede a los ajustes del sistema.
- **operador (Secretario/a)** registra pacientes, crea documentos, gestiona la firma y
  actualiza el estado de las citas desde la agenda.
- **enfermero** puede hacer todo excepto firmar, registrar firma médica, cambiar el logo,
  acceder al dashboard y administrar plantillas.
- **admin** concentra todos los permisos, incluidos Dashboard, Plantillas y Ajustes.

---

## 10. Seguridad y operación local

- El servidor escucha en `127.0.0.1` por defecto (solo este equipo).
- Contraseña con `scrypt` + sal; nunca se devuelve el hash por la API.
- Usuario único sin distinguir mayúsculas; las contraseñas sí pueden repetirse.
- Sesión en cookie `HttpOnly`, `SameSite=Lax`, 8 horas.
- Los enlaces de firma no dependen de la sesión: el token es la credencial y caduca.
- Rutas estáticas protegidas contra *path traversal*.
- Todo cambio sensible se registra en `audit_log` (incluye intentos fallidos de login).
- SQLite en modo WAL y `foreign_keys = ON`.

### Limitaciones conocidas (MVP)

- No hay límite de intentos de inicio de sesión (solo auditoría). Añadir bloqueo temporal es sencillo.
- Sin token CSRF explícito; se mitiga con `SameSite=Lax` y contenido JSON, en un entorno local.
- Sin HTTPS; si se expone en red local, conviene un proxy TLS o aceptar el riesgo controlado.
- El contenido HTML del documento lo edita personal autenticado; no se sanea por diseño
  (es el cuerpo del consentimiento).

---

## 11. Puesta en marcha

Requisitos: **Node.js 24 LTS** (mínimo 23) y npm.

```powershell
# 1. Instalar la única dependencia (ws)
npm install

# 2. Arrancar
npm start
```

Abrir <http://127.0.0.1:3000>.

La primera vez se crean automáticamente:

| Usuario | Rol | Usuario de acceso | Contraseña inicial | Permisos |
|---|---|---|---|---|
| **ADMIN** | admin | **admin** | **54321** | Todos |
| Administrador del sistema | admin | administrador | 1234 | Todos |
| Dra. Verónica Salazar | medico | veronica | 1235 | Crear/editar/firmar documentos y consultar |
| Recepción — Ana Torres | operador | recepcion | 1236 | Pacientes, documentos, firma y registro |
| **Lector Uno — Solo lectura** | lectura | **lector1** | **1111** | Solo consulta |
| **Lector Dos — Solo lectura** | lectura | **lector2** | **2222** | Solo consulta |
| Paciente demo: María Fernanda Guamán Paredes | — | — | — | — |
| Documento demo | — | — | — | — |

El rol **enfermero** está disponible al crear o editar usuarios: puede hacer todo excepto
firmar, registrar firma médica y cambiar el logo. El logo del encabezado y la firma del
médico se configuran desde **Ajustes** y **Mi cuenta** respectivamente.

**Cambiar las contraseñas antes de usar en producción:** mínimo 8 caracteres, con al menos
una letra y un número. Los usuarios son únicos sin distinguir mayúsculas; las contraseñas
pueden repetirse entre usuarios. Las cuentas creadas antes de la migración conservan su PIN
anterior como contraseña inicial y reciben un usuario generado a partir del nombre
(por ejemplo, `admin`, `dra.veronica.salazar`, `recepcion.ana.torres`).

```powershell
npm run password -- "admin" "NuevaClave123"
npm run password -- "administrador.del.sistema" "OtraClave456"
npm run password -- "dra.veronica.salazar" "Veronica789"
npm run password -- "recepcion.ana.torres" "Recepcion321"
npm run password -- "lector.uno.solo.lectura" "Lector654"
npm run password -- "lector.dos.solo.lectura" "Lector987"
```

Variables de entorno (no se carga `.env` automáticamente):

```powershell
$env:PORT="3000"
$env:HOST="0.0.0.0"   # solo si se firmará desde tablet/celular en la red local
npm start
```

### Datos y respaldo

- Base: `data/sgcpm.db` (junto con `-wal` y `-shm`).
- Firmas de pacientes: `data/firmas/*.png`.
- Firmas de médicos: `data/firmas-medicos/*.png`.
- Logo del encabezado: `data/sistema/logo.png`.
- Para respaldar, detén el servidor y copia la carpeta `data/` completa.

### ⚠️ OneDrive

Esta carpeta está dentro de OneDrive. Para un sistema en producción **se recomienda mover el
proyecto fuera de OneDrive** (por ejemplo `C:\SGCPM-ISIM`):

- OneDrive puede bloquear la instalación de `node_modules`.
- La sincronización en caliente de SQLite (WAL) puede provocar bloqueos o archivos en conflicto.
- Las firmas son datos sensibles; conviene controlar su respaldo y acceso.

---

## 12. Estado actual y siguientes pasos

### Implementado y probado

- Login con usuario y contraseña, sesión única y cierre.
- Roles y permisos aplicados en API y UI: admin, médico, operador, enfermero y solo lectura.
- Cuenta **ADMIN (usuario `admin` / contraseña 54321)** con todos los permisos y dos usuarios de solo lectura.
- Pantalla de pacientes: listado, búsqueda, alta, edición, baja lógica y acceso a sus documentos.
- Administración de usuarios: alta, edición, roles, activación y restablecimiento de contraseña.
- **Ajustes → Tipos de acceso:** crear roles y editar los existentes con permisos de
  lectura y edición agrupados por módulo. Los roles del sistema no se eliminan y el rol
  Administrador conserva los permisos mínimos para evitar bloqueos.
- “Mi cuenta”: cada empleado edita sus datos, cambia su contraseña y el médico registra su firma
  dibujándola o subiendo un PNG.
- Ajustes del sistema: logo PNG del encabezado (solo ADMIN) e información de versión.
- Logo institucional visible arriba de cada documento y de la pantalla de firma.
- Firma del médico precargada en los documentos que crea, con copia inmutable por documento.
- Selector de **médico responsable** al crear el documento; el operador o enfermero puede
  asignar al médico cuya firma se precargará.
- Creación de documentos desde plantilla con sustitución de datos.
- Versionado V1, V2… con inmutabilidad de versiones firmadas (trigger + API).
- Listado de documentos en formato de items (no cuadrícula), incluidos los anulados y ordenado
  del más reciente al más antiguo.
- Enlace de firma de un solo uso, WebSocket en tiempo real y captura responsive.
- Firma guardada como PNG + hash + snapshots de la paciente y del empleado.
- Registro de firmas con empleado, día, fecha, hora, paciente, documento y versión;
  filtros por fecha/empleado/documento/texto y exportación CSV.
- Confirmación en ambas ventanas, recarga del documento y auditoría.
- Impresión / guardado como PDF.
- Pruebas E2E funcionales, de concurrencia, de estrés y de autenticación con usuario/contraseña.

### Pendiente sugerido

1. **Plantillas**: editor de plantillas y variables disponibles.
2. **Respaldo automático** de `data/` y restauración guiada.
3. **Bloqueo temporal** tras varios inicios de sesión incorrectos.
4. **Pruebas automatizadas** dentro del repositorio (`tests/`) y ejecución en CI local.
5. **Exportación PDF** generada en servidor, si se requiere un archivo inmutable además del PNG.
6. **Auditoría de accesos** en la interfaz (login/logout y sesiones), además de `audit_log`.

---

## 13. Actualización 1.2.0 y 1.2.1

> Notas históricas. La autenticación con PIN descrita aquí fue reemplazada por
> usuario y contraseña en la versión 1.3.0 (ver sección 14).

- Institución: **ISIM-Instituto de la Salud Integral de la Mujer** en toda la aplicación.
- Consentimiento con cédula explícita (“Yo, …, con Cédula de Identidad …”) y fecha arriba en
  estilo carta.
- Bloque de firmas rediseñado: firma del paciente y del médico **sobre** la línea, con nombre,
  cédula y, para médicos, **código SENECYT** (opcional) debajo.
- Pie del documento firmado: **“Firmado Digitalmente”** con fecha/hora y empleado que registró.
- Impresión optimizada para **A4**, centrada, con saltos de página controlados y bloque de
  firmas que no se parte.
- Nueva pestaña **Plantillas** (solo ADMIN) con CRUD de documentos por defecto.
- Nueva pestaña **Dashboard** (solo ADMIN): firmas hoy/semana/mes, pacientes hoy/mes y últimas
  firmas.
- Paleta institucional: azul `#003f93` primario y verde `#008d31` secundario.
- Los médicos ya no acceden a **Ajustes**.
- Logo del sistema configurable en Ajustes (solo ADMIN) y usado también en la cabecera.
- Fotos de perfil: cada usuario sube la suya; ADMIN puede cambiarlas desde Usuarios.
- Al cerrar sesión se muestra directamente el **PIN del último usuario**, con el tiempo desde su
  último acceso.
- Tras firmar, se pregunta si desea imprimir una copia y se muestra el aviso de recepción y
  sello.
- Documentos anulados siguen listados en formato de items, del más reciente al más antiguo.
- Nuevas tablas/columnas: `users.senecit`, `users.foto_*`, `users.ultimo_acceso_en`;
  `documents.medico_id`; `settings` para el logo.
- Nuevos archivos: `server/modules/templates.js`, `server/modules/dashboard.js`,
  `server/lib/branding.js`, `public/dashboard.html`, `public/plantillas.html` y sus scripts.

### Correcciones 1.2.1

- Acceso **solo con PIN**: no se listan usuarios ni se pide cédula. El PIN debe ser numérico,
  de 4 a 12 dígitos y **único**; los PIN duplicados se rechazan.
- En la pantalla de PIN se muestra el logo del sistema en la cabecera y, a un costado, el
  último usuario con el tiempo desde su último acceso.
- **SENECYT y especialidad** solo se muestran y guardan para médicos. La especialidad admite
  hasta 100 palabras.
- El bloque de firma muestra, debajo del nombre del médico: especialidad, cédula y
  `SENECYT` (con “—” si aún no está registrado).
- Plantilla de consentimiento actualizada con cédula explícita, institución ISIM, fecha arriba,
  cédula/especialidad/SENECYT del médico y “Firmado Digitalmente”.
- Impresión A4 verificada: una página cuando el contenido lo permite, bloque de firmas sin
  cortes y sin bordes/sombras de pantalla.

---

## 14. Actualización 1.3.0 — autenticación con usuario y contraseña

- Se reemplazó el PIN único por **usuario + contraseña**. El usuario se guarda en minúsculas y
  es único sin distinguir mayúsculas; las contraseñas pueden repetirse entre usuarios.
- La contraseña usa `scrypt` con sal y exige entre 8 y 128 caracteres, con al menos una letra
  y un número. Nunca se devuelve el hash por la API.
- La API de login ahora recibe `{ username, password }`; los endpoints de PIN se reemplazaron
  por `/api/users/me/password` y `/api/users/:id/password`.
- Al restablecer una contraseña desde Usuarios se cierran las sesiones abiertas de ese usuario
  y se notifica por SSE (`password_restablecida`).
- Migración automática: a cada usuario existente se le genera un `username` a partir de su
  nombre y su **PIN anterior pasa a ser la contraseña inicial**. La migración es idempotente y
  se ejecuta al arrancar.
- La pantalla de acceso ahora tiene campos de usuario y contraseña, con opción de mostrar la
  contraseña. Se mantiene el aviso del último acceso.
- Usuarios y Mi cuenta tienen formularios para crear, cambiar y restablecer contraseñas.
- El script de consola es `npm run password -- <usuario|cédula|nombre> <nueva contraseña>`.
- E2E nuevo: `npm run test:e2e:auth`. Cubre usuarios duplicados (exacto, mayúsculas y espacios),
  contraseñas repetidas, validaciones, cambio propio, restablecimiento con cierre de sesión,
  cambio de usuario y carreras concurrentes de unicidad.

---

## 15. Tipos de acceso: roles y permisos dinámicos

- **Ajustes → Tipos de acceso** permite crear roles y editar los existentes.
- Cada rol tiene `slug` (código fijo), nombre, descripción y un conjunto de permisos.
- Los permisos se muestran agrupados por módulo en dos columnas: **Lectura** y **Edición**.
- Los roles iniciales son Administrador, Médico, Secretario/a, Enfermero y Solo lectura.
  Se pueden editar, pero no eliminar (`protegido = 1`).
- Un rol personalizado se puede eliminar solo si no tiene usuarios asignados.
- El rol **Administrador** debe conservar `usuarios.gestionar` y `configuracion.gestionar`
  para evitar que el sistema quede sin administración.
- Los permisos se resuelven contra `role_permissions`; un cambio se aplica en la siguiente
  petición del usuario, sin necesidad de cerrar sesión.
- La caché de permisos por rol se invalida al crear, editar o eliminar un rol.
- El selector de rol al crear/editar usuarios se carga desde `/api/roles`.
- Prueba: `npm run test:e2e:roles`.

---

## 16. Calendario masivo y permisos de solo lectura

### Calendario

- `GET /api/appointments/calendar` devuelve los totales por día y una vista previa limitada
  (`porDia`, por defecto 3).
- La agenda solicita el resumen del mes con el desfase horario del navegador (`tzOffset`) para
  agrupar las citas por el día local correcto.
- La celda muestra hasta 3 citas y un botón **+N más**. El día completo se abre en la vista de
  lista, que conserva los filtros.
- Prueba: `npm run test:e2e:calendar` crea 500 citas (100 × 5 días), valida la API y la
  cuadrícula en Chrome/Edge: 3 elementos por celda, “+97 más”, altura acotada y sin scroll
  horizontal.

### Permisos de solo lectura

- Un rol con solo permisos `*.ver` puede consultar los módulos permitidos, pero cualquier
  intento de escritura responde **403**.
- Un rol con solo `agenda.ver` puede ver citas y su calendario, pero no pacientes, historias,
  documentos, configuración ni plantillas.
- La prueba `npm run test:e2e:readonly` lanza **140 intentos de escritura concurrentes**
  (crear/editar/cancelar citas, pacientes, historias, documentos, usuarios, roles y ajustes).
- Después de la fuerza bruta verifica que la estructura de roles, los permisos del usuario,
  las citas, las historias y los pacientes siguen exactamente igual.
- Los roles de solo lectura no pueden escalar privilegios: crear roles, editar roles o
  cambiarse el rol responden 403.

---

## 17. Prueba E2E de migración

- `npm run test:e2e:migration` lee `old_db.sql` y construye un subconjunto representativo:
  pacientes con cédula válida, sin cédula, cédulas duplicadas, fechas inválidas o recuperadas,
  nombres con tildes/ñ, citas con y sin consulta, canceladas, exámenes, recetas y catálogos.
- `MIGRATION_FULL=1 npm run test:e2e:migration` procesa el **volumen completo** de
  `old_db.sql` (20.236 pacientes, 37.134 citas, 91.644 consultas y 19.200 exámenes) y compara
  cada registro.
- **Ciclo 1:** analiza y migra el lote.
- **Ciclo 2:** repite la misma migración y exige cero duplicados y mapas de migración estables.
- **Ciclo 3:** detiene el servidor, borra la base completa, la recrea, restaura los usuarios
  originales (mismas credenciales y roles) y migra otra vez.
- **Usuarios:** se extraen de la tabla `sistema` y de los campos `usuario` de
  `datos`, `datosgen`, `citamedica`, `cons`, `examenes` y `receta`. Se normalizan sin distinguir
  mayúsculas (`adminis`, `ADMINIS` y `Adminis` son el mismo usuario), se les asigna rol
  (`adminis/admin` → admin, `doctor2` → médico, `rec/adminin` → operador) y una contraseña
  aleatoria de 16 caracteres. Las claves antiguas (`12345`, `doctor2`) **no se reutilizan**.
  Las credenciales se guardan en `data/backups/credenciales-migracion-*.csv`.
- Compara contra el origen:
  - Pacientes: nombres, apellidos, cédula, fecha de nacimiento, sexo, teléfono, email,
    dirección, ocupación, estado civil, ciudad, notas, marca de datos incompletos y texto.
  - Citas: paciente enlazado, fecha/hora, duración, motivo, estado, notas y texto.
  - Consultas: paciente, fecha, motivo y texto.
  - Exámenes: nombre, tipo, estado, observaciones y referencias de archivo.
  - Agenda/calendario: el total y los totales por día de `/api/appointments/calendar`
    coinciden con la base migrada (en modo completo se valida mes por mes).
  - Texto general: se busca mojibake (`Ã`, `Â`, `â€`, `�`) en nombres, motivos, notas,
    diagnósticos, recetas y exámenes.
- El reporte final muestra pacientes/citas/consultas/exámenes de origen y destino, citas
  sintéticas creadas desde consultas, registros creados para exámenes, usuarios migrados,
  pacientes sin cédula, cédulas duplicadas, fechas inválidas, citas sin consulta, advertencias
  y posibles mejoras.
- Para migrar solo los usuarios a una base existente:
  `npm run migrate:users`. Crea los usuarios que falten y genera el CSV de credenciales.
- Para conservar las claves antiguas de la tabla `sistema` durante una migración, el
  `POST /api/migration/old-db/run` acepta `conservarClavesAntiguas: true`. La prueba
  `npm run test:e2e:migration:credentials` migra `old_db.sql` completo con esa opción,
  ingresa como `adminis / 12345`, verifica el rol de administrador, comprueba los pacientes y
  citas antiguos por API y valida en navegador que la paciente antigua aparece en Pacientes.
- `npm run migrate:users:legacy` restaura en una base ya migrada las claves de los usuarios
  `sistema` (`adminis/12345`, `rec/12345`, `doctor2/doctor2`) y genera un CSV con esas
  credenciales. Úsarlo solo cuando se requiera conservar el acceso original; las claves
  antiguas son débiles y deben cambiarse en el primer ingreso.
- Los archivos temporales de análisis y los respaldos creados por cada corrida se eliminan al
  terminar; el CSV de credenciales de producción debe resguardarse y eliminarse tras entregarlo.

### Criterios LOPDP aplicados a la prueba

- **Exactitud:** cada campo demográfico y clínico se compara con la base antigua.
- **Integridad:** no se permiten citas huérfanas ni cambios de paciente; se revisan los
  enlaces `patient_id`.
- **Confidencialidad:** por defecto los usuarios migrados reciben contraseñas aleatorias y no se
  reutilizan claves débiles. Cuando se requiere conservar el acceso original se usa
  `conservarClavesAntiguas: true` de forma explícita, se registra en `audit_log` y las
  credenciales quedan en un archivo restringido a `data/backups`.
- **Trazabilidad:** cada migración y cada usuario migrado quedan en `audit_log` y
  `migration_map`.
- **Minimización:** solo se migran campos con equivalente en el sistema nuevo; los campos
  antiguos sin uso se reportan como posibles mejoras, no se copian a ciegas.
- **Conservación:** los registros incompletos se conservan y se marcan con
  `datos_incompletos` y su detalle, en lugar de descartarlos.

---

## 18. Prueba E2E de exámenes y archivos

- `npm run test:e2e:examenes` crea 60 citas, cada una con una historia clínica y **5 exámenes**.
- Cada examén recibe **2 archivos reales** (PNG y PDF), para un total de **600 adjuntos**.
- Los archivos se envían como data URL y se valida su cabecera real antes de guardarlos.
- La prueba verifica:
  - Rutas `historias/<shard>/<patient_id>/<exam_id>/<id>.<ext>`.
  - Existencia física de los 600 archivos.
  - Bytes y `sha256` guardados en `clinical_attachments`.
  - Descarga por `/api/clinical-attachments/:id/file` con contenido y `content-type` correctos.
  - Una cita orquesta sus 5 exámenes y 10 archivos, todos accesibles desde la historia clínica.
  - El límite de 10 documentos por paciente: el intento 11 responde 409.
  - Rechazo de base64 inválido, MIME no permitido, PNG corrupto y archivo sin examén.
  - Eliminación de un adjunto y borrado físico del archivo.
- Los archivos se escriben en un `DATA_DIR` temporal y se eliminan al terminar; la base de
  prueba también se elimina.

---

## 19. Acceso en intranet: puerto y lista blanca de IPs

Cuando ISIM corre dentro de una red local no conviene dejarlo abierto a cualquier equipo.
La configuración vive en **Ajustes → Red / Acceso** y consta de dos partes.

### 19.1 Puerto de acceso

- El servidor sigue escuchando en `config.port` (3000 por defecto, variable `PORT`) y,
  si hay certificado, en `config.httpsPort` (3443).
- El puerto elegido en la interfaz se guarda en `settings.red_puerto`. Si es distinto de los
  anteriores, `server/lib/puerto-acceso.js` levanta un **proxy TCP** que reenvía los bytes a
  `127.0.0.1:config.port`. El cambio se aplica al instante, sin reiniciar, y funciona también
  para WebSocket porque no interpreta el protocolo.
- Si el puerto ya está ocupado, la API responde `409`, se conserva el proxy anterior y se
  muestra el motivo en la interfaz.
- Al arrancar se recupera el puerto guardado (`iniciarProxy()`).
- La pantalla muestra la **IP local** (`ipLocal()`), el puerto de escucha, el puerto elegido y
  la URL completa (`http://IP:puerto/`), además de la URL local y la HTTPS.
- `GET /api/settings/red/puertos` devuelve puertos habituales con su disponibilidad real.
- En Windows, `ABRIR_PUERTO_RED.bat` lee el puerto guardado con
  `node server/scripts/puerto-acceso.js --port` y crea la regla entrante del firewall.
  `node server/scripts/puerto-acceso.js` muestra el resumen completo.

### 19.2 Lista blanca de IPs

- La tabla `ips_permitidas` guarda IPs exactas o rangos CIDR IPv4/IPv6 y, opcionalmente,
  la MAC del equipo.
- **Si una entrada tiene MAC, la clave es la combinación IP + MAC.** `server/lib/arp.js`
  resuelve la MAC desde las interfaces locales o desde la tabla ARP del sistema. Si la MAC no
  se puede resolver (equipo en otra subred o apagado), el acceso se rechaza. Las entradas sin
  MAC siguen funcionando solo por IP.
- La MAC se puede detectar desde Ajustes → Red / Acceso con **Detectar MAC**, que hace un ping
  previo para poblar la tabla ARP. También se acepta escribirla manualmente con formato
  `AA:BB:CC:DD:EE:FF`. La MAC solo aplica a IPs exactas, no a rangos CIDR.
- Las banderas `red_ip_restriccion` y `red_confiar_proxy` viven en `settings`.
- `server/lib/control-ip.js` mantiene el estado en memoria (se recarga al iniciar y tras cada
  cambio), obtiene la IP del socket y aplica la lista **antes de cualquier ruta**, tanto a API
  como a páginas y descargas. Las peticiones rechazadas reciben `403` y quedan registradas.
- El **loopback (127.0.0.1) siempre tiene acceso** para no perder la administración local.
- Por defecto se ignora `X-Forwarded-For`, porque esa cabecera se puede falsificar. Solo se
  usa cuando el administrador marca explícitamente «Confiar en X-Forwarded-For» y existe un
  proxy real en la intranet.
- El puerto expuesto aplica la lista en el propio proxy TCP, usando la IP real del socket.
  Sin esa comprobación el servidor principal solo vería `127.0.0.1` y la lista sería inútil.
  Cuando se activa `confiarProxy` (proxy externo con `X-Forwarded-For`), la decisión se deja al
  servidor principal. Al cambiar la lista se cierran las conexiones establecidas para que un
  socket keep-alive no conserve una autorización ya retirada.
- El WebSocket de firma (`server/ws/hub.js`) aplica la misma lista en el evento `upgrade`.
- Cambios permitidos: agregar/quitar IPs, activar/desactivar la restricción y alternar la
  confianza en el proxy. Cada cambio queda en `audit_log`.

### 19.3 Prueba E2E

`npm run test:e2e:red` (incluida en `test:e2e:completo`) verifica en un servidor aislado:

- IP, puertos y URL completa devueltos por la API.
- Exposición inmediata de un puerto libre y respuesta por API y por página.
- Rechazo `409` de un puerto ocupado sin tumbar el proxy vigente.
- Bloqueo `403` en API y páginas para una IP no listada; loopback permitido.
- Autorización y retirada inmediata de una IP exacta.
- Rango CIDR `192.168.5.0/24`: autoriza `192.168.5.44` y rechaza `192.168.6.1`.
- Rechazo de IPs y rangos inválidos.
- Cambio de puerto en caliente (el anterior deja de aceptar conexiones).
- Persistencia de toda la configuración tras reiniciar el proceso.
- Bloqueo real en el puerto expuesto: con el servidor en `0.0.0.0`, una conexión originada en la
  IP de red se rechaza, se acepta al agregar esa IP y se vuelve a rechazar al retirarla.

### 19.4 Último acceso y ping

- `ips_permitidas` guarda `ultimo_acceso_en` y `accesos`. Cada petición permitida actualiza esos
  campos como máximo una vez cada 30 segundos por entrada.
- La pantalla muestra el último acceso, el contador y una insignia **En red / Fuera de red**.
- `POST /api/settings/red/ping` ejecuta el comando `ping` del sistema con un solo intento de 1,5 s.
  Solo acepta IPs que ya están en la lista blanca (evita escanear la red arbitrariamente).
- `GET /api/settings/red` incluye `direccionesLocales`, con todas las IPv4 no virtuales del equipo.
- La página de bloqueo (`403`) muestra `public/img/acceso-denegado.svg`; ese recurso se sirve
  incluso a IPs bloqueadas para que la imagen no quede rota.
- `npm run test:e2e:red:ping` registra tres IPs, las pinga, comprueba último acceso/contador,
  retira una IP y valida el filtro de actividad por usuario.
- `npm run test:e2e:red:mac` detecta la MAC del equipo, la guarda con su IP, activa la
  restricción y comprueba que la combinación correcta entra, que una MAC distinta se bloquea y
  que las MAC inválidas o asociadas a rangos CIDR se rechazan.
- Limitación: la MAC solo se puede verificar dentro del mismo segmento de red. Para equipos
  detrás de un router o de un proxy externo se debe dejar la entrada sin MAC (solo IP) o usar
  una IP fija en la misma red.

## 20. Registro de actividad filtrable

- `GET /api/reports/activity?fecha=AAAA-MM-DD&usuario=<id>&limit=1000` devuelve la actividad del
  día de todos los usuarios o de uno concreto, enriquecida con referencia y detalle legible.
- La pantalla **Reportes de usuarios** incluye el selector «Todos los usuarios» y el buscador.
  Al elegir un usuario, la lista se limita a sus acciones; cada evento muestra el usuario cuando
  se ven todos.
- La exportación CSV incluye la columna de usuario y funciona tanto para un usuario como para
  todos.
- Las acciones de red (alta/baja de IPs, restricción y puerto) y la generación de consentimientos
  tienen etiqueta propia en el registro.

## 21. Pacientes menores de edad

- La API de agenda devuelve `fecha_nacimiento`, `edad` y `es_menor` en cada cita
  (`citaMapeada`), tanto en la lista como en el calendario y el detalle.
- La tarjeta de la cita muestra una advertencia permanente «Menor de edad» con la edad y el
  recordatorio de que requiere un adulto responsable.
- Si el usuario tiene `documentos.crear`, la tarjeta ofrece **Generar consentimiento** antes de
  iniciar la consulta. `POST /api/appointments/:id/consent` crea el documento con la primera
  plantilla activa de tipo `consentimiento`, valida que el paciente sea menor y que tenga
  representante legal, y registra `consentimiento_generado_cita`.
- Los consentimientos nuevos guardan `documents.appointment_id`, de modo que el estado se puede
  consultar por cita. Si el documento aún no tiene vínculo, se acepta uno del mismo día.
- La API devuelve `consentimiento` en cada cita de menor con tres estados:
  `firmado` (verde), `borrador`/pendiente (rojo) y `sin_generar` (rojo).
- El estado se muestra en la **vista lista**, en la **vista calendario** (borde y etiqueta roja
  cuando no está firmado), en el **detalle de la cita** y en el **encabezado de la consulta**.
  Antes de empezar, el botón indica si se inicia sin consentimiento.
- La consulta en curso (`historia.html`) muestra la misma advertencia de forma persistente, con
  el representante legal, el estado del consentimiento y el botón para generarlo o firmarlo.
- `npm run test:e2e:menores` registra 5 menores con representante, agenda sus citas, genera un
  consentimiento pendiente y otro firmado, valida los estados por API y en navegador (lista,
  calendario y consulta), y rechaza el atajo para adultos.

## 22. Avisos y errores de formularios

- Los avisos (`toast`) aparecen en la parte superior central, por encima del contenido, y duran
  8 segundos cuando son errores (clic para cerrarlos).
- Si hay un `<dialog>` modal abierto, el contenedor de avisos se mueve dentro del diálogo. Los
  diálogos viven en la capa superior del navegador, así que un aviso fuera de ellos quedaría
  detrás del fondo; dentro del diálogo siempre se lee sobre el formulario.
- Los campos obligatorios o inválidos se resaltan en rojo (`campo-invalido`) cuando el navegador
  bloquea el envío, y el resaltado desaparece al corregirlos.
- `npm run test:e2e:avisos` comprueba en navegador que los campos faltantes se resaltan y que un
  error del servidor aparece visible sobre el diálogo.

## 23. Respaldos cifrados y programables

- **Ajustes → Respaldos** permite elegir qué se incluye: base de datos (siempre), firmas y fotos,
  archivos de exámenes y configuración/logo. Muestra el tamaño estimado de cada grupo.
- El respaldo es un único archivo `isim-AAAA-MM-DDTHH-MM-SS.isimbk`:
  - cabecera `ISIMBK2` + metadatos (salt, IV, versión),
  - contenido cifrado con **AES-256-GCM**,
  - manifiesto interno con rutas y tamaños,
  - tag de autenticación al final.
- La clave es aleatoria de 32 bytes y se guarda en `data/sistema/respaldo.key`; se puede descargar
  desde la interfaz. Sin esa clave los respaldos no se pueden abrir.
- La base se obtiene con `VACUUM INTO` para que el respaldo sea consistente aunque haya escrituras.
- Se escribe primero como `.tmp` y se renombra al terminar.
- Programación: manual, cada 6 h, cada 12 h, diario o semanal. El servidor revisa cada minuto y
  recupera un respaldo pendiente al arrancar si el equipo estuvo apagado.
- Retención configurable (1–60 copias); solo se eliminan archivos `isim-*.isimbk`.
- La interfaz muestra el historial, la huella de la clave, el último error y permite **verificar**
  un respaldo descifrándolo y comprobando su integridad.
- La tabla `backups` guarda archivo, ruta, tamaño, hash, items, estado y error. Cada operación
  queda en `audit_log`.
- Restauración desde consola:
  `npm run restore:backup -- <archivo.isimbk> <carpeta-destino> [--clave <archivo.key>] [--force]`.
- `npm run test:e2e:backups` valida respaldo solo de base, respaldo completo, cifrado real,
  restauración, archivo alterado, retención y persistencia de la configuración.

## 24. Acople del frontend ISIM

- Se adoptó la paleta oficial en `public/css/tokens.css`: azul `#284f8c`, verde agua `#45989f`,
  fondo `#f5f7fb` y tipografía Poppins con respaldo del sistema.
- El logo `ISIM_frontend/ISIM_frontend/logo.png` se copió a `public/img/isim-logo.png` y a
  `data/sistema/logo.png`. `logoActual()` y el encabezado usan ese logo por defecto.
- Los documentos y la receta usan el encabezado y el pie del sistema con el logo ISIM.
- **Base de datos para los tres módulos:**
  - `clinical_records.datos` guarda el JSON clínico del frontend (enfermedad actual, signos
    vitales, ginecología, diagnósticos CIE-10, plan, próxima cita). Los campos estructurados
    (`motivo_consulta`, `diagnostico`, `indicaciones`, `recomendaciones`) se mantienen
    sincronizados para las funciones existentes.
  - `prescriptions.datos` guarda diagnóstico, CIE-10, alergias, recomendaciones y tratamiento de
    pareja. Los medicamentos siguen en `prescription_items`.
  - `appointments.jornada` y `appointments.tipo` permiten la vista de mañana/tarde y los tipos
    normal/extra/emergencia.
- **Agenda:** nueva vista **Jornada** con columnas de mañana y tarde, espacios de 30 minutos,
  citas existentes y clic en un espacio libre para crear la cita con esa hora. Los espacios
  libres muestran un botón **+**, el calendario tiene un **+** por día y la vista lista tiene
  **+ Nueva cita** junto a la fecha.
- **Historia clínica:** la consulta se reorganizó en secciones **0 y A–I** con encabezado de
  paciente (avatar, edad, alergias, contacto), tarjetas suaves, numeración azul ISIM, signos
  vitales, IMC, FUM/edad gestacional/FPP, examen físico, CIE-10 con autocompletado y chips
  PRE/DEF, plan y barra de acciones fija para guardar o finalizar.
- **Receta:** campos de diagnóstico, CIE-10, alergias, recomendaciones y pareja, más búsqueda de
  medicamentos en `catalogo_medicinas`.
- **Catálogos:** `GET /api/catalogs/diagnoses` y `GET /api/catalogs/medications`.
- Todo se conserva junto a las funciones anteriores: consentimientos, exámenes, archivos, roles,
  IP/MAC, respaldos, auditoría y sesión única.
- `npm run test:e2e:isim-ui` valida el tema, el logo, la jornada, los datos clínicos, la receta y
  los catálogos.

### 24.1 Admisión y nueva cita

- `patients` incorpora los campos de la admisión ISIM: tipo de documento, instrucción,
  nacionalidad, etnia, seguro, parroquia/cantón/provincia, contacto de emergencia, empresa,
  puesto, número de historia física, antecedentes personales/quirúrgicos/familiares,
  consentimiento LOPDP y nota importante.
- `appointments` incorpora `cupo` y `motivo_grupo`; se mantienen `jornada` y `tipo`.
- `motivos_cita` guarda los motivos agrupados y `GET /api/motivos` los expone.
- El modal **Nueva cita** se rehízo en dos pasos:
  1. búsqueda de paciente o **+ Paciente nueva**;
  2. admisión inline con cédula, nombres, apellidos, nacimiento, sexo, contacto, alergias,
     LOPDP y representante legal cuando es menor;
  3. datos de la cita: médico, fecha/hora, duración, motivo, tipo, cupo y notas.
- La API crea primero la paciente y luego la cita, conservando la validación de menores.
- `prescriptions` agrega `numero` consecutivo y `anulada_en`; `prescription_items` agrega
  `unidad` para la receta ISIM.
- `npm run test:e2e:nueva-cita` valida admisión adulta, LOPDP, menor sin/con representante,
  cupo, tipo, grupo de motivo y columnas normalizadas.

## 25. Formatos ISIM, negativa/revocatoria y anulación de receta

### 25.1 Receta médica A5

- La receta se imprime en **A5 horizontal** con el logo, nombre, dirección, teléfono y RUC del
  centro.
- Incluye paciente, C.I./HC, edad, fecha, número consecutivo, diagnóstico, CIE-10, alergias y
  prescripción `Rp/` con cantidad en número y letras, unidad e indicaciones.
- La firma muestra especialidad y registro profesional; si la receta fue anulada aparece un aviso
  rojo **RECETA ANULADA** con fecha, responsable y motivo.
- `POST /api/prescriptions/:id/annul` marca `anulada_en`, `anulada_por` y `motivo_anulacion`.
  La receta anulada no se puede editar ni volver a anular y se conserva para trazabilidad.

### 25.2 Consentimiento ISIM (Form. 024, A4)

- Plantilla `Consentimiento informado ISIM — Form. 024`, usada por defecto al generar el
  consentimiento de una cita.
- Contiene datos del establecimiento y la paciente, secciones 1–9 (procedimiento, riesgos,
  alternativas, consecuencias), declaración, firmas, huella y bloque de representante legal.
- Incluye secciones de **negativa** y **revocatoria**.

### 25.3 Negativa y revocatoria

- `consent_events` registra `tipo` (`negativa`/`revocatoria`), `motivo`, usuario y fecha.
- `POST /api/documents/:id/consent-event`:
  - **negativa:** solo antes de firmar;
  - **revocatoria:** solo sobre un consentimiento firmado.
- El documento pasa a estado **anulado**; las versiones no firmadas también. La versión firmada
  se conserva intacta.
- La UI del documento muestra el evento, el motivo y el usuario; oculta los botones de firma y de
  nuevos eventos. Se audita como `consentimiento_negado` o `consentimiento_revocado`.

### 25.4 Textos configurables

- Ajustes → **Consentimientos** permite editar la declaración, la negativa y la revocatoria.
- Los textos admiten `{{paciente.nombre_completo}}`, `{{paciente.cedula}}`, `{{institucion}}`,
  `{{fecha}}` y `{{hora}}`.
- Se guardan en `settings` (`consentimiento_declaracion`, `consentimiento_negativa`,
  `consentimiento_revocatoria`) y se insertan al renderizar la plantilla.
- La plantilla ISIM existente se actualiza al arrancar para usar los marcadores, conservando el
  resto de personalizaciones.

## 26. Agenda ISIM: encabezado, tabla y jornada por cupos

- La agenda incorpora un encabezado tipo panel con fecha larga, navegación por día, resumen
  compacto por estado y acceso directo a **Nueva cita**.
- La barra de herramientas mantiene búsqueda siempre visible, filtros plegables y selector de
  vista **Lista / Jornada / Calendario**.
- **Lista:** tabla clínica con hora, paciente (avatar, cédula, edad), motivo/médico, tipo, estado
  y acciones. Conserva los avisos de menor de edad y el estado del consentimiento en rojo/verde.
  Las acciones se agrupan en una línea principal (consulta/consentimiento) y una secundaria
  (estado, editar, cancelar).
- **Jornada:** dos columnas (mañana/tarde), espacios de 30 minutos y **dos cupos por hora**.
  Los cupos libres muestran un botón **+** y abren la nueva cita con hora y cupo preseleccionados.
  Las citas se identifican por color según su estado y muestran edad, motivo y consentimiento.
  Cada jornada incluye una sección de **turnos extra y emergencias** con botones para crearlos.
- **Calendario:** conserva la vista mensual, agrega la marca **Hoy**, la fecha seleccionada y el
  botón **+** por día.
- Las horas se muestran en formato de 24 horas para evitar cortes en la tabla y coincidir con los
  campos de fecha/hora del sistema.

## 27. Política de evolución de la base de datos

- **Regla obligatoria para todo requerimiento nuevo:**
  1. no se rompen relaciones existentes;
  2. no se alteran FK, PK, CHECK ni UNIQUE existentes;
  3. solo se agregan tablas, columnas opcionales/con default, índices y relaciones nuevas.
- Prohibido en migraciones nuevas: `DROP TABLE`, `DROP VIEW`, `DROP COLUMN`,
  `ALTER TABLE ... RENAME`, `PRAGMA foreign_keys = OFF`, `PRAGMA legacy_alter_table = ON`
  y reconstrucciones de tablas.
- Un estado nuevo (por ejemplo, otro estado de cita) no se agrega reconstruyendo la tabla:
  se resuelve con una tabla de catálogo/estados o con validación en la aplicación, sin tocar
  el `CHECK` existente.
- Cada migración debe: respaldar, probar en copia, ser idempotente, ejecutar
  `PRAGMA foreign_key_check`, comparar conteos antes/después y conservar la trazabilidad
  `migration_map` old → new.
- Las reconstrucciones históricas están marcadas con `LEGACY-EXCEPTION` en
  `server/db/index.js`. El guard `tests/e2e-migracion-reglas.mjs` revisa los archivos de
  migración y falla ante cualquier operación destructiva fuera de esas excepciones.
- `ALTER TABLE ... ADD COLUMN` solo se usa para columnas opcionales o con valor por defecto;
  nunca para cambiar el tipo o la semántica de una columna existente.

## 28. LOPDP, historia clínica, menú y secciones de la ficha

- **Consentimiento LOPDP:** la impresión y la carga de evidencia están disponibles
  antes de marcar el consentimiento. `consentimiento-datos.html` es un A4 con los
  datos de la paciente y la constancia de fecha/hora. La evidencia firmada
  (foto o PDF) se guarda con `POST /api/patients/:id/consentimiento-evidencia` en
  `data/consentimientos/` y se sirve por
  `GET /api/patients/:id/consentimiento-evidencia`. Las columnas nuevas de
  `patients` son aditivas. Al pulsar “Imprimir consentimiento” se pregunta qué
  documento imprimir: el LOPDP o una plantilla activa de tipo consentimiento;
  la plantilla genera un documento con los datos de la paciente.
- **Historia clínica:** la pestaña muestra una tabla resumen de todas las
  consultas con fecha, motivo, diagnóstico/CIE-10, médico, estado, cantidad de
  recetas, exámenes, pedidos y notas aclaratorias. Al seleccionar una fila se
  abre el detalle completo, las recetas y los pedidos de esa consulta. Los
  registros antiguos sin `datos` JSON usan `motivo_consulta` y `diagnostico`
  como respaldo.
- **Menú general:** Dashboard, Agenda, Pacientes, Documentos y Ajustes del
  sistema. Documentos reúne Consentimientos, Plantillas, Historial y Estadísticas
  de consentimientos. CRM sigue dentro de Ajustes. Historias permanece fuera del
  menú y se accede desde la ficha.
- **Agenda:** el ajuste `vista_agenda` permite abrir en Lista, Jornada o
  Calendario; Jornada es el valor por defecto. Los tres botones siguen en Agenda
  para cambiar sin pasar por Ajustes. `GET/PUT /api/settings/agenda-vista` y
  `POST /api/settings/agenda` mantienen el ajuste.
- **Acciones de paciente:** Ficha, Historia, Documentos, Agendar y Desactivar
  tienen colores propios; Desactivar es rojo. Se mantiene la identidad visual
  azul/verde, Poppins y el CSS único `isim.css`.
- **Secciones de la ficha:** se agregó `Signos vitales` y las pestañas Receta,
  Exámenes, Pedidos y Consentimientos usan un layout de dos columnas: historial
  a la izquierda y alta/edición a la derecha (`ficha-split`). En móvil las
  columnas se apilan.
- **Permisos:** el administrador conserva acceso total aunque su rol se edite;
  la comprobación se aplica en `permisosDe` y en `puede` del cliente. El rol
  `operador` (Secretario/a) queda limitado a agenda y admisión: ver, crear y
  editar pacientes para agendar, sin documentos, historias, reportes ni
  configuración. Su menú muestra Agenda y Mi cuenta. La migración única
  `migracion_permisos_secretario` ajusta los permisos en bases existentes sin
  tocar el esquema.
- **Pruebas:** 24/24 E2E OK, incluidos los permisos del secretario y del
  administrador, la vista inicial de agenda, la carga de evidencia, la impresión
  LOPDP con selección de plantilla, la tabla de historia, el menú y los
  formularios divididos. Producción respaldada en
  `sgcpm-antes-permisos-agenda-1795390766137.db`, build `1.9.0-mwshameq`,
  PID 21560, `foreign_key_check` en 0 y 20.049 pacientes conservados.

## 29. Documentos rápidos, embarazo, privacidad y reportes (26/26)

- **Navegación de documentos:** la lista de consentimientos y el enlace
  “Volver a consentimientos” usan la navegación parcial existente. Abrir el
  segundo documento ya no recarga toda la aplicación. El generador de QR se
  carga de forma diferida solo al solicitar una firma externa, por lo que
  `documento.html` abre más rápido.
- **Pacientes:** se retiró el botón Editar de la tarjeta y su flujo de edición;
  el alta sigue disponible desde “Nuevo paciente”. El orden se movió junto al
  contador de resultados con controles A-Z, Z-A, C.I. ↑, C.I. ↓ y Recientes.
- **Embarazo:** columnas aditivas `patients.embarazada` y
  `patients.embarazo_nota` (más la `fum` existente). El formulario de la ficha
  permite marcar embarazo, registrar FUM y una nota; la ficha muestra una
  tarjeta de EMBARAZO en las notas importantes, antes de la nota general.
- **Privacidad del contacto:** el teléfono y el correo se muestran
  enmascarados en la tarjeta de paciente, en la cabecera de la ficha y en el
  formulario de datos. El botón de ojo revela los valores y registra
  `contacto_paciente_revelado` mediante
  `POST /api/patients/:id/contacto-visto`; el revelado aparece en Reportes.
- **Reportes de usuarios:** la actividad se presenta en una tabla con Acción,
  Fecha y hora, Módulo, Paciente, Usuario y Detalle. El servidor enriquece cada
  evento con `modulo` y `paciente`; el CSV usa las mismas columnas. Se agregó
  la acción “Datos de contacto consultados”.
- **Pruebas:** **26/26 E2E OK**, con `e2e-documentos-ui.mjs` y
  `e2e-paciente-privacidad.mjs` además de toda la suite existente. Producción:
  respaldo `sgcpm-antes-embarazo-1795395465401.db`, build `1.9.0-mwsjut5q`,
  PID 18452. El respaldo no tenía la columna `embarazada`; después de la
  migración se conservaron 20.049 pacientes, `foreign_key_check` en 0 y la
  migración del secretario se mantiene idempotente.

## 30. Exámenes con notas/cita e historia por modal (27/27)

- **Exámenes:** la ficha permite registrar exámenes con `descripcion` y
  `observaciones`. El backend acepta `observaciones` al crear y permite
  editarlas a médicos y administradores. La tarjeta muestra las observaciones y
  la cita de origen: fecha/hora, motivo y médico.
- **Cita del examen:** se deriva de `clinical_records.appointment_id`
  (`clinical_exams.record_id`), sin columnas nuevas. Cada resultado subido
  conserva `exam_id` en `clinical_attachments`.
- **Historia clínica:** la tabla muestra cada cita por fecha, motivo/descripción,
  diagnóstico/CIE-10, médico, estado y conteos. Al pulsar una fila se abre un
  modal ancho con datos de la consulta, signos, diagnósticos, plan, exámenes con
  observaciones y cita, recetas, pedidos y notas aclaratorias. El modal permite
  imprimir la consulta y agregar una nota si está firmada.
- **Pruebas:** **27/27 E2E OK**. Nueva `e2e-examenes-historia.mjs` (paciente
  nuevo, solicitud de exámenes con observaciones, subida de resultado, cita de
  origen y modal de historia); `e2e-examenes-carga.mjs` ahora valida
  observaciones y vínculo con la cita. Producción: respaldo
  `sgcpm-antes-examenes-historia-1795406019033.db`, build `1.9.0-mwsq6q43`,
  PID 26316; 20.049 pacientes, `foreign_key_check` en 0 y sin migración de
  esquema en esta fase.

## 31. Reportes con taxonomía de auditoría (28/28)

- **Módulos:** el filtro de reportes usa una lista fija con todos los módulos del
  sistema: Acceso, Dashboard, Agenda, Pacientes, Historia clínica, Exámenes,
  Recetas, Pedidos, Certificados, Documentos, Consentimientos, CRM, Usuarios,
  Plantillas, Configuración, Reportes, Respaldos, Migración, WhatsApp, Mi cuenta
  y Sistema.
- **Acciones:** toda acción se clasifica en **ver, leer, modificar o eliminar**.
  La acción específica (por ejemplo, `paciente_creado`) se conserva como
  trazabilidad; la taxonomía se deriva en `server/lib/auditTaxonomy.js`.
- **Base de datos:** `audit_log` incorpora columnas aditivas `modulo` y
  `accion_tipo`, con índices. La migración única
  `migracion_audit_taxonomia` clasificó los eventos existentes; en producción
  fueron 827 eventos, 0 sin clasificar.
- **Reportes:** se eliminó la columna lateral de usuarios. La actividad usa todo
  el ancho, con filtros por módulo, acción y usuario, búsqueda libre, tabla por
  acción/fecha/módulo/paciente/usuario/detalle y exportación CSV.
- **Impresión:** el botón Imprimir genera un reporte A4 horizontal con fecha,
  filtros aplicados, resumen y tabla; oculta navegación y controles.
- **Pruebas:** **28/28 E2E OK**. Nueva `e2e-reportes-filtros.mjs` (sin lista
  lateral, módulos fijos, cuatro tipos de acción, filtros combinados, tracking
  en BD, limpieza e impresión); `e2e-migracion-esquema.mjs` valida las columnas
  de auditoría. Producción: respaldo
  `sgcpm-antes-auditoria-reportes-1795586474217.db`, build
  `1.9.0-mwvpg6o4`, PID 33532; 20.049 pacientes, FK 0 y 827 eventos
  clasificados.
- **Capturas:** 54 reportes con filtros, 55 impresión A4 horizontal y 56 vista
  móvil.

## 32. Pruebas de auditoría con acciones esperadas (29/29)

- **Bitácora E2E:** `tests/lib/auditoria-e2e.mjs` permite declarar, paso a paso,
  las acciones esperadas por usuario, módulo y tipo, y contrastarlas contra el
  reporte de actividad.
- **Prueba nueva:** `tests/e2e-auditoria-acciones.mjs` recorre 14 pasos con dos
  usuarios. Declara las acciones de cada paso (login, paciente creado/editado,
  contacto revelado, cita, historia, examen, adjunto, documento, usuario,
  creación de cita/paciente por recepción y logout) y verifica:
  - que el reporte API de cada usuario contenga la acción específica, el módulo
    y el tipo esperado;
  - que la tabla visible del reporte muestre las acciones de ADMIN y de
    Recepción.
- **Taxonomía:** `migracion_audit_taxonomia_v2` reclasificó los eventos
  existentes. En producción quedaron **832 eventos, 0 sin clasificar**.
- **Aislamiento:** la prueba usa un `DATA_DIR` temporal y lo elimina al
  terminar, de modo que las evidencias y adjuntos generados no se escriben en
  `data/` de producción.
- **Pruebas:** **29/29 E2E OK**. Producción: respaldo
  `sgcpm-antes-auditoria-v2-1795587776351.db`, build `1.9.0-mwvqipgi`,
  PID 14332; 20.049 pacientes, FK 0 y columnas `modulo`/`accion_tipo`
  verificadas.
- **Capturas:** 57 reporte de ADMIN con acciones esperadas y 58 reporte de
  Recepción.
