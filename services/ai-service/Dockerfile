FROM python:3.10-slim

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

# CPU-only torch wheel — installed separately so pip doesn't resolve the
# multi-GB default CUDA build (this service has no GPU access). --extra-index-url
# (not --index-url): torch's own pure-Python deps (typing-extensions, fsspec,
# jinja2, networkx, sympy, filelock) aren't hosted on download.pytorch.org, so
# --index-url alone breaks resolution for those; --extra-index-url still prefers
# the CPU wheel for torch itself while falling back to PyPI for the rest.
RUN pip install --no-cache-dir torch --extra-index-url https://download.pytorch.org/whl/cpu

# Cài đặt các thư viện cần thiết
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]