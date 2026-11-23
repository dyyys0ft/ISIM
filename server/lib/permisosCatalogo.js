export const PERMISOS = {
  USUARIOS_GESTIONAR: 'usuarios.gestionar',
  PACIENTES_VER: 'pacientes.ver',
  PACIENTES_CREAR: 'pacientes.crear',
  PACIENTES_EDITAR: 'pacientes.editar',
  PACIENTES_DESACTIVAR: 'pacientes.desactivar',
  DOCUMENTOS_VER: 'documentos.ver',
  DOCUMENTOS_CREAR: 'documentos.crear',
  DOCUMENTOS_EDITAR: 'documentos.editar',
  DOCUMENTOS_ANULAR: 'documentos.anular',
  DOCUMENTOS_FIRMAR: 'documentos.firmar',
  AGENDA_VER: 'agenda.ver',
  AGENDA_GESTIONAR: 'agenda.gestionar',
  HISTORIAS_VER: 'historias.ver',
  HISTORIAS_RESUMEN: 'historias.resumen',
  HISTORIAS_GESTIONAR: 'historias.gestionar',
  EXAMENES_GESTIONAR: 'examenes.gestionar',
  REGISTRO_VER: 'registro.ver',
  CONFIGURACION_VER: 'configuracion.ver',
  CONFIGURACION_GESTIONAR: 'configuracion.gestionar',
  FIRMA_MEDICO: 'firma.medico',
  DASHBOARD_VER: 'dashboard.ver',
  PLANTILLAS_GESTIONAR: 'plantillas.gestionar',
  CRM_VER: 'crm.ver',
  CRM_GESTIONAR: 'crm.gestionar',
  REPORTES_VER: 'reportes.ver',
};

const TODOS = Object.values(PERMISOS);

/**
 * Catálogo que usa la pantalla Ajustes → Tipos de acceso.
 * Cada permiso se clasifica como lectura o edición para que la interfaz
 * muestre siempre las dos columnas.
 */
export const CATALOGO_PERMISOS = [
  {
    id: 'pacientes',
    nombre: 'Pacientes',
    descripcion: 'Fichas, datos demográficos y estado de las pacientes.',
    permisos: [
      { permiso: PERMISOS.PACIENTES_VER, etiqueta: 'Ver pacientes', tipo: 'lectura' },
      { permiso: PERMISOS.PACIENTES_CREAR, etiqueta: 'Crear pacientes', tipo: 'edicion' },
      { permiso: PERMISOS.PACIENTES_EDITAR, etiqueta: 'Editar pacientes', tipo: 'edicion' },
      {
        permiso: PERMISOS.PACIENTES_DESACTIVAR,
        etiqueta: 'Desactivar pacientes',
        tipo: 'edicion',
      },
    ],
  },
  {
    id: 'agenda',
    nombre: 'Agenda',
    descripcion: 'Citas, cancelaciones y reagendas.',
    permisos: [
      { permiso: PERMISOS.AGENDA_VER, etiqueta: 'Ver agenda', tipo: 'lectura' },
      { permiso: PERMISOS.AGENDA_GESTIONAR, etiqueta: 'Gestionar citas', tipo: 'edicion' },
    ],
  },
  {
    id: 'historias',
    nombre: 'Historias clínicas',
    descripcion: 'Consultas, diagnósticos, exámenes y archivos clínicos.',
    permisos: [
      { permiso: PERMISOS.HISTORIAS_VER, etiqueta: 'Ver historias', tipo: 'lectura' },
      {
        permiso: PERMISOS.HISTORIAS_RESUMEN,
        etiqueta: 'Ver resumen de historias',
        tipo: 'lectura',
      },
      {
        permiso: PERMISOS.HISTORIAS_GESTIONAR,
        etiqueta: 'Crear y editar historias',
        tipo: 'edicion',
      },
      {
        permiso: PERMISOS.EXAMENES_GESTIONAR,
        etiqueta: 'Subir y editar exámenes',
        tipo: 'edicion',
      },
    ],
  },
  {
    id: 'documentos',
    nombre: 'Documentos y consentimientos',
    descripcion: 'Consentimientos, certificados, recetas y firmas.',
    permisos: [
      { permiso: PERMISOS.DOCUMENTOS_VER, etiqueta: 'Ver documentos', tipo: 'lectura' },
      { permiso: PERMISOS.DOCUMENTOS_CREAR, etiqueta: 'Crear documentos', tipo: 'edicion' },
      { permiso: PERMISOS.DOCUMENTOS_EDITAR, etiqueta: 'Editar documentos', tipo: 'edicion' },
      { permiso: PERMISOS.DOCUMENTOS_ANULAR, etiqueta: 'Anular documentos', tipo: 'edicion' },
      { permiso: PERMISOS.DOCUMENTOS_FIRMAR, etiqueta: 'Firmar documentos', tipo: 'edicion' },
    ],
  },
  {
    id: 'registro',
    nombre: 'Historial de firmas',
    descripcion: 'Registro histórico de firmas y exportación.',
    permisos: [
      { permiso: PERMISOS.REGISTRO_VER, etiqueta: 'Ver historial', tipo: 'lectura' },
    ],
  },
  {
    id: 'crm',
    nombre: 'CRM',
    descripcion: 'Mensajes, solicitudes y seguimiento de pacientes.',
    permisos: [
      { permiso: PERMISOS.CRM_VER, etiqueta: 'Ver CRM', tipo: 'lectura' },
      { permiso: PERMISOS.CRM_GESTIONAR, etiqueta: 'Gestionar CRM', tipo: 'edicion' },
    ],
  },
  {
    id: 'usuarios',
    nombre: 'Usuarios',
    descripcion: 'Cuentas, credenciales, roles y estado de los usuarios.',
    permisos: [
      {
        permiso: PERMISOS.USUARIOS_GESTIONAR,
        etiqueta: 'Gestionar usuarios y roles',
        tipo: 'edicion',
      },
    ],
  },
  {
    id: 'configuracion',
    nombre: 'Configuración del sistema',
    descripcion: 'Datos del centro, logo, WhatsApp, versiones y respaldos.',
    permisos: [
      { permiso: PERMISOS.CONFIGURACION_VER, etiqueta: 'Ver configuración', tipo: 'lectura' },
      {
        permiso: PERMISOS.CONFIGURACION_GESTIONAR,
        etiqueta: 'Cambiar configuración',
        tipo: 'edicion',
      },
    ],
  },
  {
    id: 'plantillas',
    nombre: 'Plantillas',
    descripcion: 'Plantillas de consentimientos y certificados.',
    permisos: [
      {
        permiso: PERMISOS.PLANTILLAS_GESTIONAR,
        etiqueta: 'Gestionar plantillas',
        tipo: 'edicion',
      },
    ],
  },
  {
    id: 'dashboard',
    nombre: 'Dashboard',
    descripcion: 'Indicadores y estadísticas del sistema.',
    permisos: [
      { permiso: PERMISOS.DASHBOARD_VER, etiqueta: 'Ver dashboard', tipo: 'lectura' },
    ],
  },
  {
    id: 'reportes',
    nombre: 'Reportes',
    descripcion: 'Actividad por usuario y exportación de reportes.',
    permisos: [
      { permiso: PERMISOS.REPORTES_VER, etiqueta: 'Ver reportes', tipo: 'lectura' },
    ],
  },
  {
    id: 'firma',
    nombre: 'Firma del médico',
    descripcion: 'Firma precargada que se usa en los documentos.',
    permisos: [
      { permiso: PERMISOS.FIRMA_MEDICO, etiqueta: 'Registrar firma médica', tipo: 'edicion' },
    ],
  },
];

export const ROLES_POR_DEFECTO = [
  {
    slug: 'admin',
    nombre: 'Administrador',
    descripcion: 'Control total del sistema, usuarios, roles y configuración.',
    protegido: 1,
    permisos: TODOS,
  },
  {
    slug: 'medico',
    nombre: 'Médico',
    descripcion: 'Consulta pacientes, gestiona historias y emite documentos firmados.',
    protegido: 1,
    permisos: [
      PERMISOS.PACIENTES_VER,
      PERMISOS.PACIENTES_CREAR,
      PERMISOS.PACIENTES_EDITAR,
      PERMISOS.PACIENTES_DESACTIVAR,
      PERMISOS.DOCUMENTOS_VER,
      PERMISOS.DOCUMENTOS_CREAR,
      PERMISOS.DOCUMENTOS_EDITAR,
      PERMISOS.DOCUMENTOS_ANULAR,
      PERMISOS.DOCUMENTOS_FIRMAR,
      PERMISOS.AGENDA_VER,
      PERMISOS.AGENDA_GESTIONAR,
      PERMISOS.HISTORIAS_VER,
      PERMISOS.HISTORIAS_RESUMEN,
      PERMISOS.HISTORIAS_GESTIONAR,
      PERMISOS.EXAMENES_GESTIONAR,
      PERMISOS.REGISTRO_VER,
      PERMISOS.FIRMA_MEDICO,
      PERMISOS.CRM_VER,
      PERMISOS.CRM_GESTIONAR,
    ],
  },
  {
    slug: 'operador',
    nombre: 'Secretario/a',
    descripcion:
      'Agenda citas y admite pacientes. Sin acceso a historias, documentos, reportes ni configuración.',
    protegido: 1,
    permisos: [
      PERMISOS.PACIENTES_VER,
      PERMISOS.PACIENTES_CREAR,
      PERMISOS.PACIENTES_EDITAR,
      PERMISOS.AGENDA_VER,
      PERMISOS.AGENDA_GESTIONAR,
    ],
  },
  {
    slug: 'enfermero',
    nombre: 'Enfermero',
    descripcion:
      'Gestiona pacientes, agenda y exámenes; ve el resumen de la historia sin la consulta completa.',
    protegido: 1,
    permisos: [
      PERMISOS.PACIENTES_VER,
      PERMISOS.PACIENTES_CREAR,
      PERMISOS.PACIENTES_EDITAR,
      PERMISOS.AGENDA_VER,
      PERMISOS.AGENDA_GESTIONAR,
      PERMISOS.HISTORIAS_RESUMEN,
      PERMISOS.EXAMENES_GESTIONAR,
      PERMISOS.DOCUMENTOS_VER,
      PERMISOS.REGISTRO_VER,
    ],
  },
  {
    slug: 'lectura',
    nombre: 'Solo lectura',
    descripcion: 'Consulta pacientes, agenda, historias, documentos e historial.',
    protegido: 1,
    permisos: [
      PERMISOS.PACIENTES_VER,
      PERMISOS.DOCUMENTOS_VER,
      PERMISOS.AGENDA_VER,
      PERMISOS.HISTORIAS_VER,
      PERMISOS.REGISTRO_VER,
      PERMISOS.CONFIGURACION_VER,
    ],
  },
];
