# Verificación de la primera versión

## Comprobaciones ejecutadas

- `npm run verify`: sin errores de tipos, lint, formato ni build.
- Vitest: **13 pruebas** unitarias/de integración aprobadas.
- Playwright: **4 pruebas** aprobadas sobre el build real de Node, en Chromium de escritorio y emulación móvil de iPhone 13.
- QA adicional usando el navegador MCP de Playwright a 1440 × 1000 y 390 × 844.

En este entorno se usó el Chromium del sistema con `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. La emulación móvil no sustituye una comprobación en Safari físico.

## Cobertura

- Calendario de lunes a domingo, años bisiestos y navegación entre años.
- Fechas inválidas y límites del intervalo de consulta.
- Público, grupos independientes, audiencias combinadas y acceso total del administrador.
- Hashes con sal, caducidad, separación entre cookies y tokens API, revocación y límite de intentos.
- Originales byte a byte, JPEG optimizado sin EXIF/GPS y miniaturas.
- Conversión de un archivo HEIC real generado para las pruebas; rechazo de archivos falsos/vacíos.
- Creación, edición, adición y eliminación de fotos; protección de la última foto de un recuerdo.
- Publicación pública, permisos sobre URLs de imágenes, originales exclusivos del administrador y bloqueo de escrituras sin permisos.
- Creación de grupos, acceso por código y revocación al cambiarlo.
- Creación, uso y revocación de tokens API.
- Comprobación de origen en escrituras de navegador.
- Eliminación del recuerdo y retirada de sus URLs de fotos.
- Ausencia de desplazamiento horizontal en el calendario móvil.

## QA manual con MCP

1. Abrir el administrador e introducir la contraseña de prueba.
2. Crear un recuerdo con fecha, descripción, etiquetas y un archivo `.heic`.
3. Comprobar la conversión y la opción de descarga del original.
4. Volver al calendario y comprobar la miniatura en el día elegido.
5. Abrir el día, entrar al recuerdo y ampliar la foto en móvil.
6. Cerrar el visor con Escape y comprobar que no hay errores ni avisos en consola durante el recorrido.

Se guardaron capturas locales en `.playwright-mcp/calendar-desktop.png` y `.playwright-mcp/calendar-mobile.png`, excluidas de Git. Los datos de QA son temporales y no se mezclan con `data/`.

## Servicios externos

La verificación utiliza almacenamiento local privado. La conexión real a R2/S3 necesita credenciales y un bucket del propietario; no se ha probado contra una cuenta externa. No se ha realizado ningún despliegue.
