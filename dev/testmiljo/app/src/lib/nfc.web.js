// Webbförhandsvisning: ingen NFC. window.__tappassTag("miyabi-01") simulerar att en
// stämpel hålls mot telefonen (besvarar läsningen som appens NFC-loop väntar på).
// window.__tappassIsoTag({ delay, fresh }) håller en simulerad NTAG 424 DNA mot telefonen
// medan taggverktyget väntar (openIsoDep).
import { SimTagWeb } from "./simtag.web";
let pending = null;
let iso = null;
let simTag = null;
export const IS_IOS = false;
export const initNfc = async () => {};
export const readToken = () => new Promise((resolve) => { pending = resolve; });
export const cancelNfc = async () => { if (iso) { const r = iso; iso = null; r.reject(new Error("cancelled")); } };
export const setIosAlert = async () => {};
export const isCancelOrTimeout = () => true;
export const openIsoDep = () => new Promise((resolve, reject) => { iso = { resolve, reject }; });
if (typeof window !== "undefined") {
  window.__tappassTag = (token) => { const r = pending; pending = null; if (r) r(token); return !!r; };
  window.__tappassIsoTag = ({ delay = 0, fresh = false } = {}) => {
    if (!iso) return false;
    if (!simTag || fresh) simTag = new SimTagWeb();
    simTag.reset();
    const tag = simTag, r = iso;
    iso = null;
    r.resolve(async (bytes) => {
      if (delay) await new Promise((ok) => setTimeout(ok, delay));
      return tag.process(Uint8Array.from(bytes));
    });
    return true;
  };
}
