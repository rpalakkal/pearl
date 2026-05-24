# Pearl Desktop Wallet

A modern, secure desktop wallet application for the Pearl blockchain network. Built with Electron,
React, and TypeScript.

## Prerequisites

- **Go** >= 1.26.1
- **Rust** (stable toolchain) — required to build ZK proof libraries
- **Task** (`go-task`) — task runner for the backend build
- **Node.js** >= 22.0.0
- **pnpm** >= 8.15.6

## Setup

### 1. Build the oyster binary (backend wallet daemon)

The desktop wallet depends on the `oyster` binary from the root pearl repository. Build it from the
repo root:

```bash
# From the pearl repo root
task build:blockchain
```

This compiles all blockchain binaries (including `oyster`) into `pearl/bin/`.

> **Note:** `task build:blockchain` requires Rust (for ZK/XMSS FFI libraries) and CGO. Make sure
> your toolchain is set up before running this.

### 2. Copy oyster to the wallet's bin directory

Copy the compiled binary to `apps/apps/pearl-desktop-wallet/bin/`, renaming it to match your OS and
architecture:

| Platform              | Binary name              |
| --------------------- | ------------------------ |
| macOS (Apple Silicon) | `oyster-darwin-arm64`    |
| macOS (Intel)         | `oyster-darwin-x64`      |
| Linux (x64)           | `oyster-linux-x64`       |
| Windows (x64)         | `oyster-windows-x64.exe` |

**macOS (Apple Silicon):**

```bash
cp bin/oyster apps/apps/pearl-desktop-wallet/bin/oyster-darwin-arm64
```

**macOS (Intel):**

```bash
cp bin/oyster apps/apps/pearl-desktop-wallet/bin/oyster-darwin-x64
```

**Linux:**

```bash
cp bin/oyster apps/apps/pearl-desktop-wallet/bin/oyster-linux-x64
```

**Windows** (PowerShell):

```powershell
Copy-Item bin\oyster.exe apps\apps\pearl-desktop-wallet\bin\oyster-windows-x64.exe
```

### 3. Install frontend dependencies

```bash
# From pearl/apps
cd apps
pnpm install
```

## Development

Run the wallet in development mode (hot-reload):

```bash
# From pearl/apps
pnpm --filter @pearl/pearl-desktop-wallet dev

# Or from pearl/apps/apps/pearl-desktop-wallet
pnpm dev
```

## Building

Build the Electron app:

```bash
# From pearl/apps
pnpm --filter @pearl/pearl-desktop-wallet build

# Or from pearl/apps/apps/pearl-desktop-wallet
pnpm build
```

Build a distributable for your platform:

```bash
# macOS
pnpm build:mac

# Linux
pnpm build:linux

# Windows
pnpm build:win
```

Output is placed in `dist/`.

## Hardware Wallets

The desktop wallet supports Ledger and Trezor hardware accounts for Pearl Taproot funds. Hardware
accounts are derived through the device Bitcoin app on BIP86 paths:

| Network | Path                           |
| ------- | ------------------------------ |
| Mainnet | `m/86'/0'/0'/0/{addressIndex}` |
| Testnet | `m/86'/1'/0'/0/{addressIndex}` |

The address index starts at `0`; selecting index `1`, `2`, and so on derives additional receive
addresses from the same hardware wallet account.

Ledger users must unlock the device and open the Bitcoin app. Trezor users should have Trezor Bridge
or Trezor Suite support available for the device connection, and should allow local network access
on macOS if prompted. Because the devices sign through Bitcoin-family firmware, device screens show
the equivalent Bitcoin Taproot address (`bc1p...` on mainnet or `tb1p...` on testnet). The wallet UI
shows that device-display address alongside the Pearl receive/send address so testers can compare
the same Taproot output key safely.

Run the hardware wallet typecheck, unit tests, and integration-contract tests:

```bash
# From pearl/apps
pnpm --filter @pearl/pearl-desktop-wallet run test:hardware
```

Manual device validation before release:

1. Start the wallet with the desired Pearl network selected.
2. Connect a Ledger, choose Ledger, and confirm the wallet derives a Pearl `prl1p...` or `tprl1p...`
   address.
3. Click Verify Address and confirm the device screen matches the UI's `bc1p...` or `tb1p...`
   device-display address.
4. Switch the address index, connect again, and confirm the derived address and path change while
   the provider and network stay fixed.
5. Fund the Pearl hardware address, refresh the balance, and confirm pending funds are shown but
   excluded from spendable UTXOs until confirmed.
6. Send a small confirmed amount to a Pearl Taproot recipient, confirm the device shows the matching
   Bitcoin-format recipient address, broadcast, and verify the txid on Blockbook.
7. Repeat steps 2-6 with a Trezor.
8. Switch between mainnet and testnet and confirm remembered hardware accounts are scoped to the
   selected network, vendor, and address index.

## Viewing Logs

```bash
# Tail live logs
pnpm logs

# Open logs directory in Finder (macOS)
pnpm logs:open
```

## Project Structure

```
pearl-desktop-wallet/
├── bin/                  # Platform-specific oyster binaries (not committed)
├── src/
│   ├── main/             # Electron main process
│   ├── preload/          # Preload scripts
│   ├── renderer/         # React frontend
│   ├── types/            # Shared TypeScript types
│   └── utils/            # Shared utilities
├── resources/            # Static assets bundled with the app
├── electron.vite.config.ts
├── electron-builder.json
└── package.json
```
