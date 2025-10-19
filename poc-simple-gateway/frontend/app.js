const assetSelect = document.getElementById('asset-select');
const customAssetInput = document.getElementById('custom-asset');
const loadAssetButton = document.getElementById('load-asset');
const amountInput = document.getElementById('amount');
const noteInput = document.getElementById('note');
const recipientInput = document.getElementById('recipient');
const feeDisplay = document.getElementById('fee-display');
const payButton = document.getElementById('pay-button');
const form = document.getElementById('payment-form');
const resultCard = document.getElementById('result-card');
const summary = document.getElementById('summary');
const statusText = document.getElementById('status-text');
const statusBox = document.getElementById('status-box');
const txBox = document.getElementById('tx-box');
const txLink = document.getElementById('tx-link');
const algorandLink = document.getElementById('algorand-link');
const peraLink = document.getElementById('pera-link');
const qrCanvas = document.getElementById('qr-canvas');

const state = {
  assets: [],
  selectedAsset: null,
  fee: null,
  pollTimer: null,
  lastRequest: null
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }
  return response.json();
};

const loadDefaultAssets = async () => {
  try {
    const data = await fetchJson('/api/assets');
    state.assets = data.assets || [];
    renderAssets();
  } catch (error) {
    console.error('Unable to load assets', error);
  }
};

const renderAssets = () => {
  assetSelect.innerHTML = '';
  const selectedId = state.selectedAsset ? Number(state.selectedAsset.id) : null;
  state.assets.forEach((asset, index) => {
    const option = document.createElement('option');
    option.value = String(asset.id);
    option.textContent = `${asset.name} (${asset.unitName})`;
    if (selectedId !== null && Number(asset.id) === selectedId) {
      option.selected = true;
    } else if (selectedId === null && index === 0) {
      option.selected = true;
      state.selectedAsset = asset;
    }
    assetSelect.appendChild(option);
  });
  updateFee();
};

const updateSelectedAsset = () => {
  const selectedId = Number(assetSelect.value);
  const found = state.assets.find((asset) => Number(asset.id) === selectedId);
  if (found) {
    state.selectedAsset = found;
    updateFee();
  }
  togglePayButton();
};

const updateFee = async () => {
  try {
    const data = await fetchJson('/api/transaction-params');
    state.fee = data.minFeeAlgos;
    feeDisplay.textContent = `${state.fee.toFixed(6)} ALGO`;
  } catch (error) {
    feeDisplay.textContent = 'Unavailable';
    console.error('Failed to load fee', error);
  }
};

const togglePayButton = () => {
  const amount = Number(amountInput.value);
  const addressValid = recipientInput.value && recipientInput.value.length > 40;
  const assetSelected = Boolean(state.selectedAsset);
  payButton.disabled = !(amount > 0 && addressValid && assetSelected);
};

const loadCustomAsset = async () => {
  const assetId = Number(customAssetInput.value);
  if (!assetId) {
    return;
  }
  loadAssetButton.disabled = true;
  try {
    const data = await fetchJson(`/api/assets/${assetId}`);
    const existing = state.assets.find((asset) => Number(asset.id) === assetId);
    if (!existing) {
      state.assets.push(data.asset);
    }
    state.selectedAsset = data.asset;
    renderAssets();
    assetSelect.value = String(assetId);
    customAssetInput.value = '';
  } catch (error) {
    alert('Unable to load the requested asset. Please check the ASA id.');
    console.error(error);
  } finally {
    loadAssetButton.disabled = false;
  }
};

const buildPeraLink = (uri) => {
  return `https://perawallet.app?algorand=${encodeURIComponent(uri)}`;
};

const startPolling = (payload) => {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  state.pollTimer = setInterval(async () => {
    try {
      const params = new URLSearchParams({
        recipientAddress: payload.recipientAddress,
        note: payload.note,
        assetId: String(payload.assetId),
        amount: String(payload.amount),
        decimals: String(payload.decimals)
      });
      const result = await fetchJson(`/api/payment-status?${params.toString()}`);
      if (result.status === 'confirmed') {
        statusText.textContent = 'Payment confirmed!';
        statusText.classList.remove('pending');
        statusText.classList.add('confirmed');
        txBox.hidden = false;
        txLink.textContent = result.txId;
        txLink.href = `${payload.txExplorerBaseUrl || 'https://testnet.algoexplorer.io/tx/'}${result.txId}`;
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      } else {
        statusText.textContent = 'Waiting for payment…';
        statusText.classList.add('pending');
        statusText.classList.remove('confirmed');
      }
    } catch (error) {
      console.error('Status polling failed', error);
    }
  }, 5000);
};

const displayResult = (data, request) => {
  resultCard.classList.remove('hidden');
  const unit = state.selectedAsset ? state.selectedAsset.unitName : 'ALGO';
  summary.textContent = `Requesting ${request.amount} ${unit} to ${request.recipientAddress}. Reference note: ${data.note}`;
  statusText.textContent = 'Waiting for payment…';
  statusText.classList.add('pending');
  statusText.classList.remove('confirmed');
  txBox.hidden = true;
  algorandLink.href = data.paymentUri;
  peraLink.href = buildPeraLink(data.paymentUri);

  QRCode.toCanvas(qrCanvas, data.paymentUri, { width: 220 }, (error) => {
    if (error) {
      console.error('Failed to render QR code', error);
    }
  });

  startPolling({
    recipientAddress: request.recipientAddress,
    note: data.note,
    assetId: request.assetId,
    amount: request.amount,
    decimals: request.decimals,
    txExplorerBaseUrl: data.txExplorerBaseUrl
  });
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const assetId = Number(assetSelect.value) || 0;
  const selected = state.assets.find((asset) => Number(asset.id) === assetId);
  const amount = Number(amountInput.value);

  const payload = {
    recipientAddress: recipientInput.value.trim(),
    assetId,
    amount,
    decimals: selected ? Number(selected.decimals || 0) : 0,
    referenceNote: noteInput.value.trim() || undefined
  };

  payButton.disabled = true;
  try {
    const data = await fetchJson('/api/create-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    state.lastRequest = { ...payload };
    displayResult(data, state.lastRequest);
  } catch (error) {
    alert('Unable to generate the payment request. Check the console for details.');
    console.error(error);
  } finally {
    togglePayButton();
  }
});

assetSelect.addEventListener('change', updateSelectedAsset);
amountInput.addEventListener('input', togglePayButton);
recipientInput.addEventListener('input', togglePayButton);
loadAssetButton.addEventListener('click', loadCustomAsset);

loadDefaultAssets();
updateFee();
togglePayButton();
