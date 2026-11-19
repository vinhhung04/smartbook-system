FROM python:3.12.16-slim-trixie@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

# The reviewed CPU wheel/hash closure targets the production Linux amd64 image.
ARG TARGETARCH
RUN test "$TARGETARCH" = "amd64"

WORKDIR /app

# Chromium system dependencies for CloakBrowser headless rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Bootstrap fixed installation tooling, then install the complete hashed graph.
# Torch uses one explicit official CPU wheel; other dependencies come from PyPI.
COPY requirements.txt requirements-build.lock requirements-linux-amd64-py312.lock ./
RUN python -m pip install --no-cache-dir --default-timeout=120 --retries 10 \
    --require-hashes --only-binary=:all: -r requirements-build.lock \
    && python -m pip install --no-cache-dir --default-timeout=120 --retries 10 \
    --require-hashes --only-binary=:all: -r requirements-linux-amd64-py312.lock \
    && python -m pip check

COPY . .
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --home-dir /app app \
    && mkdir -p /app/.cache/huggingface /app/.cloakbrowser \
    && chown -R app:app /app
ENV HOME=/app HF_HOME=/app/.cache/huggingface XDG_CACHE_HOME=/app/.cache \
    XDG_CONFIG_HOME=/tmp/smartbook-config
USER app

EXPOSE 8000

CMD ["python", "run.py"]
