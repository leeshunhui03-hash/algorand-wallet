const express = require('express');
const path = require('path');
const fs = require('fs');
const algosdk = require('algosdk');

const app = express();
const PORT = process.env.PORT || 4000;

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const CREDENTIALS_PATH = path.join(__dirname, '..', 'secure', 'credentials.json');

let credentials;
try {
  const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  credentials = JSON.parse(raw);
} catch (error) {
  console.error('Unable to read secure/credentials.json. Copy secure/credentials.example.json and fill in your endpoints.');
  throw error;
}

const defaultAssets = credentials.defaultAssets || [
  {
    id: 0,
    name: 'Algorand',
    unitName: 'ALGO',
    decimals: 6
  }
];

const algodCfg = credentials.algod || {};
const indexerCfg = credentials.indexer || {};

const algodClient = new algosdk.Algodv2(
  algodCfg.token || '',
  algodCfg.url,
  algodCfg.port || ''
);

const indexerClient = new algosdk.Indexer(
  indexerCfg.token || '',
  indexerCfg.url,
  indexerCfg.port || ''
);

app.use(express.json());
app.use(express.static(FRONTEND_DIR));

const ensureAmount = (amount) => {
  if (typeof amount === 'string') {
    return Number(amount);
  }
  return amount;
};

const buildPaymentUri = ({ recipient, amount, assetId, decimals, note, fee }) => {
  const params = new URLSearchParams();
  const baseAmount = assetId === 0
    ? Math.round(amount * 1e6)
    : Math.round(amount * 10 ** decimals);

  if (Number.isNaN(baseAmount) || baseAmount <= 0) {
    throw new Error('Amount must be greater than zero.');
  }

  params.set('amount', baseAmount.toString());
  if (assetId && assetId !== 0) {
    params.set('asset', assetId.toString());
  }

  if (note) {
    params.set('note', Buffer.from(note, 'utf8').toString('base64'));
  }

  if (fee) {
    params.set('fee', String(fee));
  }

  return `algorand://${recipient}?${params.toString()}`;
};

app.get('/api/assets', (req, res) => {
  res.json({ assets: defaultAssets });
});

app.get('/api/assets/:id', async (req, res) => {
  const assetId = Number(req.params.id);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    return res.status(400).json({ message: 'Asset id must be a positive integer.' });
  }

  try {
    const response = await indexerClient.lookupAssetByID(assetId).do();
    const params = response.asset.params;
    return res.json({
      asset: {
        id: assetId,
        name: params.name || `ASA ${assetId}`,
        unitName: params['unit-name'] || 'ASA',
        decimals: params.decimals ?? 0,
        url: params.url || ''
      }
    });
  } catch (error) {
    console.error('Failed to fetch ASA metadata', error);
    return res.status(500).json({ message: 'Unable to fetch asset metadata. Check the asset id and indexer credentials.' });
  }
});

app.get('/api/transaction-params', async (req, res) => {
  try {
    const params = await algodClient.getTransactionParams().do();
    return res.json({
      params,
      minFeeMicroalgos: params['min-fee'],
      minFeeAlgos: algosdk.microalgosToAlgos(params['min-fee'])
    });
  } catch (error) {
    console.error('Failed to load suggested params', error);
    return res.status(500).json({ message: 'Unable to load network fees. Check Algod credentials.' });
  }
});

app.post('/api/create-payment', async (req, res) => {
  try {
    const {
      recipientAddress,
      assetId,
      amount,
      decimals,
      referenceNote
    } = req.body;

    if (!recipientAddress) {
      return res.status(400).json({ message: 'Recipient address is required.' });
    }

    const normalizedAmount = ensureAmount(amount);
    if (!normalizedAmount || Number.isNaN(normalizedAmount) || normalizedAmount <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than zero.' });
    }

    const note = referenceNote || `donation-${Date.now()}`;
    const suggestedParams = await algodClient.getTransactionParams().do();
    const fee = suggestedParams['min-fee'];
    const uri = buildPaymentUri({
      recipient: recipientAddress,
      amount: normalizedAmount,
      assetId,
      decimals,
      note,
      fee
    });

    return res.json({
      paymentUri: uri,
      note,
      encodedNote: Buffer.from(note, 'utf8').toString('base64'),
      feeMicroalgos: fee,
      feeAlgos: algosdk.microalgosToAlgos(fee),
      amount: normalizedAmount,
      assetId,
      decimals,
      explorerUrl: assetId && assetId !== 0
        ? `${indexerCfg.explorerBaseUrl || 'https://testnet.algoexplorer.io/asset/'}${assetId}`
        : `${indexerCfg.explorerBaseUrl || 'https://testnet.algoexplorer.io/address/'}${recipientAddress}`,
      txExplorerBaseUrl: indexerCfg.txExplorerBaseUrl || 'https://testnet.algoexplorer.io/tx/'
    });
  } catch (error) {
    console.error('Failed to create payment request', error);
    return res.status(500).json({ message: 'Unable to generate payment request.' });
  }
});

app.get('/api/payment-status', async (req, res) => {
  const { recipientAddress, note, assetId, amount, decimals } = req.query;

  if (!recipientAddress || !note) {
    return res.status(400).json({ message: 'Recipient and note are required.' });
  }

  const assetIdentifier = Number(assetId) || 0;
  const expectedAmount = Number(amount) || 0;
  const assetDecimals = Number(decimals) || 0;

  try {
    const baseAmount = assetIdentifier === 0
      ? Math.round(expectedAmount * 1e6)
      : Math.round(expectedAmount * 10 ** assetDecimals);

    const lookup = indexerClient
      .lookupAccountTransactions(recipientAddress)
      .notePrefix(Buffer.from(note, 'utf8'))
      .limit(20);

    if (assetIdentifier === 0) {
      lookup.txType('pay');
    } else {
      lookup.txType('axfer');
    }

    const results = await lookup.do();
    const transactions = results.transactions || [];

    const match = transactions.find((txn) => {
      if (!txn || !txn['confirmed-round']) {
        return false;
      }

      if (assetIdentifier === 0) {
        const payment = txn['payment-transaction'];
        return payment && payment.receiver === recipientAddress && payment.amount >= baseAmount;
      }

      const transfer = txn['asset-transfer-transaction'];
      return (
        transfer &&
        transfer.receiver === recipientAddress &&
        Number(transfer.amount) >= baseAmount &&
        Number(transfer['asset-id']) === assetIdentifier
      );
    });

    if (match) {
      return res.json({
        status: 'confirmed',
        txId: match.id,
        confirmedRound: match['confirmed-round']
      });
    }

    return res.json({ status: 'pending' });
  } catch (error) {
    console.error('Failed to query payment status', error);
    return res.status(500).json({ message: 'Unable to query transaction status.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Algorand payment gateway PoC listening on port ${PORT}`);
});
