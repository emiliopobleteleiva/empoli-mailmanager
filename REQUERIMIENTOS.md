# Levantamiento de requerimientos — Arpoli · Gestión de tareas

Fecha: 21 de noviembre de 2026. Documento inicial reconstruido a partir de conversaciones anteriores y revisión del código. Distingue objetivos de las funciones que deben validarse; no sustituye una especificación aprobada por el usuario.

## Objetivo
Aplicación sencilla para que la gerencia de Plásticos Arpoli asigne tareas a colaboradores, conozca responsables, fechas, estado y avances, y pueda consultar información y documentos mediante un asistente.

## Usuarios y acceso
- La persona administradora (gerencia) y colaboradores con acceso individual.
- Cada usuario debe consultar y actualizar las tareas que le correspondan, con acceso a sus respectivos archivos. Revisar las reglas y roles reales antes de utilizarla con todo el equipo.
- Se usó acceso mediante cuenta ChatGPT; el autohospedaje incorpora login con Microsoft Entra ID para las cuentas corporativas.

## Funciones deseadas
1. Crear tareas con título, descripción, responsable y fecha de vencimiento; visualizar tareas pendientes, en curso, terminadas y vencidas.
2. Registrar avances y consultar el historial de cada tarea.
3. Gestionar tareas recurrentes semanales, mensuales y anuales, con generación y seguimiento confiables.
4. Adjuntar y consultar archivos por tarea (PDF, Word, Excel e imágenes); mantener permisos y límites de tamaño.
5. Asistente para consultar tareas y resumir o comparar documentos adjuntos, por ejemplo cotizaciones.
6. Recordatorios y avisos por correo, con registro del resultado y control antes de enviar. El piloto se limita al buzón configurado en `MAIL_PILOT_RECIPIENT`; ampliar destinatarios requiere definir el alcance. El envío usa Microsoft Graph (Outlook/Microsoft 365).
7. Acceso práctico desde computador y teléfono, con una interfaz clara para el personal.

## Estado a verificar
El código incluye rutas para tareas, avances, recurrencia, adjuntos, IA, transcripción y un piloto de correo con Microsoft Graph, además de almacenamiento D1/R2. Las conversaciones anteriores indicaban que los avisos automáticos y los permisos completos del equipo estaban pendientes; la sola presencia de código no demuestra que estén operativos. Comprobar con pruebas: acceso de cada rol, tareas recurrentes y su programación, correos y estado de entrega, claves y límites de archivos, y comportamiento de la IA. No se han probado estas funciones en esta entrega.

## Decisiones pendientes
- Forma definitiva de acceso para colaboradores y permisos por rol.
- Flujo de creación y cierre de tareas recurrentes, recordatorios, horarios y destinatarios.
- Límites de archivos y necesidades de comparación de documentos.
- Integraciones, respaldo, privacidad, costos y dónde alojar una eventual versión independiente.
- Prioridades y criterios de aceptación con la persona administradora antes de implementar cambios.
