
import os
import time

from flask import Flask, Response, jsonify, request
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST

app = Flask(__name__)

# Identificador de cada instancia
INSTANCE = os.getenv("INSTANCE", "backend-local")

# Métricas de Prometheus
REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total de solicitudes HTTP recibidas",
    ["backend", "method", "endpoint", "status"]
)

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "Tiempo de respuesta de las solicitudes HTTP",
    ["backend", "method", "endpoint"]
)


# Registrar solicitudes y medir su tiempo de respuesta
@app.before_request
def start_timer():
    request.start_time = time.time()


@app.after_request
def record_metrics(response):
    endpoint = request.url_rule.rule if request.url_rule else "unknown"
    duration = time.time() - getattr(request, "start_time", time.time())

    REQUEST_COUNT.labels(
        INSTANCE,
        request.method,
        endpoint,
        str(response.status_code)
    ).inc()

    REQUEST_LATENCY.labels(
        INSTANCE,
        request.method,
        endpoint
    ).observe(duration)

    return response


# Ruta principal
@app.route("/")
def home():
    return jsonify({
        "message": "Backend funcionando correctamente",
        "instance": INSTANCE
    })


# Verificar el estado del servicio
@app.route("/health")
def health():
    return jsonify({
        "status": "healthy",
        "instance": INSTANCE
    }), 200


# Exponer métricas para Prometheus
@app.route("/metrics")
def metrics():
    return Response(
        generate_latest(),
        mimetype=CONTENT_TYPE_LATEST
    )
