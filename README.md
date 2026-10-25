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

Requiere Node.js **22.x** y npm. La versión de Node para Vercel está fijada en `package.json` y `.nvmrc`.

```sh
npm ci
cp .env.example .env
node scripts/hash-password.mjs
```

Puedes definir tu contraseña directamente en la variable privada `ADMIN_PASSWORD` de `.env` o Vercel. No necesita un formato especial: al entrar en la web introduces exactamente esa contraseña. No uses prefijos `PUBLIC_` ni guardes `.env` en Git.

Como alternativa, `node scripts/hash-password.mjs` solicita una contraseña sin mostrarla y devuelve `ADMIN_PASSWORD_HASH=scrypt:...`. En ese modo guardas el hash en la variable e introduces **la contraseña original**, no el hash, en la web. Deja `ADMIN_PASSWORD` vacío para usar el hash; si ambas variables están configuradas, tiene prioridad `ADMIN_PASSWORD`. Una contraseña escrita directamente en `ADMIN_PASSWORD_HASH` no es válida. Reinicia o redespliega después de cambiar variables.

```sh
npm run dev
```

Abre `http://localhost:4321`. Entra en `/acceso?modo=admin` con tu contraseña. Crea grupos en **Accesos y API** y guarda tu primer recuerdo. Sin servicios externos configurados, las fotos y la base de datos se crean en `data/`, excluido de Git y fuera de los archivos públicos. Si configuras Turso o R2 en `.env`, el desarrollo utilizará esos servicios: emplea entornos de prueba cuando corresponda.

Si tu sistema intenta compilar Sharp usando una instalación global incompatible de libvips, instala con `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci`.

## Privacidad y acceso

| Audiencia            | Lo que puede ver                              |
| -------------------- | --------------------------------------------- |
| Visitante sin código | Recuerdos públicos                            |
| Código de un grupo   | Públicos y recuerdos asignados a ese grupo    |
| Administrador        | Todos los recuerdos y descargas de originales |

Los grupos no se heredan entre sí. Una publicación puede pertenecer a amigos y familia, por ejemplo. Sin público ni grupos seleccionados, solo tú puedes verla. Un navegador recuerda un acceso de grupo a la vez; introducir otro código lo reemplaza.

Las sesiones duran 30 días. Los tokens de API duran 90 días. Solo se almacenan hashes de los secretos. Cada petición a la API de imágenes comprueba permisos; con R2, devuelve una redirección firmada válida **60 segundos**, sin enlaces públicos permanentes. Las URLs ya emitidas pueden seguir funcionando durante esos 60 segundos tras una revocación. Las respuestas usan `private, no-store`. Las versiones de visualización eliminan EXIF/GPS; el original conserva sus metadatos. Una persona autorizada puede guardar las versiones de visualización que recibe en su navegador, aunque no tenga acceso al original.

La contraseña no tiene recuperación por correo: para cambiarla, actualiza `ADMIN_PASSWORD` (o genera un nuevo hash si utilizas ese modo) y reinicia o redespliega. Para invalidar **todas las sesiones y tokens de este álbum**, ejecuta `DELETE FROM denil_sessions;` en tu base de datos. No elimina tablas o sesiones de otras aplicaciones.

## Almacenamiento

**Base de datos: Turso/libSQL con Drizzle.** Configura:

```dotenv
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

La base puede ser compartida con otras aplicaciones. Se crean exclusivamente tablas `denil_*`, incluida `denil_migrations`; no se usa `PRAGMA user_version` ni se modifican tablas ajenas, como `syt-sessions`. Ejecuta `npm run db:migrate` para preparar o verificar el esquema; también se inicializa de forma idempotente en el primer acceso de cada proceso.

Sin URL de Turso, se usa `data/denil-memories.sqlite` localmente. La antigua base `data/memories.sqlite` de la primera versión se conserva, pero no se importa automáticamente. Una migración de datos existentes debe hacerse de forma explícita.

**Opcional: Cloudflare R2 u otro S3 compatible.** Configura en `.env`:

```dotenv
S3_ENDPOINT=https://TU_ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=denil-memories
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Mantén el bucket **privado**, sin dominio público ni acceso anónimo. Genera las claves en **R2 → Manage API Tokens → Create API Token → Object Read & Write**, limitado a ese bucket. `Access Key ID` y `Secret Access Key` aparecen al crear el token; no son la URL pública ni el token global de Cloudflare.

La app usa exclusivamente claves bajo **`denil-memories/`**. Los objetos existentes en otras rutas del bucket se conservan y no se importan al calendario automáticamente. Si el bucket ya es público y sirve a otra web, utiliza uno privado separado para el álbum.

La subida se autoriza en el servidor y el navegador envía cada original directamente a R2 mediante PUT firmado. La conversión HEIC y generación de vistas se realizan en una petición posterior, una foto por petición. Esto evita los límites de tamaño de entrada/salida de las funciones de Vercel. Configura el CORS del bucket siguiendo [docs/VERCEL.md](docs/VERCEL.md).

**Nombres ordenables:** `20261025-dia-en-la-playa-a13f92c40bd1.heic`. Se usa la fecha del recuerdo en formato `AAAAMMDD`, el título normalizado y un sufijo de 12 caracteres. Se conserva la extensión real; los originales no se convierten. Las claves R2 se agrupan por año y mes; miniaturas y vistas tienen subcarpetas. Cambiar fecha/título de un recuerdo actualiza el nombre de descarga, sin mover los objetos ya almacenados.

No se migran automáticamente las fotos locales al activar R2: copia los objetos conservando sus claves antes del cambio. No mezcles una base remota de producción con fotos que solo existan en el disco de desarrollo.

Límites: 30 fotos por recuerdo y 30 MB por foto. Puedes añadir fotos editando el recuerdo. El modo multipart de compatibilidad local limita la petición a 100 MB; la interfaz usa subidas individuales. Los HEIC se decodifican en el servidor sin depender de soporte HEIC del navegador. Se guardan imágenes estáticas; no se incluyen los vídeos de Live Photos. Las vistas JPEG no conservan el rango HDR del original.

Las subidas incompletas caducan tras una hora; las preparadas sin publicar, tras 24 horas. Cada nueva autorización limpia hasta 10 subidas caducadas. También existe `POST /api/v1/uploads/cleanup` para limpieza administrativa. Las fotos ya asociadas a recuerdos no se eliminan en esa limpieza.

## Comprobaciones

```sh
npm run check         # Tipos y componentes Astro
npm run lint          # ESLint
npm run format:check  # Prettier
npm test              # Unitarias e integración libSQL/archivos/HEIC/S3 simulado
npm run build
npx playwright install chromium
npm run test:e2e      # API y recorridos completos en escritorio/móvil
npm run verify        # Tipos + lint + formato + unitarias/integración + build
npm run build:vercel  # Build serverless real para Vercel
npm run test:e2e:vercel # Pruebas del artefacto serverless con S3 simulado
```

Para usar un Chromium ya instalado: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`. Las pruebas E2E requieren un build previo, arrancan el servidor en el puerto 4322 y usan datos temporales con una contraseña exclusivamente de prueba. No utilizan tus fotos ni tu base de datos. El fixture HEIC también es una imagen sintética propia.

GitHub Actions ejecuta las comprobaciones, E2E y build de Vercel en cada push y pull request.

## Ejecutar el build

```sh
npm run build
npm start
```

Se sirve por defecto en el puerto 4321. Para HTTPS detrás de un proxy configura `APP_ORIGIN=https://tu-dominio` y `COOKIE_SECURE=true`; el origen debe ser exacto y sin barra final. `HOST` y `PORT` permiten configurar la escucha. El middleware verifica el origen de todas las escrituras de navegador, incluyendo JSON y multipart; las integraciones usan Bearer sin cookies. No confíes en cabeceras de IP enviadas libremente por visitantes: el límite de acceso usa la dirección del socket y, tras un proxy, puede compartirse entre visitantes (10 intentos por 15 minutos).

## Desplegar en Vercel Hobby

El proyecto incluye `@astrojs/vercel`, `vercel.json` y el flujo de subidas directas R2. Vercel usa **Turso para datos y sesiones** y **R2 para todos los archivos**; no depende de disco persistente ni guarda secretos en el bundle. Consulta [docs/VERCEL.md](docs/VERCEL.md) para configurar variables, CORS y verificar el despliegue. El build Node se mantiene para desarrollo y pruebas E2E.

### Copias de seguridad

Para modo local, con el servicio detenido copia **todo `DATA_DIR`** (incluidos los archivos WAL si existen). Para Turso, usa sus herramientas de exportación/recuperación y conserva las tablas `denil_*`. Si usas R2, respalda también los objetos bajo `denil-memories/`. Para restaurar, recupera los datos y archivos con las mismas claves. En una base compartida, restaura únicamente las tablas de este proyecto.

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
