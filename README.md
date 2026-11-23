# OS-PROJECT

Proyecto final de Sistemas Operativos: infraestructura en contenedores Docker con un proxy inverso Nginx que balancea la carga entre tres instancias de backend, y un sistema de monitoreo con Prometheus, Grafana, Nginx Prometheus Exporter y cAdvisor.

## Arquitectura

| Servicio | Función | Puerto en el host |
|---|---|---|
| `nginx` | Proxy inverso y balanceo de carga (Round Robin) hacia los backends | 8080 |
| `backend1`, `backend2`, `backend3` | Aplicación web (Python + Flask). Cada instancia muestra su número y expone `/metrics` | no expuestos |
| `nginx-exporter` | Lee el `stub_status` de Nginx y lo convierte en métricas para Prometheus | no expuesto |
| `cadvisor` | Métricas de CPU, memoria, red y disco de cada contenedor | no expuesto |
| `prometheus` | Recolecta las métricas de backends, exportador y cAdvisor | 9090 |
| `grafana` | Dashboards con latencia, tasa de solicitudes y uso de recursos | 3000 |

Todos los servicios están en la red personalizada `infra`. Solo Nginx, Prometheus y Grafana publican puertos; los backends solo son accesibles a través de Nginx.

Los datos de Prometheus y Grafana se guardan en los volúmenes `prometheus_data` y `grafana_data`.

## Estructura del repositorio

```
OS-PROJECT/
├── docker-compose.yml
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── app.py
│   └── requirements.txt
├── nginx/
│   └── nginx.conf
├── prometheus/
│   └── prometheus.yml
├── grafana/
│   └── provisioning/
│       ├── datasources/
│       └── dashboards/
└── loadtest/
    └── k6-test.js
```

## Requisitos previos

- Docker Engine con el plugin de Docker Compose v2 (`docker compose version`).
- Git.
- Al menos 4 GB de RAM y 2 CPU para la máquina donde corre Docker.
- [k6](https://k6.io/) instalado en la máquina física para la prueba de carga. En Windows: `winget install k6 --source winget`.

### Si Docker corre en una máquina virtual de VirtualBox

Para entrar desde el navegador de la máquina física, agrega estas reglas en **Configuración → Red → Adaptador 1 (NAT) → Avanzado → Reenvío de puertos**:

| Nombre | Puerto anfitrión | Puerto invitado |
|---|---|---|
| nginx | 8080 | 8080 |
| prometheus | 9090 | 9090 |
| grafana | 3000 | 3000 |

## Cómo levantar la infraestructura

```bash
git clone https://github.com/Ghostboy-999/OS-PROJECT.git
cd OS-PROJECT
docker compose up -d --build
```

Comprobar que todos los contenedores estén arriba:

```bash
docker compose ps
```

Los tres backends deben aparecer como `(healthy)`.

## URLs de acceso

| Servicio | URL |
|---|---|
| Aplicación (a través de Nginx) | http://localhost:8080 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 (usuario `admin`, contraseña `admin`) |

## Verificar el balanceo de carga

Refrescar varias veces http://localhost:8080 en el navegador: el número de instancia cambia.

Desde la terminal, contar 30 peticiones:

```bash
for i in $(seq 1 30); do curl -s localhost:8080 | grep -o "[Ii]nstancia [0-9]"; done | sort | uniq -c
```

Resultado esperado (Round Robin):

```
     10 Instancia 1
     10 Instancia 2
     10 Instancia 3
```

Los backends no son accesibles directamente desde fuera de la red de Docker; todo el tráfico pasa por Nginx.

## Verificar el monitoreo

1. **Prometheus:** abrir http://localhost:9090 → **Status → Targets**. Todos los targets (`backends`, `nginx`, `cadvisor`, `prometheus`) deben estar en estado **UP**.
2. **Grafana:** abrir http://localhost:3000. El datasource de Prometheus se carga automáticamente desde `grafana/provisioning`. El dashboard muestra:
   - tasa de solicitudes por instancia,
   - latencia (percentiles p50 y p95),
   - conexiones y peticiones de Nginx,
   - uso de CPU, memoria y red de cada contenedor.

## Prueba de carga

Desde la máquina física, con la infraestructura en marcha:

```bash
k6 run loadtest/k6-test.js
```

Mientras corre la prueba, observar en Grafana cómo suben la tasa de solicitudes, la latencia y el uso de CPU. Al terminar, k6 muestra un resumen con `http_req_duration` (p90, p95) y `http_req_failed`.

## Detener la infraestructura

```bash
docker compose down
```

Para borrar también los datos de Prometheus y Grafana:

```bash
docker compose down -v
```
