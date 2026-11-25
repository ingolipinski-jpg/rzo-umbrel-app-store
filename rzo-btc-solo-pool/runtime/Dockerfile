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

COPY --chmod=755 app/para/para-ipc /usr/local/bin/para
COPY --chmod=755 app/native/librzo_mining_ipc.so /native/librzo_mining_ipc.so

ENV LD_LIBRARY_PATH=/native

CMD ["/bin/bash"]
