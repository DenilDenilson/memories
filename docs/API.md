# API v1

Base: `/api/v1`. JSON salvo creación/edición de recuerdos, que usan `multipart/form-data`. Todos los errores devuelven `{ "error": "Mensaje" }` y la validación puede incluir `details`.

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

### Crear con varias fotos

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

Responde 201. Límites: título 120 caracteres, descripción 5000, hasta 15 etiquetas de 40 caracteres, 30 fotos por recuerdo, 30 MB/foto y 100 MB por solicitud. Se exige al menos una foto al crear. Los IDs de grupos deben existir. Las fechas son días de calendario `YYYY-MM-DD`, sin conversiones de huso horario.

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
        "filename": "iphone.HEIC",
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

Los enlaces no contienen credenciales: envía también el token o la cookie al descargarlos desde una integración.

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
