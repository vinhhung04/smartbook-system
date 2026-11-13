# Thử nghiệm Scrapling cho Fahasa - image riêng, KHÔNG dùng cho ai-service production.
FROM python:3.10-slim

# Scrapling 0.5.1 (BSD-3). `scrapling install` tải Chromium của Playwright/Patchright
# kèm thư viện hệ thống cần thiết. Node driver của Playwright cần libatomic1,
# image slim không có sẵn.
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/*
# playwright<1.65: patchright 1.64.x tìm Chromium của Playwright 1.64; để pip kéo 1.65
# thì `scrapling install` tải bản Chromium khác và StealthyFetcher báo thiếu executable.
RUN pip install --no-cache-dir "scrapling[fetchers]==0.5.1" "playwright<1.65" \
    && scrapling install

WORKDIR /probe
COPY probe.py .

ENTRYPOINT ["python", "-I", "probe.py"]
