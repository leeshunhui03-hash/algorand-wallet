# Algorand Payment Gateway Proof of Concept

This directory contains a lightweight payment gateway that mirrors the core ideas behind the wallet's gateway builder. It uses:

- **HTML/CSS** for the UI (`frontend/`).
- **Node.js + Express** for a tiny backend (`server/index.js`).
- **Algorand SDK** and **axios** (via the SDK internals) to fetch suggested params, build payment links, and poll the indexer.
- **Secure credentials** in `secure/credentials.json` (ignored by git) so API keys and endpoints can be rotated easily.

The flow allows a payer to select ALGO or any ASA, enter an amount, generate an `algorand://` payment request + QR code, and watch for settlement by polling the indexer in real time.

## Getting started

1. **Install dependencies**

   ```bash
   cd poc-simple-gateway
   npm install
   ```

2. **Configure endpoints and API keys**

   ```bash
   cp secure/credentials.example.json secure/credentials.json
   # edit secure/credentials.json with your Algod + Indexer hosts and API tokens
   ```

   The example file is pre-filled with Algonode public TestNet endpoints. Replace them if you want to use a different network or provider.

3. **Run the server**

   ```bash
   npm start
   ```

   The app listens on port `4000` by default. Visit `http://localhost:4000` to open the UI.

## How it works

1. The backend reads the secure credentials and instantiates Algod + Indexer clients.
2. The frontend loads the default asset list and suggested transaction params to display the current network fee.
3. When "Generate Payment Request" is clicked, the backend returns an `algorand://` URI that encodes the destination, amount, asset id, note, and fee. A QR code is rendered for scanners, and deep links allow opening the request in compatible wallets.
4. The frontend polls `/api/payment-status` every five seconds, using the unique note value to look up confirmed transactions sent to the merchant address. Once found, the UI flips to a success state and surfaces the transaction id.

Because the server holds the credentials, API keys never reach the browser, satisfying basic security best practices for shared deployments.

## Folder structure

```
poc-simple-gateway/
├── frontend/          # HTML, CSS, and client-side JS
├── server/            # Express server with Algorand integrations
├── secure/            # Credentials store (example provided, real file gitignored)
└── package.json       # Node project definition
```

Feel free to expand this proof of concept with persistence, custom branding, or WalletConnect integrations as needed.
