FROM debian:12@sha256:2c037a04925515fdd6ea85ea14a682d0e79931f5e9f5d07b6dbfc6ba12f9e858 AS builder

ARG BITCOIN_BASE_COMMIT=9be056a8a72b624dae9623b2f7bded92c2a21c91
ARG EXPECTED_SOURCE_TREE=45615d4741094a29f50f4fbd2926329cfd67b179
ARG EXPECTED_BITCOIND_SHA256=61a19b62f0a35d3247409f7a975fd6148ab380be741f543f533ede275530fc79

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    ccache \
    cmake \
    curl \
    file \
    git \
    make \
    patch \
    pkg-config \
    python3 \
    rsync \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

RUN git clone https://github.com/bitcoin/bitcoin.git . \
    && git checkout --detach "${BITCOIN_BASE_COMMIT}" \
    && test "$(git rev-parse HEAD)" = "${BITCOIN_BASE_COMMIT}"

COPY patches/ /rzo-patches/

RUN set -eux; \
    test "$(find /rzo-patches -maxdepth 1 -type f -name "*.patch" | wc -l)" -eq 7; \
    for p in /rzo-patches/*.patch; do \
        echo "Applying ${p}"; \
        git apply --index "${p}"; \
    done; \
    ACTUAL_TREE="$(git write-tree)"; \
    echo "Expected source tree: ${EXPECTED_SOURCE_TREE}"; \
    echo "Actual source tree:   ${ACTUAL_TREE}"; \
    test "${ACTUAL_TREE}" = "${EXPECTED_SOURCE_TREE}"

RUN make -C depends \
        HOST=x86_64-pc-linux-gnu \
        NO_QT=1 \
        NO_QR=1 \
        NO_USDT=1 \
        NO_IPC=1

RUN cmake -S . -B build-rzo-fasttemplate-deb12 \
        -DCMAKE_TOOLCHAIN_FILE=/src/depends/x86_64-pc-linux-gnu/toolchain.cmake \
        -DCMAKE_BUILD_TYPE=RelWithDebInfo \
        -DBUILD_GUI=OFF \
        -DBUILD_TESTS=OFF \
        -DBUILD_BENCH=OFF \
        -DBUILD_FOR_FUZZING=OFF \
        -DBUILD_FUZZ_BINARY=OFF \
        -DBUILD_TX=OFF \
        -DBUILD_UTIL=OFF \
        -DBUILD_UTIL_CHAINSTATE=OFF \
        -DBUILD_WALLET_TOOL=OFF \
        -DBUILD_KERNEL_LIB=OFF \
        -DENABLE_WALLET=ON \
        -DENABLE_EXTERNAL_SIGNER=ON \
        -DENABLE_IPC=OFF \
        -DWITH_ZMQ=ON \
        -DWITH_USDT=OFF \
        -DREDUCE_EXPORTS=OFF \
    && cmake --build build-rzo-fasttemplate-deb12 --target bitcoind -j"$(nproc)"

RUN set -eux; \
    ACTUAL="$(sha256sum build-rzo-fasttemplate-deb12/bin/bitcoind | awk "{print \$1}")"; \
    echo "Expected bitcoind SHA256: ${EXPECTED_BITCOIND_SHA256}"; \
    echo "Actual bitcoind SHA256:   ${ACTUAL}"; \
    test "${ACTUAL}" = "${EXPECTED_BITCOIND_SHA256}"

FROM ghcr.io/getumbrel/umbrel-bitcoin:v1.4.0@sha256:13a24256cdd7b1cead36c2e4dcedc699b31fc235a0e4179c8c4527f0c361e6bf

COPY --from=builder /src/build-rzo-fasttemplate-deb12/bin/bitcoind /opt/bitcoind/v31.1/bitcoind
