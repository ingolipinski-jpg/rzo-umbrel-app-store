FROM debian:trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       bash \
       ca-certificates \
       libc6 \
       libgcc-s1 \
       libstdc++6 \
       libcapnp-1.1.0 \
    && rm -rf /var/lib/apt/lists/*

ENV LD_LIBRARY_PATH=/native

CMD ["/bin/bash"]
