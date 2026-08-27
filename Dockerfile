# PM Sample Central, as one container.
#
# WHAT A DOCKERFILE IS. Each instruction below makes one layer of a filesystem
# image. Docker runs them in order, caching each one, and re-runs an instruction
# only when it or anything before it has changed. That caching is the reason the
# instructions are ordered the way they are rather than in the order a person
# would naturally write them: the things that change least often come first.
#
# WHY TWO STAGES. Building the browser application needs Node, npm and about two
# hundred megabytes of packages. Running it needs none of those, only the handful
# of files that come out the other end. The first stage does the building, the
# second copies out the result, and everything the first stage installed is
# thrown away. The image you end up with has no Node in it at all.
#
# WHAT THE FINISHED IMAGE CONTAINS. Python, the API, a SQLite database built at
# image-build time from the synthetic generator, and the compiled front end. It
# needs no network, no database server and no configuration. One port, 8000,
# serves the application and the API from the same origin.


# ---------------------------------------------------------------- stage one
# `AS web` names this stage so the second one can copy out of it. Alpine is a
# very small Linux; for a stage that gets discarded the size hardly matters, but
# it does make this step quicker to pull the first time.
FROM node:22-alpine AS web
WORKDIR /build

# Only the two dependency files, before the source. If a line of Svelte changes,
# these two files have not, so Docker reuses the cached install below instead of
# downloading every package again. Copying the whole directory first would throw
# that cache away on every single edit.
COPY web/package.json web/package-lock.json ./

# `npm ci` would be the stricter choice, and it does not work here. A lock file
# records the platform-specific binaries for the machine that produced it, and
# this one was produced on a Mac: it has no Linux builds of Rollup in it at all,
# so `npm ci` stops rather than resolve anything the lock does not name. That
# refusal is the whole point of the command, so the answer is not to force it.
#
# `npm install` still takes every version number from the lock file. What it
# adds is the handful of packages that can only be chosen once the platform is
# known, which is exactly what has to happen inside the container.
RUN npm install --no-audit --no-fund

# Now the source, which changes constantly.
COPY web/ ./

# The one setting that makes a single-origin container possible. The API client
# falls back to http://localhost:8000 when this is unset, which is right on a
# developer's machine where the two run on separate ports. An empty value makes
# every request relative — /api/graph rather than http://host:8000/api/graph —
# so the application works at whatever address the container ends up on.
ENV VITE_API_BASE=""
RUN npm run build


# ---------------------------------------------------------------- stage two
# The image that actually runs. `slim` is the Debian-based Python without the
# compilers and headers; nothing here needs to build a C extension.
FROM python:3.12-slim

# PYTHONDONTWRITEBYTECODE: no .pyc files, which would only bloat the layer.
# PYTHONUNBUFFERED: print output appears in `docker logs` immediately instead of
# being held in a buffer, which matters the first time something goes wrong.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PMSC_WEB_DIR=/app/web/build

WORKDIR /app

# Dependencies before source, for the same caching reason as above.
COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

# The data pipeline is pure standard library, so the image can make its own
# cohort from the tracked data dictionary rather than carrying a copy of the
# output. That is what makes this image reproducible: the same Dockerfile and
# the same commit give the same numbers, because the generator is seeded.
COPY data/ ./data/
RUN python data/generator/generate.py \
 && python data/builder/build.py --web /tmp/discard

# The API, and the database built from the data above. Seeding at build time
# rather than at startup means a container starts in under a second and cannot
# fail halfway through its first request.
COPY api/ ./api/
RUN cd api && python -m app.seed --force

# The compiled front end, lifted out of the first stage.
COPY --from=web /build/build ./web/build

# Run as somebody other than root. If the application is ever made to write to
# disk, this is the line that stops a mistake in it from being a mistake in the
# whole container.
RUN useradd --create-home --uid 10001 pmsc && chown -R pmsc:pmsc /app
USER pmsc

# Documentation, not a firewall: EXPOSE records which port the process listens
# on. Publishing it to your machine is done with -p when you run the container.
EXPOSE 8000

# Docker asks the application whether it is well, rather than assuming that a
# running process is a working one. /healthz reads a row out of the database, so
# a container that answers it is genuinely serving.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status==200 else 1)"

# 0.0.0.0 rather than 127.0.0.1: inside a container, localhost means the
# container itself, and nothing outside it could connect.
CMD ["uvicorn", "app.main:app", "--app-dir", "api", "--host", "0.0.0.0", "--port", "8000"]
