# Vercel Hobby + Turso + R2

## 1. Turso: base compartida

Puedes utilizar la base `personal` con su URL y token existentes. La aplicación crea **solo** `denil_groups`, `denil_memories`, `denil_audiences`, `denil_photos`, `denil_sessions`, `denil_attempts`, `denil_uploads` y `denil_migrations`. No utiliza la tabla `syt-sessions` ni modifica `PRAGMA user_version`.

Añade a `.env` para preparar el esquema:

```dotenv
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

```sh
npm run db:migrate
```

Este comando es idempotente. No publica fotos ni inserta datos de prueba. Las pruebas automatizadas usan bases temporales aisladas, incluso si existe un `.env` real.

## 2. R2: bucket privado

Las fotos originales y las privadas no pueden alojarse en un bucket público: cualquiera con su URL evitaría los permisos del álbum. La URL pública no sustituye las credenciales S3.

Si `jknm-recuerdostrujillo` se usa en otra web pública, crea un bucket **privado separado** para este álbum. Si decides reutilizarlo, desactiva **Public Development URL (`r2.dev`)** y todos los dominios públicos asociados desde Settings. Eso afecta a los enlaces públicos de los objetos existentes; las fotos no se eliminan.

Para generar credenciales:

1. Cloudflare → **R2 Object Storage → Overview**.
2. En **Account Details**, abre **Manage API Tokens**.
3. **Create Account API Token** o **Create User API Token**.
4. Permiso **Object Read & Write**, limitado al bucket elegido.
5. Copia **Access Key ID** y **Secret Access Key** al crearlo. El secreto se muestra una sola vez; si perdiste uno antiguo, genera otro.
6. Copia el endpoint S3 desde los datos del bucket. No uses el dominio público `r2.dev` como endpoint.

```dotenv
S3_ENDPOINT=https://TU_ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=NOMBRE_DEL_BUCKET_PRIVADO
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

La aplicación escribe y elimina exclusivamente objetos bajo **`denil-memories/`**. Las fotos que ya existen en otras rutas no se modifican ni se importan automáticamente. Para mostrarlas en el calendario, crea un recuerdo con su fecha y súbelas desde el panel; el original existente puede conservarse.

### CORS

En **Bucket → Settings → CORS policy**, pega [r2-cors.json](r2-cors.json) y sustituye `https://REEMPLAZAR.vercel.app` por el dominio exacto de producción, sin barra final. Añade tu dominio personalizado si luego lo configuras. No uses `*` como origen.

CORS permite el PUT directo del navegador; **no hace público** el bucket. Las URLs de subida están firmadas, duran 10 minutos, permiten un único nombre de objeto y el tamaño declarado se comprueba antes de procesarlo. Los originales no pasan por el cuerpo de una función de Vercel.

## 3. Importar GitHub en Vercel

1. Vercel → **Add New → Project**.
2. Importa `DenilDenilson/memories`.
3. Framework: **Astro**, raíz del repositorio.
4. Node.js: **22.x** (`package.json` lo fija).
5. El repositorio configura `npm run build:vercel` en `vercel.json`; no configures `npm start` como comando de servidor en Vercel.
6. Usa una única región de funciones cercana a Turso, cuando puedas seleccionarla.
7. Añade las variables de la siguiente sección antes de desplegar.

### Variables de producción

| Variable               | Valor                                              |
| ---------------------- | -------------------------------------------------- |
| `TURSO_DATABASE_URL`   | URL de la base `personal`                          |
| `TURSO_AUTH_TOKEN`     | Token de esa base                                  |
| `S3_ENDPOINT`          | Endpoint S3 de R2                                  |
| `S3_REGION`            | `auto`                                             |
| `S3_BUCKET`            | Bucket privado elegido                             |
| `S3_ACCESS_KEY_ID`     | Access Key ID del token R2                         |
| `S3_SECRET_ACCESS_KEY` | Secret Access Key del token R2                     |
| `ADMIN_PASSWORD_HASH`  | Hash generado con `node scripts/hash-password.mjs` |
| `COOKIE_SECURE`        | `true`                                             |
| `APP_ORIGIN`           | `https://tu-proyecto.vercel.app`, sin barra final  |

Guarda estas variables en **Production**. Para Preview utiliza otra base/bucket de prueba y el origen correspondiente; no compartas inadvertidamente los datos de producción con todas las ramas. Si todavía no conoces el dominio, Vercel lo mostrará al crear el proyecto; configura `APP_ORIGIN` y CORS con ese dominio y redespliega.

No se necesitan `DATA_DIR`, `HOST` ni `PORT` en Vercel. La aplicación exige Turso y un bucket R2 configurado en ese entorno. Las sesiones, los intentos de acceso y las autorizaciones de subida están en Turso, no en memoria o disco efímero de la función.

## 4. Comprobar el despliegue

1. Abrir el calendario público y `/acceso?modo=admin`.
2. Entrar con la contraseña propia.
3. Subir JPEG y HEIC, incluyendo una foto mayor de 4.5 MB para verificar la subida directa.
4. Confirmar miniatura, galería y nombre ordenable de descarga del original.
5. Crear un grupo, compartir un recuerdo y probar desde una ventana privada.
6. Comprobar que el visitante no tiene descarga del original.
7. Rotar el código y verificar que el acceso anterior deja de emitir nuevas URLs.
8. Redesplegar y comprobar que los recuerdos siguen presentes.

Las URLs firmadas ya emitidas pueden seguir funcionando hasta 60 segundos. Que un recuerdo sea público en el álbum no hace público el bucket: la app sigue autorizando las lecturas de sus versiones optimizadas.

## Verificación local del build serverless

```sh
npm run build:vercel
npm run test:e2e:vercel
```

Genera `.vercel/output`. El adaptador incluye los recursos HEIC necesarios y usa Node 22. El máximo de ejecución se configura en 300 segundos; cada foto se procesa en una petición separada. La segunda orden prueba ese artefacto usando libSQL y un S3 simulado, completamente aislados de tus credenciales. Este build no equivale a un despliegue exitoso: hay que verificarlo en la cuenta real con R2 configurado.
