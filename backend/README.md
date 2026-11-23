# Backend - OS Project

## 1. Descripción

Este módulo corresponde al backend del proyecto OS Project. Está desarrollado en Python utilizando Flask y permite ejecutar múltiples instancias independientes dentro de contenedores Docker.

Su función principal es atender las solicitudes HTTP, identificar cada instancia y exponer métricas de funcionamiento para que Prometheus pueda recopilarlas y monitorear el servicio.

## 2. Tecnologías utilizadas

- Python 3.12
- Flask 3.1
- Gunicorn 23
- Prometheus Client
- Docker

## 3. Estructura del módulo

```text
backend/
├── app.py
├── Dockerfile
├── requirements.txt
└── README.md
```

## 4. Configuración de las instancias

La aplicación utiliza la variable de entorno `INSTANCE` para identificar cada instancia del backend.

El proyecto contempla tres instancias:

- `backend1`
- `backend2`
- `backend3`

Todas utilizan la misma imagen Docker, pero cada una recibe un identificador diferente mediante su variable de entorno.

El servicio escucha en el puerto `5000`.

## 5. Endpoints disponibles

| Endpoint | Método | Descripción |
|---|---|---|
| `/` | GET | Muestra un mensaje de funcionamiento e identifica la instancia que atendió la solicitud. |
| `/health` | GET | Comprueba el estado del servicio y devuelve una respuesta HTTP 200 cuando funciona correctamente. |
| `/metrics` | GET | Expone las métricas de la aplicación en un formato compatible con Prometheus. |

## 6. Métricas implementadas

Se utilizan las siguientes métricas personalizadas mediante la biblioteca `prometheus-client`:

### http_requests_total

Contador que registra la cantidad total de solicitudes HTTP recibidas.

Se clasifica mediante las siguientes etiquetas:

- `backend`: instancia que recibió la solicitud (`backend1`, `backend2` o `backend3`).
- `method`: método HTTP utilizado.
- `endpoint`: ruta solicitada.
- `status`: código de respuesta HTTP.

### http_request_duration_seconds

Histograma que registra el tiempo de respuesta de las solicitudes HTTP, expresado en segundos.

También se exponen métricas automáticas relacionadas con el estado de Python y los recursos del proceso.

## 7. Construcción de la imagen Docker

Desde la carpeta raíz del proyecto, ejecutar:

```bash
docker build -t os-project-backend ./backend
```

Este comando construye la imagen Docker utilizando el Dockerfile y las dependencias definidas en el módulo.

## 8. Ejecución individual de prueba

Para ejecutar una instancia independiente del backend:

```bash
docker run -d --name backend-prueba \
  -p 5000:5000 \
  -e INSTANCE=backend-prueba \
  os-project-backend
```

La aplicación quedará disponible en el puerto `5000`.

## 9. Pruebas de funcionamiento

Para comprobar los endpoints, utilizar los siguientes comandos:

**Ruta principal:**

```bash
curl http://localhost:5000/
```

**Estado del servicio:**

```bash
curl http://localhost:5000/health
```

**Métricas de Prometheus:**

```bash
curl http://localhost:5000/metrics
```

## 10. Ejecución de la aplicación

La aplicación se ejecuta mediante Gunicorn, utilizando un trabajador por contenedor y escuchando en `0.0.0.0:5000`.

La configuración permite que las tres instancias sean ejecutadas independientemente y que sus métricas puedan ser consultadas por Prometheus a través de la red interna del proyecto.
