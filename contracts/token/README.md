# token contract

NEP-141 deployed by `kennel.testnet` at `<symbol>.kennel.testnet` for every litter. The whole supply is minted to kennel, which is the only account that can `burn` (used when a trick fails). See the [root README](../../README.md).

```sh
cargo near build non-reproducible-wasm
cargo test
```
