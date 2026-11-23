
FROM python:3.12-slim

WORKDIR /app

# Copiar e instalar las dependencias
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código de la aplicación
COPY app.py .

# Exponer el puerto del backend
EXPOSE 5000

# Ejecutar Flask mediante Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "app:app"]

