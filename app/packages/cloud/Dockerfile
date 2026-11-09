FROM docker.io/cloudflare/sandbox:0.13.0-next.751.1

USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip git curl ca-certificates && rm -rf /var/lib/apt/lists/* && mkdir -p /workspace && chown -R 1000:1000 /workspace
USER 1000:1000

WORKDIR /workspace
EXPOSE 8080
