// Prueba de carga con k6 contra el proxy Nginx.
// Uso (desde la máquina física):
//   k6 run loadtest/k6-test.js
//   k6 run -e BASE_URL=http://localhost:8080 loadtest/k6-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// Cuenta cuántas respuestas dio cada backend, para ver el balanceo en el resumen
const porBackend = {
  backend1: new Counter('respuestas_backend1'),
  backend2: new Counter('respuestas_backend2'),
  backend3: new Counter('respuestas_backend3'),
};

export const options = {
  // Etapas: subida gradual, carga sostenida, pico y bajada
  stages: [
    { duration: '30s', target: 10 },  // calentamiento
    { duration: '1m',  target: 30 },  // carga normal
    { duration: '1m',  target: 60 },  // carga alta
    { duration: '30s', target: 100 }, // pico
    { duration: '30s', target: 0 },   // bajada
  ],
  // Criterios de éxito de la prueba
  thresholds: {
    http_req_failed: ['rate<0.01'],   // menos del 1 % de errores
    http_req_duration: ['p(95)<500'], // el 95 % responde en menos de 500 ms
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const res = http.get(`${BASE_URL}/`);

  check(res, {
    'estado 200': (r) => r.status === 200,
    'responde un backend': (r) => /backend[1-3]/.test(r.body),
  });

  const encontrado = (res.body || '').match(/backend[1-3]/);
  if (encontrado) {
    porBackend[encontrado[0]].add(1);
  }

  sleep(0.5);
}
