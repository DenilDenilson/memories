# Verificación de la primera versión

## Comprobaciones ejecutadas

- `npm run verify`: sin errores de tipos, lint, formato ni build.
- Vitest: **20 pruebas** unitarias/de integración aprobadas.
- Playwright: **4 pruebas** sobre el build real de Node y **4 pruebas** sobre el artefacto serverless generado por el adaptador de Vercel, en Chromium de escritorio y emulación móvil de iPhone 13.
- QA adicional usando el navegador MCP de Playwright a 1440 × 1000 y 390 × 844.

En este entorno se usó el Chromium del sistema con `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. La emulación móvil no sustituye una comprobación en Safari físico.

## Cobertura

- Calendario de lunes a domingo, años bisiestos y navegación entre años.
- Fechas inválidas y límites del intervalo de consulta.
- Público, grupos independientes, audiencias combinadas y acceso total del administrador.
- Hashes con sal, caducidad, separación entre cookies y tokens API, revocación y límite de intentos.
- Originales byte a byte, JPEG optimizado sin EXIF/GPS y miniaturas.
- Conversión de un archivo HEIC real generado para las pruebas; rechazo de archivos falsos/vacíos.
- Base compartida: preservación de `syt-sessions` y del `PRAGMA user_version` ajeno a la aplicación.
- Nombres con fecha, título y sufijo corto; prevención de sobrescrituras y rechazo de claves fuera de `denil-memories/`.
- Detección independiente de AVIF y HEIC.
- Subida directa S3, comprobación del tamaño real, generación de URLs firmadas y limpieza de subidas caducadas.
- Creación, edición, adición y eliminación de fotos; protección de la última foto de un recuerdo.
- Publicación pública, permisos sobre URLs de imágenes, originales exclusivos del administrador y bloqueo de escrituras sin permisos.
- Creación de grupos, acceso por código y revocación al cambiarlo.
- Creación, uso y revocación de tokens API.
- Comprobación de origen en escrituras de navegador.
- Eliminación del recuerdo y retirada de sus URLs de fotos.
- Ausencia de desplazamiento horizontal en el calendario móvil.
- Recorrido con archivo de más de 5 MB y un límite simulado de 4.5 MB en el cuerpo de la función serverless.
- Conversión HEIC mediante el paquete real generado para Vercel.

## QA manual con MCP

1. Abrir el administrador e introducir la contraseña de prueba.
2. Crear un recuerdo con fecha, descripción, etiquetas y un archivo `.heic`.
3. Comprobar la conversión y la opción de descarga del original.
4. Volver al calendario y comprobar la miniatura en el día elegido.
5. Abrir el día, entrar al recuerdo y ampliar la foto en móvil.
6. Cerrar el visor con Escape y comprobar que no hay errores ni avisos en consola durante el recorrido.

Se guardaron capturas locales en `.playwright-mcp/calendar-desktop.png` y `.playwright-mcp/calendar-mobile.png`, excluidas de Git. Los datos de QA son temporales y no se mezclan con `data/`.

Tras la adaptación se repitió el recorrido MCP sobre el artefacto serverless de Vercel con S3 simulado: subida HEIC directa a otro origen, conversión, imagen visible y descarga de `20261025-personal-1ec9f887895f.heic`. El nombre de descarga coincide con el informado por la API; el recorrido terminó sin errores de consola. Las comprobaciones automatizadas completas también se ejecutaron con Node 22.

## Adaptación a Vercel

El build `npm run build:vercel` genera la función Node 22 y sus recursos HEIC. `npm run test:e2e:vercel` sirve ese artefacto real con una base libSQL temporal y un servidor S3 de prueba en otro origen, incluyendo preflight CORS y redirecciones de descarga. El servidor S3 usa el SDK y URLs firmadas reales, pero no implementa validación criptográfica de firmas: no sustituye una comprobación contra R2.

## Servicios externos

La conexión real a Turso se verificó y la migración creó solo las tablas `denil_*` en la base compartida `personal`, conservando `syt-sessions`. La conexión real a R2 requiere las credenciales del propietario y un bucket privado; no se ha probado contra una cuenta externa. No se ha realizado ningún despliegue en una cuenta Vercel.
