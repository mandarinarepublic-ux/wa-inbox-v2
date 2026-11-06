-- 📝 Transcripción de notas de voz (6-nov-2026). Ver lib/transcripcion.js.
-- Whisper corre en el navegador de quien toca el botón; acá solo se guarda el texto
-- para que el equipo entero lo vea sin volver a transcribir.
-- Es aditiva y nullable: no reescribe la tabla ni cambia nada de lo que ya funciona.
alter table inbox.mensajes add column if not exists transcripcion text;
