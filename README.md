# denil-memories

Un álbum personal en forma de calendario. Fotos y pequeñas historias para volver a los días importantes, compartidas solo con quien tú elijas.

## Qué incluye

- Calendario mensual con miniaturas, navegación entre meses y detalle del día.
- Varios recuerdos por fecha: título, descripción, fotos y etiquetas.
- Diseño minimalista responsive, orientado a móvil.
- Administración con una contraseña propia; sin registro ni proveedores de identidad.
- Recuerdos públicos, privados o compartidos con varios grupos independientes.
- Un código por grupo, almacenado como hash. Rotarlo revoca las sesiones existentes.
- Originales privados conservados sin cambios y **descargables exclusivamente por el administrador**.
- HEIC/HEIF de iPhone convertido a JPEG para visualizar; originales HEIC intactos. También JPEG, PNG, WebP y AVIF.
- Galería ampliable, teclado y deslizamiento táctil.
- API versionada, tokens de administrador revocables y documentación.

## Desarrollo local

Requiere Node.js **22.13+** (recomendado: 24) y npm.

```sh
npm ci
cp .env.example .env
node scripts/hash-password.mjs
```

El último comando solicita una contraseña sin mostrarla y devuelve una línea `ADMIN_PASSWORD_HASH=...`. Pégala en `.env`; no guardes la contraseña en texto plano. Reinicia el servidor después de cambiar variables.

```sh
npm run dev
```

Abre `http://localhost:4321`. Entra en `/acceso?modo=admin` con tu contraseña. Crea grupos en **Accesos y API** y guarda tu primer recuerdo. Las fotos y la base de datos se crean automáticamente en `data/`, excluido de Git y fuera de los archivos públicos.

Si tu sistema intenta compilar Sharp usando una instalación global incompatible de libvips, instala con `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci`.

## Privacidad y acceso

| Audiencia            | Lo que puede ver                              |
| -------------------- | --------------------------------------------- |
| Visitante sin código | Recuerdos públicos                            |
| Código de un grupo   | Públicos y recuerdos asignados a ese grupo    |
| Administrador        | Todos los recuerdos y descargas de originales |

Los grupos no se heredan entre sí. Una publicación puede pertenecer a amigos y familia, por ejemplo. Sin público ni grupos seleccionados, solo tú puedes verla. Un navegador recuerda un acceso de grupo a la vez; introducir otro código lo reemplaza.

Las sesiones duran 30 días. Los tokens de API duran 90 días. Solo se almacenan hashes de los secretos. Los archivos se sirven a través de endpoints que vuelven a comprobar permisos en cada petición; no hay enlaces públicos permanentes al almacenamiento. Las respuestas usan `private, no-store`. Las versiones de visualización eliminan EXIF/GPS; el original conserva sus metadatos. Una persona autorizada puede guardar las versiones de visualización que recibe en su navegador, aunque no tenga acceso al original.

La contraseña no tiene recuperación por correo: para cambiarla, genera un nuevo hash y reinicia. Para invalidar **todas** las sesiones y tokens tras un cambio, con el servicio detenido ejecuta `sqlite3 data/memories.sqlite 'DELETE FROM sessions;'` (ajusta la ruta si cambiaste `DATA_DIR`).

## Almacenamiento

**Por defecto: local y privado.** `DATA_DIR` contiene `memories.sqlite` y `photos/<id>/{original,preview,thumb}`. La base de datos usa SQLite con Drizzle, claves foráneas, WAL y migraciones versionadas aplicadas al arrancar (`src/lib/db.ts`).

**Opcional: Cloudflare R2 u otro S3 compatible.** Configura en `.env`:

```dotenv
S3_ENDPOINT=https://TU_ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=denil-memories
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Mantén el bucket **privado**, sin dominio público ni acceso anónimo. Las subidas y lecturas pasan por el servidor; no necesitas CORS en el bucket. Las credenciales requieren lectura, escritura y eliminación de objetos en ese bucket. SQLite sigue necesitando disco persistente aunque las fotos estén en R2.

No se migran automáticamente las fotos existentes al cambiar de modo: copia los objetos conservando las claves `<id>/original`, `<id>/preview` y `<id>/thumb` antes del cambio. Usa un entorno separado al probar una configuración nueva.

Límites: 30 fotos por recuerdo, 30 MB por foto y 100 MB por petición. Puedes añadir fotos editando el recuerdo. Los HEIC se decodifican en el servidor sin depender de soporte HEIC del navegador. Se guardan imágenes estáticas; no se incluyen los vídeos de Live Photos. Las vistas JPEG no conservan el rango HDR del original.

## Comprobaciones

```sh
npm run check         # Tipos y componentes Astro
npm run lint          # ESLint
npm run format:check  # Prettier
npm test              # Unitarias e integración SQLite/archivos/HEIC
npm run build
npx playwright install chromium
npm run test:e2e      # API y recorridos completos en escritorio/móvil
npm run verify        # Tipos + lint + formato + unitarias/integración + build
```

Para usar un Chromium ya instalado: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`. Las pruebas E2E requieren un build previo, arrancan el servidor en el puerto 4322 y usan datos temporales con una contraseña exclusivamente de prueba. No utilizan tus fotos ni tu base de datos. El fixture HEIC también es una imagen sintética propia.

GitHub Actions ejecuta las comprobaciones y E2E en cada push y pull request.

## Ejecutar el build

```sh
npm run build
npm start
```

Se sirve por defecto en el puerto 4321. Para HTTPS detrás de un proxy configura `APP_ORIGIN=https://tu-dominio` y `COOKIE_SECURE=true`; el origen debe ser exacto y sin barra final. `HOST` y `PORT` permiten configurar la escucha. El middleware verifica el origen de todas las escrituras de navegador, incluyendo JSON y multipart; las integraciones usan Bearer sin cookies. No confíes en cabeceras de IP enviadas libremente por visitantes: el límite de acceso usa la dirección del socket y, tras un proxy, puede compartirse entre visitantes (10 intentos por 15 minutos).

La versión inicial está preparada para un proceso Node con disco persistente. Un hosting serverless como Vercel requiere adaptar la base de datos y las sesiones a servicios externos antes de desplegarlo. El despliegue no está configurado todavía.

### Copias de seguridad

Con el servicio detenido, copia **todo `DATA_DIR`** (incluidos los archivos WAL si existen). Si usas R2, respalda también los objetos del bucket. El almacenamiento externo no sustituye una copia de seguridad. Para restaurar, recupera la base de datos y los objetos con las mismas claves antes de iniciar la aplicación.

## Estructura

```text
src/
  components/      Iconos y tarjetas
  layouts/         Estructura y navegación responsive
  lib/             Datos, autenticación, permisos, imágenes y almacenamiento
  pages/           Calendario, días, galería, administración y API
  scripts/         Interacciones de editor y accesos
  styles/          Tailwind y estilos del álbum
tests/             Unitarias, integración y recorridos Playwright
docs/API.md        Contrato y ejemplos de API
```

Consulta [la documentación de API](docs/API.md) para integrar otros servicios.
