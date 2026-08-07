# Deterministic build for Railway/Render (backend service, Root Directory = backend).
# Using an explicit Python base image avoids Nixpacks/Railpack detection issues
# ("pip: not found", "nixpacks exited with an error") entirely.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy the application code.
COPY . .

# Railway/Render inject $PORT at runtime; default to 8000 locally.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
