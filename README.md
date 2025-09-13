# ChatGPT → Google Drive Logger

Production-ready Chrome MV3 extension that saves ChatGPT conversations to Google Drive as Markdown.

## Install (dev)
1) `chrome://extensions` → enable Developer mode → **Load unpacked** (this folder).  
2) Edit `manifest.json` → set your Google OAuth **client_id**.  
3) In Google Cloud Console, enable **Drive API** and set OAuth to **Production** (scopes: drive.file, drive.appdata).  
4) Click the extension popup → **Connect / Reconnect Google Drive**.  
5) Chat on `chatgpt.com`. Files appear in Drive under **ChatGPT Logs**.

## Notes
- Per-conversation file name: `ChatGPT — <conversationId>.md` (stable).  
- Snapshot-based saving with dedupe, polling, and manual hotkey (**Alt+Shift+S**).  
- Port keep-alive to avoid MV3 service worker unload edge cases.  
- Errors are surfaced with HTTP status and payload details in the SW console.

## Publish
- Bump `version` in `manifest.json`.  
- Package and upload to Chrome Web Store.  
- Provide a Privacy Policy URL.  
