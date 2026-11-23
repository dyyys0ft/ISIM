import { config } from '../config.js';
import { ipLocal } from '../lib/red.js';
import { puertoSeleccionado } from '../lib/puerto-acceso.js';
import { estadoControlIp } from '../lib/control-ip.js';

/**
 * Muestra el acceso actual en intranet. Con --port imprime solo el número,
 * para que un script de firewall pueda leerlo sin analizar JSON.
 */
const puerto = puertoSeleccionado();

if (process.argv.includes('--port')) {
  console.log(String(puerto));
} else {
  const ip = ipLocal();
  const restriccion = estadoControlIp();
  console.log(
    JSON.stringify(
      {
        ip,
        puerto,
        urlAcceso: `http://${ip || 'localhost'}:${puerto}/`,
        puertoHttps: config.httpsPort,
        restriccionActiva: restriccion.activa,
        ipsPermitidas: restriccion.ips,
      },
      null,
      2
    )
  );
}
