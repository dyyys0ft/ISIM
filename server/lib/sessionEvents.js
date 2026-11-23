const conexiones = new Map();

function enviar(sessionIds, motivo) {
  for (const sessionId of sessionIds) {
    const respuestas = conexiones.get(sessionId);
    if (!respuestas) continue;

    for (const res of respuestas) {
      try {
        res.write(
          `event: sesion-cerrada\ndata: ${JSON.stringify({ motivo })}\n\n`
        );
        res.end();
      } catch {
        // La conexión pudo haberse cerrado ya.
      }
    }
    conexiones.delete(sessionId);
  }
}

/** Registra una conexión SSE para una sesión. Devuelve la función de limpieza. */
export function registrarConexionSesion(sessionId, res) {
  if (!conexiones.has(sessionId)) conexiones.set(sessionId, new Set());
  conexiones.get(sessionId).add(res);

  return () => {
    const respuestas = conexiones.get(sessionId);
    if (!respuestas) return;
    respuestas.delete(res);
    if (!respuestas.size) conexiones.delete(sessionId);
  };
}

/** Cierra en tiempo real todas las conexiones de una sesión. */
export function cerrarSesionTiempoReal(sessionId, motivo = 'logout') {
  enviar([sessionId], motivo);
}

/** Cierra en tiempo real las sesiones indicadas (por ejemplo, al entrar en otro equipo). */
export function cerrarSesionesTiempoReal(sessionIds, motivo = 'otra_sesion') {
  enviar(sessionIds, motivo);
}
