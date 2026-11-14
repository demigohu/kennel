# kennel contract

Launchpad, bonding curve, ledger, leash/bark/snipe rules, social posts and graduation into Rhea. Deployed at `kennel.testnet`. See the [root README](../../README.md).

```sh
(cd ../token && cargo near build non-reproducible-wasm)   # embedded via include_bytes!
cargo near build non-reproducible-wasm
cargo test            # 19 unit tests + sandbox integration test (real Rhea + wNEAR wasm)
```
