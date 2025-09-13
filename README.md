# ChatGPT → Google Drive Logger

Automatically save your ChatGPT conversations into your own Google Drive as Markdown files. Every exchange is logged in a “ChatGPT Logs” folder inside your Drive.

---

## Features
- Automatic logging of conversations in the background
- Markdown files with clear role labels and timestamps
- Live snapshots with de-duplication (no repeated messages)
- Manual quick-save with Alt + Shift + S
- Works on chatgpt.com and chat.openai.com
- Minimal Drive scopes: drive.file and drive.appdata
- No servers; runs entirely in the browser

---

## Installation (Developer Mode)
1. Download or clone this repository.
2. Open Chrome and navigate to chrome://extensions.
3. Enable Developer mode.
4. Click Load unpacked and select the project folder.
5. Pin the extension so its icon is visible.

---

## Setup

### Connect Google Drive
1. Click the extension icon, then Options.
2. Enter your Google OAuth Client ID (and Client Secret if your organization uses one).
3. Save Client ID.
4. Select Sign in to Google and approve the Drive scopes.
5. A file named “Auth Test.md” may be created to confirm access.

### Redirect URI
- The options page displays the exact redirect URI required by your OAuth client.
- It follows this pattern: https://<EXTENSION_ID>.chromiumapp.org/oauth2
- Use the Copy button to avoid typos.

### Google Cloud configuration (for administrators or BYO credentials)
1. Open Google Cloud Console and select or create a project.
2. Enable the Google Drive API from the API Library.
3. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: use the URI shown on the extension options page
4. Copy the Client ID (and Client Secret if provided).
5. Paste these into the extension options page, Save, then Sign in to Google.

---

## Using the extension
- Open ChatGPT in your browser and chat as usual.
- The extension periodically snapshots the conversation and updates the log.
- Press Alt + Shift + S to trigger an immediate save.

---

## Where files are saved
- Google Drive → folder named “ChatGPT Logs”.
- One Markdown (.md) file per conversation, named with a stable identifier.
- Files update over time as the conversation grows.

---

## Privacy
- No data is collected, transmitted, or stored by the developer.
- Conversation content is written only to your own Google Drive.
- You can revoke access at any time from your Google Account’s Third-party access settings.
- Full policy: https://altronis.sg/privacy

---

## Permissions rationale
- identity: authenticate the user with Google to request Drive access
- storage: store minimal settings, file IDs, and tokens locally
- scripting: inject the content script on ChatGPT pages to read visible conversation text
- activeTab: detect and operate only on ChatGPT tabs
- host permissions (googleapis, googleusercontent, accounts.google.com): communicate with Google for OAuth and Drive uploads

---

## Development notes
- Manifest V3 extension with a service worker background script
- OAuth via chrome.identity.launchWebAuthFlow using PKCE
- Background handles Drive folder creation and multipart uploads
- Content script observes DOM changes, dedupes messages, and sends snapshots
- Options page provides Client ID/Secret entry, redirect URI, and sign-in

---

## Troubleshooting
- redirect_uri_mismatch: ensure the exact redirect URI shown in Options is added to your OAuth client
- insufficient permissions: re-run sign-in and confirm the Drive scopes were granted
- stale file mapping: use the Reset option or remove the cached fileId keys from extension storage
- service worker not starting: confirm background type is module in manifest and check the service worker console for syntax errors

---

## License
MIT

---

## Contact
Altronis — sypherin@gmail.com
