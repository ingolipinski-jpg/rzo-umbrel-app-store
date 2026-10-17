# RZO Core build

RZO Core is based on Bitcoin Core v31.1 plus seven RZO FastTemplate/FastJob patches.

Reference source:
- Bitcoin Core v31.1
- Base commit: 9be056a8a72b624dae9623b2f7bded92c2a21c91
- RZO source head: 51ffea2cf1442cc2d705c4f45a2cf1bce29d177a
- Patch count: 7

Reference production binary:
- SHA256: 61a19b62f0a35d3247409f7a975fd6148ab380be741f543f533ede275530fc79
- x86_64
- Debian 12 / GCC 12.2.0 build environment
- CMake RelWithDebInfo
- ZMQ enabled
- wallet enabled
- GUI/tests/bench/fuzz disabled
- IPC and USDT disabled

The runtime image is derived from the pinned Umbrel Bitcoin image.
Runtime credentials and node data are never stored in this repository.
