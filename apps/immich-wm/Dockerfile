FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS web
WORKDIR /app
COPY apps/web/package*.json apps/web/
RUN npm ci --prefix apps/web
COPY apps/web/src apps/web/src
COPY apps/immich-wm/web apps/immich-wm/web
WORKDIR /app/apps/immich-wm/web
RUN npm ci && npm run build

FROM public.ecr.aws/docker/library/python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY packages/kari-core packages/kari-core
COPY apps/api apps/api
COPY apps/immich-wm/worker apps/immich-wm/worker
COPY assets/fonts assets/fonts
COPY assets/logos assets/logos
COPY pyproject.toml pyproject.toml
RUN pip install --no-cache-dir -c apps/immich-wm/worker/requirements.lock -e ./packages/kari-core -e ./apps/api -e ./apps/immich-wm/worker \
    && groupadd --gid 10001 imprint && useradd --uid 10001 --gid imprint --no-create-home imprint \
    && mkdir -p /data /output /imports && chown imprint:imprint /data /output
COPY --from=web /app/apps/immich-wm/web/dist /app/web
RUN mkdir -p /app/assets/logos /app/packages/kari-core/config/templates
ENV KARI_IMPRINT_ASSETS_DIR=/app/assets KARI_IMPRINT_ROOT=/app WM_WEB_ROOT=/app/web
RUN chmod -R a+rX /app/assets/logos
USER 10001:10001
EXPOSE 2285
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import json,urllib.request; assert json.load(urllib.request.urlopen('http://127.0.0.1:2285/api/health'))['ok']"
CMD ["immich-wm", "--host", "0.0.0.0"]
