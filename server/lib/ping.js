import { execFile } from 'node:child_process';
import { isIP } from 'node:net';

/**
 * Comprueba si una IP responde en la red usando el comando `ping` del sistema.
 * Solo se llama desde un endpoint autenticado y con IPs que ya están en la
 * lista blanca, para no convertirlo en un escáner arbitrario.
 */
export function ping(ip) {
  return new Promise((resolve) => {
    if (!isIP(ip)) {
      resolve({ ip, enRed: null, ms: null, detalle: 'IP no válida' });
      return;
    }

    const argumentos =
      process.platform === 'win32'
        ? ['-n', '1', '-w', '1500', ip]
        : ['-c', '1', '-W', '1', ip];

    execFile('ping', argumentos, { timeout: 4000, windowsHide: true }, (error, stdout, stderr) => {
      const texto = `${stdout || ''}${stderr || ''}`;
      const coincidencia = texto.match(/(?:time|tiempo)\s*[=<]\s*([\d.,]+)\s*ms/i);
      const ms = coincidencia ? Number(coincidencia[1].replace(',', '.')) : null;
      const huboRespuesta = /Reply from|Respuesta de|bytes=\d+.*(?:time|tiempo)=|TTL=|ttl=/i.test(
        texto
      );

      let enRed;
      if (error?.code === 'ENOENT') enRed = null;
      else enRed = !error || huboRespuesta;

      resolve({
        ip,
        enRed,
        ms,
        detalle:
          enRed === null
            ? 'La herramienta ping no está disponible en el servidor'
            : enRed
              ? 'Responde'
              : 'No responde (puede estar apagada o el ICMP bloqueado)',
      });
    });
  });
}
