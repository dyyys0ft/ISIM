import assert from 'node:assert/strict';

/**
 * Declara las acciones esperadas de cada paso de un E2E y las contrasta con el
 * reporte de actividad de cada usuario.
 */
export function crearBitacoraAcciones() {
  const esperadas = [];

  function paso(numero, titulo, usuario, acciones) {
    for (const [accion, modulo, accionTipo] of acciones) {
      esperadas.push({
        numero,
        titulo,
        usuario: { id: usuario.id, nombre: usuario.nombre },
        accion,
        modulo,
        accionTipo,
      });
    }
  }

  async function verificar(consultar) {
    assert.ok(esperadas.length, 'La bitácora debe declarar acciones esperadas');
    const porUsuario = new Map();
    for (const item of esperadas) {
      if (!porUsuario.has(item.usuario.id)) {
        porUsuario.set(item.usuario.id, { usuario: item.usuario, acciones: [] });
      }
      porUsuario.get(item.usuario.id).acciones.push(item);
    }

    for (const { usuario, acciones } of porUsuario.values()) {
      const eventos = await consultar(usuario);
      assert.ok(Array.isArray(eventos), `El reporte de ${usuario.nombre} no devolvió eventos`);
      for (const esperada of acciones) {
        const encontrada = eventos.find(
          (evento) =>
            evento.accion === esperada.accion &&
            (evento.modulo || '') === esperada.modulo &&
            (evento.accion_tipo || '') === esperada.accionTipo
        );
        assert.ok(
          encontrada,
          `Paso ${esperada.numero} (${esperada.titulo}): falta ${esperada.accion} ` +
            `[${esperada.modulo}/${esperada.accionTipo}] en el reporte de ${usuario.nombre}`
        );
      }
      console.log(
        `✓ Reporte de ${usuario.nombre}: ${acciones.length} acción(es) esperada(s) encontrada(s)`
      );
    }

    return { usuarios: porUsuario.size, acciones: esperadas.length };
  }

  return { paso, verificar, esperadas };
}
