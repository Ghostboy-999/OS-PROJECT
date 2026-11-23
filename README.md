# OS-PROJECT

Proyecto final de Sistemas Operativos: infraestructura en contenedores Docker con un proxy inverso Nginx que balancea la carga entre tres instancias de backend, y un sistema de monitoreo con Prometheus, Grafana, Nginx Prometheus Exporter y cAdvisor.

## Arquitectura

```
                 ┌──────────────── red Docker "infra" ─────────────────┐
 Cliente ──8080──▶ nginx ──┬──▶ backend1:5000 ─┐                        │
                 │         ├──▶ backend2:5000 ─┼──/metrics──┐           │
                 │         └──▶ backend3:5000 ─┘            │           │
                 │   :8081/stub_status ◀── nginx-exporter ──┤           │
                 │   contenedores      ◀── cadvisor ────────┤           │
                 │                                          ▼           │
 Navegador ─9090─▶                                     prometheus ◀── grafana ◀─3000── Navegador
                 └──────────────────────────────────────────────────────┘
```

| Servicio | Imagen | Función | Puerto en el host |
|---|---|---|---|
| `nginx` | `nginx:1.27-alpine` | Proxy inverso y balanceo de carga (Round Robin) hacia los backends | 8080 |
| `backend1`, `backend2`, `backend3` | construida desde `./backend` | Aplicación Flask. Responde con su nombre y expone `/health` y `/metrics` | no expuestos |
| `nginx-exporter` | `nginx/nginx-prometheus-exporter:1.4.0` | Lee `http://nginx:8081/stub_status` y lo convierte en métricas | no expuesto |
| `cadvisor` | `ghcr.io/google/cadvisor:0.55.1` | Métricas de CPU, memoria, red y disco de cada contenedor | no expuesto |
| `prometheus` | `prom/prometheus:v3.5.0` | Recolecta las métricas cada 5 segundos | 9090 |
| `grafana` | `grafana/grafana:12.0.0` | Dashboards con latencia, tasa de solicitudes y uso de recursos | 3000 |

- Todos los servicios están en la red personalizada `infra`.
- Solo Nginx, Prometheus y Grafana publican puertos. Los backends solo son accesibles a través de Nginx.
- El `stub_status` de Nginx escucha en el puerto interno 8081, que no se publica.
- Los datos de Prometheus y Grafana se guardan en los volúmenes `prometheus_data` y `grafana_data`.

## Estructura del repositorio

```
OS-PROJECT/
├── docker-compose.yml        # definición de todos los servicios, red y volúmenes
├── README.md
├── backend/
│   ├── Dockerfile            # imagen del backend (Python 3.12 + Gunicorn)
│   ├── app.py                # aplicación Flask con métricas de Prometheus
│   └── requirements.txt
├── nginx/
│   └── nginx.conf            # proxy inverso, balanceo y stub_status
├── prometheus/
│   └── prometheus.yml        # targets que recolecta Prometheus
├── grafana/
│   └── provisioning/
│       ├── datasources/
│       │   └── datasource.yml        # conexión de Grafana con Prometheus
│       └── dashboards/
│           ├── dashboards.yml        # le dice a Grafana dónde están los dashboards
│           └── infraestructura.json  # dashboard principal
└── loadtest/
    └── k6-test.js            # prueba de carga
```

## Requisitos previos

- Docker Engine con el plugin de Docker Compose v2 (`docker compose version`).
- Git.
- Al menos 4 GB de RAM y 2 CPU para la máquina donde corre Docker.
- Los puertos 8080, 9090 y 3000 libres.
- [k6](https://k6.io/) en la máquina física para la prueba de carga (ver la sección [6. Prueba de carga](#6-prueba-de-carga)).

### Si Docker corre en una máquina virtual de VirtualBox

Para entrar desde el navegador de la máquina física, agrega estas reglas en **Configuración → Red → Adaptador 1 (NAT) → Avanzado → Reenvío de puertos**:

| Nombre | Puerto anfitrión | Puerto invitado |
|---|---|---|
| nginx | 8080 | 8080 |
| prometheus | 9090 | 9090 |
| grafana | 3000 | 3000 |

El puerto invitado es 8080 (no 80) porque la máquina virtual recibe el tráfico en el 8080 y Docker lo envía al puerto 80 de Nginx.

También se pueden crear desde PowerShell en Windows, con la máquina virtual encendida (cambiar `"Nombre de la VM"` por el nombre que aparece en VirtualBox):

```powershell
$vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
& $vb controlvm "Nombre de la VM" natpf1 "nginx,tcp,,8080,,8080"
& $vb controlvm "Nombre de la VM" natpf1 "grafana,tcp,,3000,,3000"
& $vb controlvm "Nombre de la VM" natpf1 "prometheus,tcp,,9090,,9090"
```

Para comprobar que funcionan, abrir http://localhost:8080 en el navegador de Windows (no en el de la máquina virtual). En PowerShell, `netstat -ano | findstr ":8080 :3000 :9090"` debe mostrar los tres puertos en estado `LISTENING`.

## 1. Levantar la infraestructura

```bash
git clone https://github.com/Ghostboy-999/OS-PROJECT.git
cd OS-PROJECT
docker compose up -d --build
```

La primera vez tarda unos minutos porque descarga las imágenes.

Comprobar el estado:

```bash
docker compose ps
```

Deben aparecer los contenedores `backend1`, `backend2`, `backend3` (en estado `healthy`), `nginx`, `nginx-exporter`, `cadvisor`, `prometheus` y `grafana`. Nginx solo arranca cuando los tres backends están sanos.

## 2. URLs de acceso

| Servicio | URL |
|---|---|
| Aplicación (a través de Nginx) | http://localhost:8080 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 (usuario `admin`, contraseña `admin`) |

## 3. Verificar el balanceo de carga

Cada respuesta indica qué backend la atendió:

```bash
curl -s localhost:8080
# {"instance":"backend1","message":"Backend funcionando correctamente"}
```

Contar 30 peticiones:

```bash
for i in $(seq 1 30); do curl -s localhost:8080 | grep -o "backend[0-9]"; done | sort | uniq -c
```

Resultado esperado (Round Robin):

```
     10 backend1
     10 backend2
     10 backend3
```

Ver qué backend respondió en las cabeceras (Nginx agrega `X-Upstream` con su IP):

```bash
curl -sI localhost:8080 | grep -i x-upstream
```

Ver el registro de Nginx, donde `upstream=` muestra a qué backend se envió cada petición:

```bash
docker compose logs --tail 10 nginx
```

Los backends no son accesibles directamente desde fuera de la red de Docker: todo el tráfico pasa por Nginx.

### Tolerancia a fallos

Apagar un backend y comprobar que el servicio sigue respondiendo con los otros dos:

```bash
docker compose stop backend2
for i in $(seq 1 6); do curl -s localhost:8080 | grep -o "backend[0-9]"; done | sort | uniq -c
docker compose start backend2
```

## 4. Verificar el monitoreo con Prometheus

Abrir http://localhost:9090 → **Status → Target health**. Todos los targets deben estar en **UP**:

| Job | Targets |
|---|---|
| `backends` | `backend1:5000`, `backend2:5000`, `backend3:5000` |
| `nginx` | `nginx-exporter:9113` |
| `cadvisor` | `cadvisor:8080` |
| `prometheus` | `localhost:9090` |

Consultas de ejemplo en la pestaña **Query**:

| Qué muestra | Consulta |
|---|---|
| Total de peticiones por backend | `http_requests_total{endpoint="/"}` |
| Tasa de peticiones por segundo por backend | `sum by (backend) (rate(http_requests_total{endpoint="/"}[1m]))` |
| Latencia p95 por backend (segundos) | `histogram_quantile(0.95, sum by (le, backend) (rate(http_request_duration_seconds_bucket{endpoint="/"}[1m])))` |
| Conexiones activas en Nginx | `nginx_connections_active` |
| Peticiones por segundo en Nginx | `rate(nginx_http_requests_total[1m])` |
| Memoria de cada backend | `container_memory_usage_bytes{name=~"backend.*"}` |
| CPU de cada contenedor | `rate(container_cpu_usage_seconds_total{name=~".+"}[1m])` |

Las métricas del backend también cuentan las peticiones a `/metrics` (de Prometheus) y a `/health` (del healthcheck); por eso las consultas filtran con `endpoint="/"`.

## 5. Dashboards en Grafana

Abrir http://localhost:3000 (usuario `admin`, contraseña `admin`). No hace falta configurar nada: el datasource de Prometheus y el dashboard **OS-PROJECT · Infraestructura** se cargan automáticamente desde `grafana/provisioning` y el dashboard aparece como página de inicio. Se actualiza cada 5 segundos.

| Sección | Paneles |
|---|---|
| Resumen | solicitudes por segundo, latencia p95, errores 5xx, backends activos |
| Aplicación | tasa de solicitudes por backend, latencia p50 y p95 por backend, solicitudes por código de estado, latencia promedio |
| Nginx | conexiones (activas, leyendo, escribiendo, esperando), solicitudes y conexiones aceptadas por segundo |
| Contenedores | CPU, memoria, red y disco de cada contenedor (cAdvisor) |

## 6. Prueba de carga

La prueba se ejecuta desde la máquina física (no desde la máquina virtual), con la infraestructura en marcha y el puerto 8080 accesible desde el navegador.

### Instalar k6

| Sistema | Instalación |
|---|---|
| Windows | `winget install k6 --source winget` |
| Windows sin instalador | Descargar `k6-vX.Y.Z-windows-amd64.zip` desde [las versiones de k6](https://github.com/grafana/k6/releases), descomprimirlo y usar `k6.exe` directamente |
| Linux / macOS | Ver la [guía de instalación de k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) |

Comprobar con `k6 version` (o `.\k6.exe version` si se usa la versión portable).

### Ejecutar la prueba

Desde la carpeta del repositorio:

```bash
k6 run loadtest/k6-test.js
```

Con la versión portable de Windows, desde la carpeta donde está `k6.exe` (copiar ahí `loadtest/k6-test.js`):

```powershell
.\k6.exe run k6-test.js
```

Si Docker corre en otra máquina, indicar la dirección:

```bash
k6 run -e BASE_URL=http://IP_DEL_SERVIDOR:8080 loadtest/k6-test.js
```

La prueba dura 3 min 30 s y tiene cinco etapas:

| Etapa | Duración | Usuarios virtuales |
|---|---|---|
| Calentamiento | 30 s | 0 → 10 |
| Carga normal | 1 min | 10 → 30 |
| Carga alta | 1 min | 30 → 60 |
| Pico | 30 s | 60 → 100 |
| Bajada | 30 s | 100 → 0 |

Criterios de éxito (*thresholds*): menos del 1 % de errores (`http_req_failed`) y el 95 % de las respuestas en menos de 500 ms (`http_req_duration p(95)`).

Mientras corre la prueba, observar en Grafana cómo suben la tasa de solicitudes, la latencia, las conexiones de Nginx y el uso de CPU. Al terminar, k6 muestra un resumen con `http_req_duration` (avg, p90, p95, p99), `http_req_failed`, `checks` y los contadores `respuestas_backend1`, `respuestas_backend2` y `respuestas_backend3`, que muestran cómo se repartió la carga.

Recomendaciones:

- Abrir Grafana antes de empezar y dejar el rango en **Last 15 minutes** para ver la prueba completa.
- Si todas las peticiones fallan con `connection refused` / `actively refused it`, el puerto 8080 no llega a la máquina física: revisar el reenvío de puertos de VirtualBox.

### Resultados de referencia

Prueba ejecutada desde Windows contra la infraestructura en una máquina virtual de VirtualBox (máximo 100 usuarios virtuales):

| Métrica | Resultado |
|---|---|
| Peticiones totales | 15 482 (≈ 73,6 por segundo; pico ≈ 145 por segundo) |
| Errores (`http_req_failed`) | 0,00 % |
| Latencia mediana / p95 / p99 | 4,34 ms / 14,43 ms / 33,73 ms |
| Reparto por backend | 5 158 / 5 162 / 5 162 (≈ 33 % cada uno) |
| CPU máxima por backend | < 10 % |
| Memoria por backend | ≈ 27–55 MiB |
| Conexiones activas máximas en Nginx | 101 |

Los dos *thresholds* se cumplieron. La latencia que mide k6 (≈ 14 ms en p95) es mayor que la que mide el backend (< 5 ms) porque k6 incluye todo el recorrido: Windows → NAT de VirtualBox → Docker → Nginx → backend.

## Comandos útiles

| Acción | Comando |
|---|---|
| Ver el estado | `docker compose ps` |
| Ver los logs de un servicio | `docker compose logs -f nginx` |
| Reconstruir tras cambiar el backend | `docker compose up -d --build` |
| Validar la configuración de Nginx | `docker compose exec nginx nginx -t` |
| Recargar Nginx sin detenerlo | `docker compose exec nginx nginx -s reload` |
| Reiniciar un servicio | `docker compose restart prometheus` |

## Solución de problemas

| Problema | Solución |
|---|---|
| `port is already allocated` | Otro contenedor usa el puerto (por ejemplo, un laboratorio anterior). Detenerlo con `docker compose down` en su carpeta, o cambiar el puerto en `docker-compose.yml`. |
| Nginx no arranca | Revisar que los backends estén `healthy` (`docker compose ps`) y ver `docker compose logs nginx`. |
| Un target aparece DOWN en Prometheus | Ver los logs de ese servicio, por ejemplo `docker compose logs nginx-exporter`. |
| Desde Windows, `localhost:8080` da `ERR_CONNECTION_REFUSED` | Falta el reenvío de puertos o no está activo. Revisar con `VBoxManage showvminfo "Nombre de la VM" \| findstr /i "Rule"` y volver a crear las reglas (ver *Requisitos previos*). |
| `winget` falla con un error de certificado | La red (por ejemplo, la de la universidad) bloquea la descarga. Usar la versión portable de k6 descargada por otro medio. |
| Grafana muestra *No data* en la latencia | No hay tráfico en ese momento. Abrir http://localhost:8080 varias veces o ejecutar la prueba de carga. |
| cAdvisor no muestra contenedores | Usar una versión reciente de cAdvisor (0.54 o superior) con Docker 29. Ver `docker compose logs cadvisor`. |

## Detener la infraestructura

```bash
docker compose down
```

Para borrar también los datos de Prometheus y Grafana:

```bash
docker compose down -v
```
