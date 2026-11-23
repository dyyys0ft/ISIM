# Despliegue de ISIM en un servicio web

Esta guía explica cómo publicar el sistema y cómo funcionan las actualizaciones.
La aplicación es un servidor Node.js con SQLite, archivos en disco, WebSocket y SSE.
Eso condiciona la plataforma: **necesita un proceso permanente y un disco persistente**.

---

## 1. Restricciones importantes

| Necesidad | Consecuencia |
|---|---|
| SQLite (`data/sgcpm.db`) | Una **sola instancia**. No se puede escalar horizontalmente ni usar serverless. |
| Firmas, fotos, logo, exámenes | Deben vivir en un **disco persistente**. |
| Sesión única y cierre por SSE | El proceso debe quedar vivo; no sirve Vercel, Netlify ni Cloudflare Workers. |
| HTTPS | Lo puede terminar la plataforma o un proxy (Caddy/Nginx). |
| Node.js | Versión **24** (el proyecto exige `>=23`). |

> **No usar:** Vercel, Netlify, Cloudflare Workers, AWS Lambda ni ningún entorno
> serverless. Su sistema de archivos es efímero y perderían la base y las firmas.

---

## 2. Qué plataforma elegir

| Opción | Dificultad | Disco persistente | Auto-deploy | Recomendación |
|---|---|---|---|---|
| **Render + disco** | Baja | Sí (plan pago) | Sí, desde GitHub | **La más simple para empezar** |
| **Railway + volumen** | Baja | Sí | Sí | Buena alternativa a Render |
| **Fly.io + volumen** | Media | Sí | Sí (`fly deploy`) | **Mejor equilibrio costo/región** |
| **AWS Lightsail** | Media | Sí (SSD incluido) | No nativo (script/CI) | **La opción sencilla dentro de AWS** |
| **VPS + Docker + Caddy** | Media | Sí | Sí (script/CI opcional) | **Mejor costo a largo plazo y control total** |

### Costos mensuales de referencia

Precios aproximados en USD, sin impuestos, a noviembre de 2026. Varían por región
y por consumo real.

| Plataforma | Configuración mínima razonable | Costo aproximado/mes |
|---|---|---|
| **AWS Lightsail** | 2 GB RAM, 2 vCPU, 60 GB SSD, 3 TB transferencia | **$12** + snapshots |
| **AWS EC2** | t4g.small + 20 GB EBS + IPv4 pública | **$17–20** + snapshots/egress |
| **Fly.io** | 1 GB RAM + volumen 10 GB (`gru`) | **$8–9** |
| **Fly.io** | 2 GB RAM + volumen 10 GB (`gru`) | **$15–16** |
| **Render** | 512 MB + disco 10 GB | **$9.50** |
| **Render** | 2 GB + disco 10 GB | **$27.50** |
| **DigitalOcean** | 2 GB RAM, 50 GB SSD + backups | **$14–15** |
| **Hetzner (EU)** | 1 GB RAM, 20 GB NVMe | **~$6–7** |
| **Oracle Cloud Free** | 4 núcleos ARM / 24 GB (Always Free) | **$0** (con limitaciones) |

> En AWS, el costo se dispara si agregas **ALB (~$18+), NAT Gateway (~$32+), RDS
> (~$15+) o Fargate + EFS**. Para este sistema no hacen falta: SQLite vive en el
> mismo servidor y el HTTPS puede hacerlo Caddy o el balanceador de Lightsail.


Recomendación concreta:

- Si quieres publicar **hoy y con el mínimo de operación**: **Render con disco persistente**.
- Si quieres **control, respaldos locales y menor costo mensual**: **VPS** (Hetzner,
  DigitalOcean, Contabo) con Docker y Caddy.
- Si la latencia desde Riobamba es crítica: un VPS en Miami/São Paulo o **Fly.io `gru`**.
  Render no tiene región en Sudamérica; Oregon añade latencia.

> La app ya incluye `Dockerfile`, `.dockerignore` y `render.yaml`.

---

## 3. Variables de entorno

| Variable | Obligatoria | Ejemplo | Para qué |
|---|---|---|---|
| `PORT` | La define la plataforma | `3000` | Puerto HTTP. Render/Railway la inyectan. |
| `HOST` | Sí | `0.0.0.0` | Escuchar fuera del contenedor. |
| `DATA_DIR` | Sí en producción | `/var/data` | Base, firmas, fotos, logo e historias. |
| `PUBLIC_URL` | Recomendada | `https://consentimientos.midominio.com` | Enlaces y QR con la URL pública. |
| `BUILD_ID` | Recomendada | hash del commit | Identifica cada despliegue. Si no se define, se usa la fecha de los archivos. |
| `NODE_ENV` | Sí | `production` | Modo de ejecución. |
| `QR_HTTPS` | No | `0` | En la nube déjalo en `0`; el HTTPS lo pone la plataforma. |
| `HTTPS_PORT` | No | — | Solo para HTTPS local con certificado propio. |

La app detecta automáticamente la URL pública en Render (`RENDER_EXTERNAL_URL`),
Railway (`RAILWAY_PUBLIC_DOMAIN`) y Fly.io (`FLY_APP_NAME`). `PUBLIC_URL` manda
sobre todo lo demás y es lo recomendado si usas un dominio propio.

---

## 4. Opción A — Render (recomendada para empezar)

1. Sube el proyecto a un repositorio de GitHub/GitLab.
2. En Render: **New → Blueprint** y selecciona el repositorio. Render leerá `render.yaml`.
   - Alternativa manual: **New → Web Service**, runtime Node, build `npm ci --omit=dev`,
     start `npm start`, health check `/api/health`.
3. El blueprint crea:
   - Servicio web con auto-deploy desde la rama `main`.
   - Disco persistente de 10 GB montado en `/var/data`.
   - `DATA_DIR=/var/data`.
4. Si usas dominio propio:
   - Render → Settings → Custom Domain.
   - Crea el CNAME en tu proveedor de DNS.
   - Define `PUBLIC_URL=https://tu-dominio.com`.
5. Verifica:
   - `https://tu-servicio.onrender.com/api/health` debe devolver
     `{"ok":true,"version":"1.3.0",...}`.
   - Entra a la pantalla de acceso y comprueba que abajo se ve `v1.3.0`.

**Importante:** el disco persistente requiere una instancia paga. Sin disco, cada
despliegue borra la base y las firmas.

### Migrar los datos actuales a Render

1. En Render, abre una Shell del servicio (o usa `scp`/SFTP si está disponible).
2. Detén el servicio temporalmente.
3. Copia al disco `/var/data`:
   - `sgcpm.db`
   - `firmas/`
   - `firmas-medicos/`
   - `fotos/`
   - `historias/`
   - `sistema/` (logo y pie; **no copies `sistema/https`** si usas el HTTPS de Render)
4. Inicia el servicio y verifica `/api/health`.

Para copiar la base de forma segura con WAL, hazlo con el servidor detenido o usa
`sqlite3 data/sgcpm.db ".backup '/var/data/sgcpm.db'"`.

---

## 5. Opción B — Railway

1. **New Project → Deploy from GitHub Repo**.
2. Railway detecta Node y ejecuta `npm start`. Si no, define:
   - Build: `npm ci --omit=dev`
   - Start: `npm start`
3. Añade un **Volume** y móntalo en `/data`.
4. Variables:
   - `DATA_DIR=/data`
   - `HOST=0.0.0.0`
   - `NODE_ENV=production`
   - `PUBLIC_URL=https://tu-dominio` (o usa el dominio de Railway)
5. Genera el dominio público en **Settings → Networking**.
6. Health check: `/api/health`.

Railway inyecta `RAILWAY_PUBLIC_DOMAIN` y `RAILWAY_GIT_COMMIT_SHA`, que la app usa
automáticamente para la URL y el `buildId`.

---

## 6. Opción C — Fly.io

```bash
fly launch --no-deploy
fly volumes create isim_data --size 10 --region gru
```

Edita `fly.toml` para dejar:

```toml
[env]
  HOST = "0.0.0.0"
  PORT = "3000"
  DATA_DIR = "/data"
  NODE_ENV = "production"

[[mounts]]
  source = "isim_data"
  destination = "/data"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
```

Luego:

```bash
fly deploy
fly open
```

`auto_stop_machines = false` y `min_machines_running = 1` son importantes: si la
máquina se apaga, se pierden las conexiones SSE y el primer acceso tarda.

---

## 7. Opción D — VPS con Docker + Caddy

Ejemplo con Ubuntu 24.04, un dominio `consentimientos.tudominio.com` apuntando al VPS.

```bash
# 1. Instalar Docker
curl -fsSL https://get.docker.com | sh

# 2. Clonar el proyecto
sudo mkdir -p /srv/isim && cd /srv/isim
git clone https://github.com/tu-usuario/tu-repo.git .

# 3. Crear el volumen de datos y dar permisos al usuario del contenedor (UID 1000)
sudo mkdir -p /srv/isim-data
sudo chown -R 1000:1000 /srv/isim-data

# 4. Construir y ejecutar
sudo docker build -t isim .
sudo docker run -d --name isim --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e DATA_DIR=/app/data \
  -e HOST=0.0.0.0 \
  -e PUBLIC_URL=https://consentimientos.tudominio.com \
  -e BUILD_ID=$(git rev-parse --short HEAD) \
  -v /srv/isim-data:/app/data \
  isim
```

Caddy delante para HTTPS automático (`/etc/caddy/Caddyfile`):

```caddyfile
consentimientos.tudominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

No expongas el puerto 3443 en la nube. El certificado y el HTTPS los maneja Caddy.

### Actualizar en el VPS

```bash
cd /srv/isim
git pull
sudo docker build -t isim .
sudo docker rm -f isim
sudo docker run -d --name isim --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e DATA_DIR=/app/data -e HOST=0.0.0.0 \
  -e PUBLIC_URL=https://consentimientos.tudominio.com \
  -e BUILD_ID=$(git rev-parse --short HEAD) \
  -v /srv/isim-data:/app/data isim
```

El contenedor se reinicia en segundos. Los datos viven en `/srv/isim-data`, no en
la imagen.

---

## 8. Opción E — AWS Lightsail

Lightsail es la forma sencilla y predecible de usar AWS. Para este sistema alcanza
con el plan de **$12/mes** (2 GB RAM, 2 vCPU, 60 GB SSD, 3 TB de transferencia,
IP estática incluida).

1. Crea una instancia **Ubuntu 24.04** en la región más cercana:
   - **São Paulo (`sa-east-1`)** para menor latencia desde Ecuador.
   - **N. Virginia (`us-east-1`)** como alternativa.
2. Asigna una **IP estática**.
3. Abre solo los puertos **80 y 443** en el firewall de Lightsail. No abras 3000
   ni 3443 al público.
4. Instala Docker y Caddy:

```bash
curl -fsSL https://get.docker.com | sh
sudo apt install -y caddy git
```

5. Clona el proyecto, crea el volumen y ejecuta el contenedor:

```bash
sudo mkdir -p /srv/isim && cd /srv/isim
git clone https://github.com/tu-usuario/tu-repo.git .
sudo mkdir -p /srv/isim-data
sudo chown -R 1000:1000 /srv/isim-data
sudo docker build -t isim .
sudo docker run -d --name isim --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e DATA_DIR=/app/data -e HOST=0.0.0.0 \
  -e PUBLIC_URL=https://consentimientos.tudominio.com \
  -e BUILD_ID=$(git rev-parse --short HEAD) \
  -v /srv/isim-data:/app/data isim
```

6. Configura Caddy con tu dominio (HTTPS automático):

```caddyfile
consentimientos.tudominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

7. Programa snapshots automáticos de la instancia y respaldos de la base fuera
   del servidor (por ejemplo, un bucket S3).

**Costo realista:** $12 de instancia + $1–3 de snapshots + menos de $1 de S3.
**Total: ~$13–16/mes**. Es más barato y simple que montar EC2 + ALB + RDS.

**Actualizaciones:** Lightsail no tiene auto-deploy nativo desde Git. Puedes usar
un script con `git pull` + `docker build` + `docker restart`, o un workflow de
GitHub Actions que entre por SSH. El aviso de versión nueva en el navegador
funciona igual.

---

## 9. Cómo funcionan las actualizaciones

Hay **dos niveles** que no deben confundirse:

### a) Despliegue del servidor (plataforma)

- Render/Railway/Fly: al hacer push a la rama de producción, la plataforma
  reconstruye y reinicia.
- Render: `autoDeploy: true` en `render.yaml`. Se puede desactivar desde el panel
  para publicar solo cuando tú lo decidas.
- Railway: **Settings → Deploy → Auto Deploy**.
- VPS: `git pull` + reconstruir el contenedor (o un workflow de GitHub Actions).

### b) Actualización de las pantallas abiertas (aplicación)

- La versión se muestra **siempre** en la cabecera (`v1.3.0`) y en la pantalla de acceso.
- Cada pantalla consulta `/api/version` cada 60 segundos.
- Si cambia `version` o `buildId`, aparece el aviso de nueva versión.
- En **Ajustes → Actualizaciones** el administrador decide:
  - **Automáticas:** la pantalla se recarga sola cuando no hay un diálogo abierto ni
    un campo en edición.
  - **Manuales:** solo aparece el botón **Actualizar ahora**.
- Esta preferencia **no instala código en el servidor**; solo controla la recarga del
  navegador. El despliegue lo hace la plataforma.

### Publicar una versión nueva

1. Cambia `"version"` en `package.json` (por ejemplo `1.3.1`).
2. Haz commit y push.
3. La plataforma despliega y genera un `BUILD_ID` nuevo.
4. En menos de 60 s los usuarios ven el aviso o la recarga automática.
5. Verifica `GET /api/health`: debe mostrar la versión nueva.

Para volver atrás, usa **Rollback** de la plataforma o despliega el commit anterior.

---

## 10. Primer arranque en producción: seguridad

Una base nueva crea usuarios y datos de demostración con contraseñas débiles. **Antes de
abrir el sistema al público:**

1. Cambia la contraseña del administrador (`npm run password -- admin "NuevaClave123"` o desde
   Usuarios).
2. Desactiva o elimina las cuentas de demostración y de solo lectura que no uses.
3. Elimina el paciente y el documento de demostración si aparecen.
4. Confirma que el disco persistente está montado (`DATA_DIR`).
5. Configura HTTPS y `PUBLIC_URL`.
6. Comprueba que `/api/health` responde y muestra la versión.
7. Configura respaldos diarios (ver abajo).
8. No publiques los puertos 3443 ni la base de datos.

---

## 11. Respaldos

La base usa WAL. Copiar solo `sgcpm.db` con el servidor activo puede dejar fuera
cambios recientes. Opciones:

```bash
# Copia consistente con SQLite (recomendado)
sqlite3 /ruta/data/sgcpm.db ".backup '/respaldos/sgcpm-$(date +%F-%H%M).db'"

# O detén el servicio y copia sgcpm.db, sgcpm.db-wal y sgcpm.db-shm
```

Respalda también las carpetas `firmas/`, `firmas-medicos/`, `fotos/`, `historias/`
y `sistema/`. Guarda los respaldos fuera del servidor y prueba una restauración al
menos una vez al mes.

---

## 12. Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| La base se reinicia vacía tras cada deploy | Falta el disco persistente o `DATA_DIR` no apunta a él. |
| `SQLITE_CANTOPEN` | El usuario del contenedor no puede escribir en el disco. |
| La app funciona pero el QR apunta a `localhost` | Falta `PUBLIC_URL`. |
| Error 502 en Render | El servicio no escucha en `PORT`/`0.0.0.0`. |
| Se pierden sesiones al desplegar | Es normal: el proceso se reinicia; las sesiones están en SQLite y sobreviven, pero las conexiones SSE se reconectan. |
| Lentitud al guardar | SQLite con muchas escrituras; revisar disco y tamaño de la base. |
| Varias instancias | **No**. SQLite + SSE requieren una sola instancia. |

Para escalar horizontalmente habría que migrar a PostgreSQL y a un almacén de
sesiones compartido; no es necesario para el volumen actual del ISIM.

---

## 13. Despliegue en intranet

1. Inicia ISIM con `INICIAR_SISTEMA.bat` (o `npm start`). El servidor escucha en todas las
   interfaces (`0.0.0.0`) por defecto.
2. Entra con un usuario que tenga `configuracion.gestionar` y abre **Ajustes → Red / Acceso**.
3. En **Puerto de acceso** elige un puerto de la lista (o escribe uno propio) y pulsa
   **Aplicar puerto**. El cambio es inmediato y no corta las sesiones.
4. Copia la **URL de acceso** que aparece arriba, por ejemplo `http://192.168.1.10:8080/`, y
   distribúyela a las tablets y computadoras de la red.
5. Ejecuta `ABRIR_PUERTO_RED.bat` como administrador para habilitar ese puerto en el firewall
   de Windows. Para verificar: `node server/scripts/puerto-acceso.js`.
6. En **IPs permitidas**, marca «Restringir el acceso solo a las IPs de la lista» y agrega
   cada IP o rango (`192.168.1.25`, `192.168.1.0/24`). Guarda la restricción.

**Antes de activar la restricción**, comprueba que tu propia IP está en la lista o que estás
en el mismo equipo (127.0.0.1 siempre tiene acceso). Si el equipo está detrás de un proxy de
intranet, marca también «Confiar en X-Forwarded-For»; de lo contrario déjalo desactivado para
evitar que un cliente falsifique su IP.

| Síntoma | Causa probable |
|---|---|
| La URL de la intranet no responde | Falta la regla del firewall: ejecuta `ABRIR_PUERTO_RED.bat`. |
| Una tablet recibe «Acceso denegado» | Su IP no está en la lista blanca. |
| Todas las tablets reciben 403 | La IP del proxy (no la de cada equipo) debe estar en la lista si usas proxy. |
| El puerto elegido dice «ocupado» | Otro programa lo usa; elige otro de la lista. |
| El acceso funciona pero el QR apunta a otro puerto | El QR usa el puerto del servidor; configura `PUBLIC_URL` si necesitas el puerto expuesto. |

---

## 14. Respaldos cifrados

1. Entra a **Ajustes → Respaldos**.
2. Elige el directorio (puede ser un disco externo o un NAS) y pulsa **Guardar configuración**.
3. Selecciona qué incluir: base de datos (siempre), firmas y fotos, archivos de exámenes y
   configuración/logo.
4. Define la frecuencia: manual, cada 6 h, cada 12 h, diario o semanal. Ajusta la retención.
5. Pulsa **Descargar clave** y guarda `isim-respaldo.key` fuera del servidor. **Sin esa clave los
   respaldos no se pueden abrir.**
6. Usa **Respaldar ahora** para la primera copia. El historial permite **Verificar** cada archivo.

Restauración:

```text
npm run restore:backup -- "D:\RespaldosISIM\isim-2026-11-20T23-14-46.isimbk" "D:\restauracion" --clave "C:\claves\isim-respaldo.key"
```

El script extrae `sgcpm.db` y las carpetas incluidas. Para reemplazar producción, detén el
sistema, respalda `data/sgcpm.db` y copia la base restaurada en su lugar. No sobrescribe archivos
existentes salvo que uses `--force`.
