// Webbförhandsvisning: ingen NFC. window.__tappassTag("miyabi-01") simulerar att en
// stämpel hålls mot telefonen (besvarar läsningen som appens NFC-loop väntar på).
let pending = null;
export const IS_IOS = false;
export const initNfc = async () => {};
export const readToken = () => new Promise((resolve) => { pending = resolve; });
export const cancelNfc = async () => {};
export const setIosAlert = async () => {};
export const isCancelOrTimeout = () => true;
if (typeof window !== "undefined") {
  window.__tappassTag = (token) => { const r = pending; pending = null; if (r) r(token); return !!r; };
}
