# multidrive-upload

Un cargador de archivos por línea de comandos para MultiDrive, escrito en Go solo con la biblioteca estándar. Envía los
archivos por el endpoint de clave de API, `POST /api/v1/uploads`, así que no necesita iniciar sesión: crea una clave en
**API Keys** dentro de la aplicación web.

> Traducción de [README.md](README.md). Si hay diferencias, manda la versión en inglés.

## Compilar

```bash
cd cli
go build -o multidrive-upload ./cmd/multidrive-upload
```

Go 1.24 o superior.

## Uso

```bash
export MULTIDRIVE_API_KEY=9d_live_...        # nunca pases la clave como argumento: los argumentos se ven en `ps`
./multidrive-upload --url https://drive.example.com ./photos ./report.pdf
```

Las opciones van **antes** de los archivos y carpetas:

| Opción | Por defecto | |
|---|---|---|
| `--url` | obligatoria | URL base de MultiDrive. El CLI agrega `/api/v1/uploads`. |
| `--folder-id` | raíz | Sube a una carpeta existente. Toma su id desde la aplicación. |
| `--concurrency` | 3 | Solicitudes enviadas al mismo tiempo, de 1 a 10. |
| `--max-bytes` | 5 GiB | Omite los archivos más grandes que este valor. Debe coincidir con `MAX_UPLOAD_BYTES` del servidor. |
| `--dry-run` | desactivado | Lista lo que se subiría. No envía nada y no necesita clave. |

Las carpetas se recorren de forma recursiva. Los archivos se envían en solicitudes de 25 como máximo y se leen del disco
en streaming, así que la memoria no crece con el tamaño del archivo. Ctrl+C detiene la ejecución.

## Qué imprime y qué devuelve

Una línea por archivo (`ok nombre` o `FAIL nombre: CODE mensaje`) y un resumen:
`uploaded 3, failed 1, skipped 0, not sent 0`. La clave nunca se imprime. Los mensajes de salida se mantienen en inglés.

| Código de salida | Significado |
|---|---|
| 0 | Se subió todo lo pedido. |
| 1 | Un archivo falló, no se envió, o se omitió un archivo demasiado grande o vacío. |
| 2 | La línea de comandos es incorrecta o una ruta no existe. No se envió nada. |

Una clave incorrecta o sin autorización detiene la ejecución en la primera solicitud; el resto se cuenta como `not sent`.

## Límites que conviene conocer

- **Las carpetas no se recrean.** Una clave de API no puede crear carpetas (`POST /folders` necesita un token de sesión),
  así que los archivos van a la raíz o a una carpeta que ya existe (`--folder-id`).
- **Los archivos vacíos se omiten.** `POST /uploads` rechaza un tamaño de 0.
- **Los enlaces simbólicos y los archivos especiales se omiten** y se informan, para no seguir nunca un bucle de enlaces ni
  un enlace a un archivo fuera de la carpeta.
- **Sin reintentos.** El servidor no deduplica, así que repetir una subida crearía una copia. Vuelve a ejecutar solo lo
  que figura como fallido.
- Sin tiempo límite global: una subida puede tardar horas.

## Pruebas

```bash
cd cli
go vet ./... && go test -race ./...          # pruebas unitarias, sin red
```

La prueba de extremo a extremo ejecuta el binario real contra el backend real del stack docker aislado de `../e2e`:

```bash
cd e2e && npm run stack:up
cd ../cli && go test -tags e2e ./e2e
```

Ese stack no tiene cuenta de Drive, así que no se guarda ningún archivo: la prueba comprueba que el servidor acepta la
clave, el cuerpo multipart, `filesMeta` y el id de carpeta (responde `NO_ACCOUNT_WITH_ENOUGH_SPACE` por cada archivo) y
que una clave incorrecta o revocada es rechazada. No puede comprobar que el `sizeBytes` declarado sea exacto, porque el
servidor solo cuenta los bytes cuando una cuenta de almacenamiento recibe el archivo. El registro de usuarios tiene un
límite de 10 por hora por proceso del backend; esta prueba usa 1.
