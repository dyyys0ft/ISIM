import { db } from '../db/index.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { requireUser } from './auth.js';

function inicioDelDia(fecha = new Date()) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

function inicioDeSemana() {
  const inicio = inicioDelDia();
  const dia = (inicio.getDay() + 6) % 7; // lunes = 0
  inicio.setDate(inicio.getDate() - dia);
  return inicio;
}

function inicioDeMes() {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
}

function contar(tabla, columna, desde) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${columna} >= ?`)
    .get(desde.toISOString()).n;
}

export function routes(router) {
  router.get('/api/dashboard', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DASHBOARD_VER);

    const hoy = inicioDelDia().toISOString();
    const semana = inicioDeSemana().toISOString();
    const mes = inicioDeMes().toISOString();

    const firmasHoy = contar('signatures', 'firmado_en', new Date(hoy));
    const firmasSemana = contar('signatures', 'firmado_en', new Date(semana));
    const firmasMes = contar('signatures', 'firmado_en', new Date(mes));
    const pacientesHoy = contar('patients', 'creado_en', new Date(hoy));
    const pacientesMes = contar('patients', 'creado_en', new Date(mes));

    const totales = {
      documentos: db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,
      firmados: db.prepare('SELECT COUNT(*) AS n FROM signatures').get().n,
      pacientes: db.prepare('SELECT COUNT(*) AS n FROM patients WHERE activo = 1').get().n,
    };

    const recientes = db
      .prepare(
        `SELECT s.id, s.firmado_en, s.patient_snapshot, s.documento_titulo,
                d.titulo AS titulo_actual, u.nombre AS empleado
         FROM signatures s
         JOIN documents d ON d.id = s.document_id
         LEFT JOIN users u ON u.id = s.gestionado_por
         ORDER BY s.firmado_en DESC
         LIMIT 6`
      )
      .all()
      .map((fila) => {
        let paciente = {};
        try {
          paciente = JSON.parse(fila.patient_snapshot || '{}');
        } catch {
          paciente = {};
        }
        return {
          id: fila.id,
          firmadoEn: fila.firmado_en,
          titulo: fila.documento_titulo || fila.titulo_actual,
          paciente: `${paciente.nombres || ''} ${paciente.apellidos || ''}`.trim(),
          empleado: fila.empleado || 'No registrado',
        };
      });

    return {
      firmas: { hoy: firmasHoy, semana: firmasSemana, mes: firmasMes },
      pacientes: { hoy: pacientesHoy, mes: pacientesMes },
      totales,
      recientes,
    };
  });
}
