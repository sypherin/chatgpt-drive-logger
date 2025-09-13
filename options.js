const cidEl = document.getElementById('cid');
const statusEl = document.getElementById('status');
const secretEl = document.getElementById('secret');
const redirectEl = document.getElementById('redirect');
const copyBtn = document.getElementById('copyRedirect');

function setStatus(msg, ok=true) {
  statusEl.textContent = msg;
  statusEl.className = 'row status ' + (ok ? 'ok' : 'err');
}

async function getPort() {
  return chrome.runtime.connect({ name: 'driveLoggerPort' });
}

document.addEventListener('DOMContentLoaded', async () => {
  const uri = chrome.identity.getRedirectURL('oauth2');
  redirectEl.textContent = uri;
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      setStatus('Redirect URI copied ✓');
      setTimeout(() => setStatus(''), 1200);
    } catch (e) {
      setStatus('Copy failed: ' + (e?.message || e), false);
    }
  };

  const store = await chrome.storage.local.get(['clientId','clientSecret']);
  if (store.clientId) cidEl.value = store.clientId;
  if (store.clientSecret) secretEl.value = store.clientSecret;
});

document.getElementById('save').onclick = async () => {
  const clientId = cidEl.value.trim();
  const clientSecret = (secretEl.value || '').trim();
  if (!clientId || !clientId.endsWith('.apps.googleusercontent.com')) return setStatus('Please enter a valid Client ID', false);
  const port = await getPort();
  const reqId = String(Date.now());
  port.postMessage({ type: 'SET_CLIENT_ID', requestId: reqId, clientId, clientSecret });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'RESP' && msg.requestId === reqId) {
      if (msg.ok) setStatus('Client ID saved ✓');
      else setStatus('Save failed: ' + (msg.error || 'unknown'), false);
    }
  });
};

document.getElementById('signin').onclick = async () => {
  // Trigger an auth-required op to run the OAuth flow
  const port = await getPort();
  const requestId = String(Date.now());
  port.postMessage({ type: 'SAVE_SNAPSHOT', requestId, conversationId: 'auth-test', fileName: 'Auth Test.md', content: '# Auth test\\n' + new Date().toISOString() });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'RESP' && msg.requestId === requestId) {
      if (msg.ok) setStatus('Signed in and test file created ✓');
      else setStatus('Sign-in failed: ' + (msg.error || 'unknown'), false);
    }
  });
};
