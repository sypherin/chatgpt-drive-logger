// background.js — BYO OAuth (PKCE + launchWebAuthFlow) + Drive integration

console.log("Drive Logger SW boot (BYO OAuth)");

const FOLDER_NAME = "ChatGPT Logs";
const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
];
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "-").replace(/=+$/, "");
}
async function sha256(str) {
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

async function apiFetch(url, { method = "GET", headers = {}, body = null } = {}) {
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || data?.message || text || "Request failed";
    const e = new Error(`HTTP ${res.status} ${res.statusText}: ${msg}`);
    e.status = res.status; e.details = data;
    throw e;
  }
  return data;
}

async function ensureFolder(token) {
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const data = await apiFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (data.files?.length) return data.files[0].id;
  const created = await apiFetch(`${DRIVE_API}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  });
  return created.id;
}

function multipartBody(metadata, content) {
  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  const body =
    delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter + "Content-Type: text/markdown; charset=UTF-8\r\n\r\n" +
    content + closeDelim;
  return { body, boundary };
}

async function createFile(token, folderId, name, content) {
  const metadata = { name, parents: [folderId], mimeType: "text/markdown" };
  const { body, boundary } = multipartBody(metadata, content);
  const json = await apiFetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  return json.id;
}

async function updateFile(token, fileId, name, content) {
  const metadata = { name };
  const { body, boundary } = multipartBody(metadata, content);
  const json = await apiFetch(`${UPLOAD_API}/files/${fileId}?uploadType=multipart`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  return json.id;
}

// ----- OAuth (PKCE via launchWebAuthFlow) -----

async function getStoredKeys() {
  return await chrome.storage.local.get(["clientId", "clientSecret", "accessToken", "refreshToken", "tokenExpiry"]);
}
async function setStored(obj) { await chrome.storage.local.set(obj); }

function getRedirectURL() {
  // This is the extension's dedicated redirect domain. Users MUST add it in their Google Cloud OAuth client.
  return chrome.identity.getRedirectURL("oauth2"); // e.g. https://<EXT_ID>.chromiumapp.org/oauth2
}

async function oauthSignInInteractive() {
  const store = await getStoredKeys();
  const clientId = store.clientId;
  if (!clientId) throw new Error("Missing Client ID. Open the extension options and paste your Google OAuth Client ID.");

  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await sha256(verifier));
  const redirectUri = getRedirectURL();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = new URL(OAUTH_AUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const authUrl = url.toString();

  const redirect = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) return reject(chrome.runtime.lastError || new Error("Auth canceled"));
      resolve(responseUrl);
    });
  });

  const u = new URL(redirect);
  if (u.searchParams.get("state") !== state) throw new Error("State mismatch");
  const code = u.searchParams.get("code");
  if (!code) throw new Error("No auth code returned");

  // Exchange code for tokens
  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("code", code);
  body.set("code_verifier", verifier);
  body.set("redirect_uri", redirectUri);
  body.set("grant_type", "authorization_code");

  // Optionally include client_secret if user provided one
  const storeForSecret = await getStoredKeys();
  if (storeForSecret.clientSecret) body.set('client_secret', storeForSecret.clientSecret);
  const storeForSecret2 = await getStoredKeys();
  if (storeForSecret2.clientSecret) body.set('client_secret', storeForSecret2.clientSecret);
  const token = await apiFetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const now = Math.floor(Date.now()/1000);
  await setStored({
    accessToken: token.access_token,
    refreshToken: token.refresh_token || store.refreshToken || null,
    tokenExpiry: now + (token.expires_in || 3600) - 60, // refresh 1 min early
  });
  return token.access_token;
}

async function refreshTokenIfNeeded() {
  const store = await getStoredKeys();
  const now = Math.floor(Date.now()/1000);
  if (store.accessToken && store.tokenExpiry && store.tokenExpiry > now) {
    return store.accessToken;
  }
  if (!store.refreshToken || !store.clientId) throw new Error("Not authenticated");
  const body = new URLSearchParams();
  body.set("client_id", store.clientId);
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", store.refreshToken);
  // Optionally include client_secret if user provided one
  const storeForSecret = await getStoredKeys();
  if (storeForSecret.clientSecret) body.set('client_secret', storeForSecret.clientSecret);
  const storeForSecret2 = await getStoredKeys();
  if (storeForSecret2.clientSecret) body.set('client_secret', storeForSecret2.clientSecret);
  const token = await apiFetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const newNow = Math.floor(Date.now()/1000);
  await setStored({
    accessToken: token.access_token,
    tokenExpiry: newNow + (token.expires_in || 3600) - 60,
  });
  return token.access_token;
}

async function getAccessToken() {
  try {
    return await refreshTokenIfNeeded();
  } catch (e) {
    // Fall back to interactive sign-in
    return await oauthSignInInteractive();
  }
}

// ----- Core: save snapshot -----
async function runSaveSnapshotViaToken(msg, respond) {
  try {
    const token = await getAccessToken();
    const folderId = await ensureFolder(token);
    const key = `fileId:${msg.conversationId}`;
    const store = await chrome.storage.local.get([key]);
    let fileId = store[key];
    if (!fileId) {
      fileId = await createFile(token, folderId, msg.fileName, msg.content);
    } else {
      await updateFile(token, fileId, msg.fileName, msg.content);
    }
    const toSet = {}; toSet[key] = fileId;
    await chrome.storage.local.set(toSet);
    respond({ ok: true, fileId });
  } catch (err) {
    console.error("SAVE_SNAPSHOT error", err);
    respond({ ok: false, error: String(err?.message || err), details: err?.details });
  }
}

// ----- Port channel -----
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "driveLoggerPort") return;
  port.onMessage.addListener((msg) => {
    const respond = (payload) => { try { port.postMessage({ type: "RESP", requestId: msg.requestId, ...payload }); } catch (_) {} };
    if (msg.type === "PING") { respond({ ok: true }); return; }
    if (msg.type === "SAVE_SNAPSHOT") { (async () => { await runSaveSnapshotViaToken(msg, respond); })(); }
    if (msg.type === "RESET_CONVO") {
      (async () => {
        const key = `fileId:${msg.conversationId}`;
        const bufferKey = `buffer:${msg.conversationId}`;
        await chrome.storage.local.remove([key, bufferKey]);
        respond({ ok: true });
      })();
    }
    if (msg.type === "SET_CLIENT_ID") {
      (async () => {
        await setStored({ clientId: msg.clientId, clientSecret: msg.clientSecret || null });
        respond({ ok: true });
      })();
    }
  });
});
