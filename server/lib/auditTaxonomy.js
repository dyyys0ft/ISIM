/**
 * Taxonomía común de auditoría.
 *
 * `modulo` identifica el área funcional del sistema y `accion_tipo` resume la
 * acción en una de las cuatro categorías de negocio. La acción específica
 * (por ejemplo `paciente_creado`) se conserva en `audit_log.accion`.
 */

export const MODULOS_SISTEMA = [
  'Acceso',
  'Dashboard',
  'Agenda',
  'Pacientes',
  'Historia clínica',
  'Exámenes',
  'Recetas',
  'Pedidos',
  'Certificados',
  'Documentos',
  'Consentimientos',
  'CRM',
  'Usuarios',
  'Plantillas',
  'Configuración',
  'Reportes',
  'Respaldos',
  'Migración',
  'WhatsApp',
  'Mi cuenta',
  'Sistema',
];

export const TIPOS_ACCION = ['ver', 'leer', 'modificar', 'eliminar'];

const MODULOS_ENTIDAD = {
  users: 'Usuarios',
  roles: 'Usuarios',
  patients: 'Pacientes',
  appointments: 'Agenda',
  clinical_records: 'Historia clínica',
  clinical_exams: 'Exámenes',
  clinical_attachments: 'Exámenes',
  clinical_orders: 'Pedidos',
  documents: 'Documentos',
  document_versions: 'Documentos',
  signatures: 'Documentos',
  prescriptions: 'Recetas',
  crm_messages: 'CRM',
  crm_tasks: 'CRM',
  crm_conversations: 'CRM',
  templates: 'Plantillas',
  settings: 'Configuración',
  migration_runs: 'Migración',
  patient_share_links: 'Documentos',
  backups: 'Respaldos',
};

const MODULOS_ACCION = [
  [/^(login|logout|login_fallido|login_ambiguo|sesiones_revocadas)$/, 'Acceso'],
  [
    /^(agenda_actualizada|vista_agenda|horario_agenda|membretes|actualizaciones|centro_|logo_|pie_|alertas_|red_|demo$|catalogo_)/,
    'Configuración',
  ],
  [/^paciente_/, 'Pacientes'],
  [/^contacto_paciente_/, 'Pacientes'],
  [/^(cita_|agenda_)/, 'Agenda'],
  [/^(historia_|consulta_)/, 'Historia clínica'],
  [/^(examen_|adjunto_)/, 'Exámenes'],
  [/^pedido_/, 'Pedidos'],
  [/^certificado_/, 'Certificados'],
  [/^receta_/, 'Recetas'],
  [/^(documento_|documentos_paciente_|copia_)/, 'Documentos'],
  [/^consentimiento_/, 'Consentimientos'],
  [/^firma_(solicitada|cancelada)$/, 'Documentos'],
  [/^firma_medico_/, 'Mi cuenta'],
  [/^crm_/, 'CRM'],
  [/^plantilla_/, 'Plantillas'],
  [/^(perfil_|password_cambiada|foto_)/, 'Mi cuenta'],
  [/^(password_restablecida|usuario_|rol_|instalacion_inicial)/, 'Usuarios'],
  [/^(migracion_|duplicados_)/, 'Migración'],
  [/^respaldo/, 'Respaldos'],
  [/^clave_respaldos_/, 'Respaldos'],
  [/^whatsapp_/, 'WhatsApp'],
  [/^reporte_/, 'Reportes'],
];

export function moduloDe(accion, entidad) {
  const texto = String(accion || '');
  for (const [patron, modulo] of MODULOS_ACCION) {
    if (patron.test(texto)) return modulo;
  }
  return MODULOS_ENTIDAD[entidad] || 'Sistema';
}

const TIPOS_ESPECIFICOS = {
  login: 'ver',
  logout: 'ver',
  login_fallido: 'ver',
  login_ambiguo: 'ver',
  sesiones_revocadas: 'eliminar',
  paciente_creado: 'modificar',
  paciente_editado: 'modificar',
  paciente_desactivado: 'eliminar',
  contacto_paciente_revelado: 'leer',
  cita_creada: 'modificar',
  cita_editada: 'modificar',
  cita_cancelada: 'eliminar',
  cita_notificada_whatsapp: 'leer',
  consulta_iniciada: 'ver',
  consulta_abierta: 'leer',
  consulta_finalizada: 'modificar',
  historia_creada: 'modificar',
  historia_editada: 'modificar',
  historia_consultada: 'leer',
  examen_solicitado: 'modificar',
  examen_actualizado: 'modificar',
  examen_eliminado: 'eliminar',
  adjunto_subido: 'modificar',
  adjunto_eliminado: 'eliminar',
  documento_creado: 'modificar',
  documento_version: 'modificar',
  documento_datos_actualizados: 'modificar',
  documento_anulado: 'eliminar',
  consentimiento_negado: 'eliminar',
  consentimiento_revocado: 'eliminar',
  consentimiento_generado_cita: 'modificar',
  consentimiento_evidencia_subida: 'modificar',
  consentimiento_evidencia_eliminada: 'eliminar',
  firma_solicitada: 'modificar',
  firma_cancelada: 'eliminar',
  copia_entregada: 'leer',
  receta_guardada: 'modificar',
  receta_anulada: 'eliminar',
  receta_enviada_whatsapp: 'leer',
  receta_compartida: 'leer',
  crm_mensaje_enviado: 'modificar',
  crm_conversacion_leida: 'leer',
  crm_tarea_creada: 'modificar',
  crm_tarea_actualizada: 'modificar',
  crm_cita_confirmada_whatsapp: 'modificar',
  plantilla_creada: 'modificar',
  plantilla_editada: 'modificar',
  plantilla_desactivada: 'eliminar',
  documentos_paciente_compartidos: 'leer',
  documentos_paciente_enlace_revocado: 'eliminar',
  documentos_paciente_enviados_whatsapp: 'leer',
  perfil_actualizado: 'modificar',
  password_cambiada: 'modificar',
  password_restablecida: 'modificar',
  firma_medico_guardada: 'modificar',
  firma_medico_eliminada: 'eliminar',
  foto_actualizada: 'modificar',
  foto_eliminada: 'eliminar',
  centro_actualizado: 'modificar',
  textos_consentimiento_actualizados: 'modificar',
  logo_actualizado: 'modificar',
  logo_eliminado: 'eliminar',
  pie_actualizado: 'modificar',
  pie_eliminado: 'eliminar',
  alertas_actualizadas: 'modificar',
  agenda_actualizada: 'modificar',
  whatsapp_configurado: 'modificar',
  whatsapp_token_eliminado: 'eliminar',
  migracion_analizada: 'leer',
  migracion_completada: 'modificar',
  duplicados_depurados: 'eliminar',
  red_puerto_actualizado: 'modificar',
  red_restriccion_actualizada: 'modificar',
  red_ip_agregada: 'modificar',
  red_ip_eliminada: 'eliminar',
  respaldos_configurados: 'modificar',
  respaldo_verificado: 'leer',
  clave_respaldos_descargada: 'leer',
  instalacion_inicial: 'modificar',
};

export function tipoAccionDe(accion) {
  const texto = String(accion || '').toLowerCase();
  if (TIPOS_ESPECIFICOS[texto]) return TIPOS_ESPECIFICOS[texto];

  if (/(elimin|borr|anul|cancel|desactiv|revoc|negad|cerrad|depur|retirad|rechaz)/.test(texto)) {
    return 'eliminar';
  }
  if (/(consult|leid|vist|revelad|verific|analiz|compart|enviad|reimprim|descarg|notificad|export)/.test(texto)) {
    return 'leer';
  }
  if (/(crea|cread|edit|actualiz|guard|configur|agreg|restablec|cambiad|subid|solicit|finaliz|generad|complet|instal|confirm|marcad|iniciad|abiert|asignad|activ|desbloq)/.test(texto)) {
    return 'modificar';
  }
  return 'ver';
}
