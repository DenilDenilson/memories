# API v1

Base: `/api/v1`. JSON, con subidas de archivos directas a R2. El modo local mantiene compatibilidad multipart. Todos los errores devuelven `{ "error": "Mensaje" }` y la validación puede incluir `details`.

## Autenticación

Crea un token en **Administración → Accesos y API**. Se muestra una sola vez, tiene acceso completo de administrador, dura 90 días y puede revocarse.

```sh
export BASE_URL=http://localhost:4321
export TOKEN=tu-token
curl "$BASE_URL/api/v1/session" -H "Authorization: Bearer $TOKEN"
```

Los visitantes pueden leer recuerdos públicos sin autenticación. Las sesiones de navegador se abren con `POST /session` enviando `{ "mode": "group", "secret": "codigo" }` o `{ "mode": "admin", "secret": "contraseña" }`. Todas las escrituras basadas en cookies exigen una cabecera `Origin` coincidente con el sitio. `DELETE /session` cierra la sesión de navegador; no revoca tokens API. No envíes secretos en URLs.

## Recuerdos

| Método | Ruta                                      | Acceso                                                         |
| ------ | ----------------------------------------- | -------------------------------------------------------------- |
| GET    | `/memories?from=2026-10-01&to=2026-10-31` | Según permisos; fechas obligatorias, intervalo máximo 366 días |
| GET    | `/memories/:id`                           | Según permisos                                                 |
| POST   | `/memories`                               | Administrador                                                  |
| PUT    | `/memories/:id`                           | Administrador                                                  |
| DELETE | `/memories/:id`                           | Administrador; elimina también fotos y originales              |

La lista devuelve `{ "memories": [...] }`; el detalle y las escrituras devuelven `{ "memory": {...} }`. Un recuerdo no autorizado devuelve 404 igual que uno inexistente.

### Subir fotos y crear un recuerdo (Vercel y local)

Todas las operaciones de subida requieren administrador. Para cada foto:

1. `POST /uploads` con `{ "date": "2026-10-24", "title": "Una tarde junto al mar", "size": 123456 }`, usando el tamaño real en bytes.
2. La respuesta 201 contiene `{ "id", "uploadUrl", "headers" }`. Haz un **PUT del archivo binario** a `uploadUrl`, enviando los `headers` devueltos. La autorización S3 caduca en 10 minutos. No añadas tu Bearer de la aplicación a esa URL externa.
3. `POST /uploads/:id/complete` procesa la foto en el servidor y devuelve `{ "id", "filename" }`. Conserva el ID para publicar. La operación es idempotente una vez preparada.
4. Crea o edita el recuerdo mediante JSON con `metadata` y `uploadIds`. La fecha y el título deben coincidir con los utilizados al autorizar las fotos. Cada ID solo puede asociarse a un recuerdo.

```json
{
  "metadata": {
    "title": "Una tarde junto al mar",
    "date": "2026-10-24",
    "description": "Volvería a este día mil veces.",
    "tags": ["viajes", "playa"],
    "public": false,
    "groupIds": []
  },
  "uploadIds": ["UUID-FOTO-PREPARADA-1", "UUID-FOTO-PREPARADA-2"]
}
```

`POST /memories` responde 201. `PUT /memories/:id` responde 200, reemplaza metadatos y audiencias, conserva fotos existentes y añade las de `uploadIds`. Para editar solo metadatos, envía `uploadIds: []`. Se exige al menos una foto al crear.

Las subidas pendientes caducan en una hora; las preparadas sin publicar caducan en 24 horas. `POST /uploads/cleanup` elimina hasta 10 subidas caducadas. Nunca elimina fotos asociadas a recuerdos. La nueva autorización de una subida también ejecuta esta limpieza.

### Compatibilidad multipart (solo servidor local)

El campo `metadata` es JSON:

```json
{
  "title": "Una tarde junto al mar",
  "date": "2026-10-24",
  "description": "Volvería a este día mil veces.",
  "tags": ["viajes", "playa"],
  "public": false,
  "groupIds": ["UUID-DEL-GRUPO-AMIGOS"]
}
```

```sh
curl -X POST "$BASE_URL/api/v1/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -F 'metadata={"title":"Una tarde junto al mar","date":"2026-10-24","description":"Un día especial","tags":["playa"],"public":false,"groupIds":[]}' \
  -F 'photos=@./foto.jpg' \
  -F 'photos=@./iphone.HEIC'
```

Responde 201. Límites comunes: título 120 caracteres, descripción 5000, hasta 15 etiquetas de 40 caracteres, 30 fotos por recuerdo y 30 MB/foto. El multipart local limita la petición a 100 MB. En Vercel utiliza siempre `/uploads`; no se envían los originales en las peticiones JSON. Los IDs de grupos deben existir. Las fechas son días de calendario `YYYY-MM-DD`, sin conversiones de huso horario.

`PUT` acepta el mismo formato y **reemplaza todos los metadatos y audiencias**, conservando las fotos existentes. Los nuevos campos `photos` se añaden; pueden omitirse para cambiar solo metadatos. Para retirar fotos, utiliza su endpoint de eliminación.

### Respuesta de recuerdo

```json
{
  "memory": {
    "id": "uuid",
    "date": "2026-10-24",
    "title": "Una tarde junto al mar",
    "description": "Un día especial",
    "tags": ["playa"],
    "public": false,
    "createdAt": "2026-10-24T12:00:00.000Z",
    "groupIds": [],
    "photos": [
      {
        "id": "photo-uuid",
        "width": 4032,
        "height": 3024,
        "thumbnailUrl": "/api/v1/photos/photo-uuid/thumb",
        "previewUrl": "/api/v1/photos/photo-uuid/preview",
        "filename": "20261024-una-tarde-junto-al-mar-a13f92c40bd1.heic",
        "size": 1234567,
        "originalUrl": "/api/v1/photos/photo-uuid/original"
      }
    ]
  }
}
```

`groupIds`, `filename`, `size` y `originalUrl` solo aparecen para el administrador.

## Fotos

| Método | Ruta                   | Comportamiento                                                  |
| ------ | ---------------------- | --------------------------------------------------------------- |
| GET    | `/photos/:id/thumb`    | JPEG 360 × 360, sujeto a permisos                               |
| GET    | `/photos/:id/preview`  | JPEG de hasta 1800 × 1800, sujeto a permisos                    |
| GET    | `/photos/:id/original` | Archivo intacto como descarga, **solo administrador**           |
| DELETE | `/photos/:id`          | Administrador; exige conservar al menos una foto en el recuerdo |

Envía el token o la cookie al endpoint de la aplicación. Con R2, este comprueba los permisos y responde con una redirección **302** hacia una URL firmada válida **60 segundos**; permite seguir redirecciones en tu cliente HTTP. Esa URL temporal no requiere el Bearer de la aplicación. Las URLs emitidas antes de una revocación pueden seguir funcionando durante esos 60 segundos. En modo local se devuelve el archivo directamente. El nombre de descarga se calcula con la fecha/título actuales y conserva la extensión original.

## Grupos

Todas las operaciones requieren administrador.

| Método | Ruta                 | Cuerpo/respuesta                                                                                  |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/groups`            | `{ "groups": [{ "id": "uuid", "name": "Amigos" }] }`                                              |
| POST   | `/groups`            | `{ "name": "Amigos", "code": "opcional-minimo-8-caracteres" }` → `{ "id", "name", "code" }` (201) |
| POST   | `/groups/:id/rotate` | Genera código aleatorio y revoca sesiones → `{ "code": "nuevo" }`                                 |
| DELETE | `/groups/:id`        | Elimina grupo, audiencias y sesiones; conserva recuerdos                                          |

Si omites `code`, se genera uno aleatorio. Los códigos se muestran una sola vez. Máximo 30 grupos. Si un recuerdo se queda sin grupos y no es público, pasa a ser solo del administrador.

## Tokens

Todas las operaciones requieren administrador.

| Método | Ruta          | Cuerpo/respuesta                                                                              |
| ------ | ------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/tokens`     | `{ "tokens": [{ "id": "identificador", "label": "Mi script", "expiresAt": 1790000000000 }] }` |
| POST   | `/tokens`     | `{ "label": "Mi script" }` → `{ "token": "secreto", "expiresInDays": 90 }` (201)              |
| DELETE | `/tokens/:id` | Revoca el token por el identificador de la lista                                              |

## Estados

- `200`: lectura, edición o eliminación correcta.
- `201`: creación correcta.
- `400`: datos, fecha, archivo o formato inválidos.
- `401`: contraseña/código incorrecto.
- `403`: origen inválido o permisos insuficientes.
- `404`: ruta o recurso inexistente/no visible.
- `409`: nombre o código de grupo duplicado.
- `413`: petición demasiado grande.
- `429`: más de 10 intentos de acceso en 15 minutos por dirección de conexión.
- `503`: falta configurar la contraseña de administrador.
- `500`: fallo interno o almacenamiento no disponible.
