-- Fixture sintético de migración ISIM.
-- No contiene datos reales ni copias de old_db.sql.
-- Formato compatible con server/lib/migracion/oldDb.js: INSERT con columnas.
-- Datos pensados para ejercitar pacientes válidos, sin cédula, duplicados,
-- fechas inválidas, citas con/sin consulta, canceladas, novedades, consultas,
-- exámenes, recetas, catálogos y usuarios antiguos.

INSERT INTO `sistema` (`codigouser`, `nombreuser`, `perfil`, `claveuser`, `transaccion`) VALUES
('adminis', 'ADMINISTRADOR SINTETICO', 'Administrador', '12345', '2024-01-01 08:00:00'),
('rec', 'RECEPCION SINTETICA', 'Recepcion', '12345', '2024-01-01 08:05:00'),
('doctor2', 'DOCTOR SINTETICO', 'Medico', '12345', '2024-01-01 08:10:00'),
('adminin', 'ADMINISTRADOR SINTETICO DOS', 'Administrador', '12345', '2024-01-01 08:15:00');

INSERT INTO `datos` (`codigo`, `nombres`, `cedula`, `fnac`, `sexo`, `celular`, `lugar`, `transaccion`, `usuario`) VALUES
('P001', 'ANA MARIA SINTETICA', '0100000001', '1985-04-12', 'F', '0990000001', 'Riobamba', '2024-01-02 08:00:00', 'rec'),
('P002', 'LUIS ALBERTO SINTETICO', '0100000002', '1978-11-03', 'M', '0990000002', 'Quito', '2024-01-02 08:05:00', 'doctor2'),
('P003', 'MARIA JOSE SINTETICA', '0100000003', '1992-06-21', 'F', '0990000003', 'Cuenca', '2024-01-02 08:10:00', 'rec'),
('P004', 'PEDRO SINTETICO', '0100000004', '1980-02-15', 'M', '0990000004', 'Latacunga', '2024-01-02 08:15:00', 'doctor2'),
('P005', 'ROSA ELENA SINTETICA', '0100000005', '1995-09-30', 'F', '0990000005', 'Ambato', '2024-01-02 08:20:00', 'rec'),
('P006', 'CARLOS SINTETICO UNO', '0100000009', '1988-12-01', 'M', '0990000006', 'Riobamba', '2024-01-02 08:25:00', 'rec'),
('P007', 'CARLOS SINTETICO DOS', '0100000009', '1988-12-02', 'M', '0990000007', 'Riobamba', '2024-01-02 08:30:00', 'rec'),
('P008', 'SIN FECHA SINTETICA', '0100000010', '0000-00-00', 'F', '0990000008', 'Riobamba', '2024-01-02 08:35:00', 'rec'),
('P009', 'FECHA EN SEXO SINTETICA', '0100000011', '0000-00-00', '1985-05-05', '0990000009', 'Riobamba', '2024-01-02 08:40:00', 'rec'),
('P010', 'SIN CEDULA SINTETICA', '', '1990-07-07', 'F', '0990000010', 'Riobamba', '2024-01-02 08:45:00', 'rec'),
('P011', 'NOMBRE', '0100000012', '1991-08-08', 'F', '0990000011', 'Riobamba', '2024-01-02 08:50:00', 'rec'),
('P012', 'ÑANDU SINTETICA', '0100000013', '1993-03-03', 'F', '0990000012', 'Riobamba', '2024-01-02 08:55:00', 'rec');

INSERT INTO `datosgen` (`nombrecod`, `celular`, `telefono`, `mail`, `direccion`, `ocupacion`, `ecivil`, `ciudad`, `referencia`, `cambiofec`) VALUES
('P001', '0990000001', '032000001', 'ana.sintetica@example.test', 'Calle Sintetica 1', 'Docente', 'Soltera', 'Riobamba', 'Referencia sintetica', '2024-01-03'),
('P002', '0990000002', '032000002', 'luis.sintetico@example.test', 'Calle Sintetica 2', 'Comerciante', 'Casado', 'Quito', 'Referencia sintetica', '2024-01-03'),
('P005', '0990000005', '032000003', 'rosa.sintetica@example.test', 'Calle Sintetica 3', 'Estudiante', 'Soltera', 'Ambato', 'Referencia sintetica', '2024-01-03'),
('P012', '0990000012', '032000004', 'nandu.sintetica@example.test', 'Calle Sintetica 4', 'Artesana', 'Soltera', 'Riobamba', 'Referencia sintetica', '2024-01-03');

INSERT INTO `citamedica` (`codigo`, `nombrecod`, `nombres`, `citafec`, `horario`, `transaccion`, `consultacod`, `novedad`, `con`, `tipo`, `lugar`, `observ`, `motivo`, `alergia`, `usuario`) VALUES
('C001', 'P001', 'ANA MARIA SINTETICA', '2024-03-10', '09:00', '2024-03-01 08:00:00', 'K001', '', 'OK', 'Consulta', 'Riobamba', 'Observacion sintetica', 'Control sintetico', 'Penicilina', 'doctor2'),
('C002', 'P002', 'LUIS ALBERTO SINTETICO', '2024-03-11', '10:30', '2024-03-01 08:05:00', '0', 'CANCELADA', '', 'Consulta', 'Quito', 'Cancelada sintetica', 'Cancelada sintetica', '', 'rec'),
('C003', 'P003', 'MARIA JOSE SINTETICA', '2024-03-12', '11:00', '2024-03-01 08:10:00', '0', 'SIN TURNO', '', 'Consulta', 'Cuenca', 'No asistio sintetica', 'No asistio sintetica', '', 'rec'),
('C004', 'P004', 'PEDRO SINTETICO', '0000-00-00', '', '2024-03-13 09:15:00', '0', '', '', 'Consulta', 'Latacunga', 'Fecha invalida sintetica', 'Fecha aproximada sintetica', '', 'doctor2'),
('C005', 'P005', 'ROSA ELENA SINTETICA', '2024-03-14', '15:00', '2024-03-01 08:20:00', 'K005', '', 'OK', 'Consulta', 'Ambato', 'Consulta con receta sintetica', 'Consulta con receta', '', 'doctor2'),
('C006', 'P001', 'ANA MARIA SINTETICA', '2024-03-15', '16:00', '2024-03-01 08:25:00', '0', '', 'OK', 'Consulta', 'Riobamba', 'Confirmada sintetica', 'Confirmada sintetica', 'Penicilina', 'rec'),
('C007', 'P012', 'ÑANDU SINTETICA', '2024-03-16', '09:30', '2024-03-01 08:30:00', 'K007', '', 'OK', 'Consulta', 'Riobamba', 'Control con acentos', 'Control con acentos', '', 'doctor2');

INSERT INTO `cons` (`codigo`, `nombrecod`, `fechacon`, `transaccion`, `motivo`, `diagnostico`, `cie10`, `cie10d`, `sintomas`, `observ`, `examen`, `alergia`, `proxima`, `usuario`) VALUES
('K001', 'P001', '2024-03-10', '2024-03-10 09:30:00', 'Consulta de control', 'Control sintetico', 'Z000', 'Control sintetico', 'Sin sintomas', 'Observacion sintetica', 'Ninguno', 'Penicilina', '2024-04-10', 'doctor2'),
('K005', 'P005', '2024-03-14', '2024-03-14 15:30:00', 'Consulta con receta', 'Diagnostico sintetico dos', 'Z001', 'Diagnostico sintetico dos', 'Sintomas leves', 'Observacion de receta', 'Laboratorio', '', '2024-04-14', 'doctor2'),
('K007', 'P012', '2024-03-16', '2024-03-16 10:00:00', 'Control con acentos', 'Control sintetico', 'Z000', 'Control sintetico', 'Sin sintomas', 'Observacion con acentos', 'Ecografia', '', '2024-04-16', 'doctor2'),
('K100', 'P002', '2024-02-20', '2024-02-20 11:00:00', 'Consulta sin cita', 'Diagnostico sintetico sin cita', 'Z001', 'Diagnostico sintetico sin cita', 'Sintomas sinteticos', 'Observacion sin cita', 'Ninguno', '', '2024-03-20', 'rec'),
('K101', 'P003', '2024-02-21', '2024-02-21 12:00:00', 'Consulta sin cita dos', 'Control sintetico', 'Z000', 'Control sintetico', 'Sin sintomas', 'Observacion sin cita dos', 'Ninguno', '', '2024-03-21', 'rec'),
('K102', 'P010', '2024-02-22', '2024-02-22 13:00:00', 'Consulta sin cedula', 'Control sintetico', 'Z000', 'Control sintetico', 'Sin sintomas', 'Observacion sin cedula', 'Ninguno', '', '2024-03-22', 'rec');

INSERT INTO `examenes` (`examencod`, `citacod`, `nombrecod`, `nombres`, `tipo`, `informe`, `imagen1n`, `imagen2n`, `nombreo1`, `nombreo2`, `examenfec`, `transaccion`, `usuario`) VALUES
('E001', 'C001', 'P001', 'ANA MARIA SINTETICA', 'ECOGRAFIA', 'Informe sintetico', 'imagen-sintetica-1.png', '', '', '', '2024-03-10 10:00:00', '2024-03-10 10:05:00', 'doctor2'),
('E002', 'C005', 'P005', 'ROSA ELENA SINTETICA', 'LABORATORIO', '', '', 'imagen-sintetica-2.png', 'orden-sintetica.pdf', '', '2024-03-14 16:00:00', '2024-03-14 16:05:00', 'doctor2'),
('E003', 'C007', 'P012', 'ÑANDU SINTETICA', 'COLPOSCOPIA', 'Informe con acentos', '', '', '', '', '2024-03-16 10:30:00', '2024-03-16 10:35:00', 'doctor2');

INSERT INTO `receta` (`codigo`, `conscod`, `citacod`, `medicina`, `dci`, `cantidad`, `forma`, `dosis`, `frecuencia`, `duracion`, `via`, `advertencia`, `usuario`, `transaccion`) VALUES
('R001', 'K001', '0', 'MEDICINA SINTETICA', 'DCI SINTETICA', '1', 'tableta', '1 cada 24 horas', 'cada 24 horas', '5 dias', 'oral', 'Tomar con alimentos', 'doctor2', '2024-03-10 09:45:00'),
('R002', 'K005', '0', 'MEDICINA SINTETICA DOS', 'DCI SINTETICA DOS', '2', 'capsula', '1 cada 12 horas', 'cada 12 horas', '3 dias', 'oral', '', 'doctor2', '2024-03-14 15:45:00'),
('R003', '0', 'C005', 'MEDICINA SINTETICA TRES', 'DCI SINTETICA TRES', '1', 'crema', 'Aplicar', 'cada 8 horas', '7 dias', 'topica', 'Uso externo', 'doctor2', '2024-03-14 16:10:00'),
('R004', 'K007', '0', 'MEDICINA SINTETICA CUATRO', 'DCI SINTETICA CUATRO', '1', 'tableta', '1 diaria', 'cada 24 horas', '10 dias', 'oral', '', 'doctor2', '2024-03-16 10:15:00');

INSERT INTO `diagnostico` (`diagcod`, `cie10`, `diagnostico`, `observ`) VALUES
('D001', 'Z000', 'Control sintetico', 'Observacion sintetica'),
('D002', 'Z001', 'Diagnostico sintetico dos', 'Observacion sintetica dos');

INSERT INTO `medicina` (`medicod`, `medicina`, `dci`, `forma`, `via`, `dosis`, `frecuencia`, `duracion`, `advertencia`) VALUES
('M001', 'MEDICINA SINTETICA', 'DCI SINTETICA', 'tableta', 'oral', '1 cada 24 horas', 'cada 24 horas', '5 dias', 'Tomar con alimentos'),
('M002', 'MEDICINA SINTETICA DOS', 'DCI SINTETICA DOS', 'capsula', 'oral', '1 cada 12 horas', 'cada 12 horas', '3 dias', '');

INSERT INTO `tratamiento` (`tratcod`, `nombre`, `descripcion`, `cantidad`, `medicina`, `dci`, `forma`, `via`, `dosis`, `frecuencia`, `duracion`, `advertencia`) VALUES
('T001', 'TRATAMIENTO SINTETICO', 'Tratamiento de prueba', '1', 'MEDICINA SINTETICA', 'DCI SINTETICA', 'tableta', 'oral', '1 cada 24 horas', 'cada 24 horas', '5 dias', 'Tomar con alimentos');

INSERT INTO `informe` (`infocod`, `nombre`, `informe`, `observacion`) VALUES
('I001', 'INFORME SINTETICO', 'Informe de laboratorio sintetico', 'Sin hallazgos sinteticos');
