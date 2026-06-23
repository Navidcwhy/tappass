import NfcManager, { NfcTech, Ndef } from "react-native-nfc-manager";

let started = false;

export async function initNfc() {
  if (started) return true;
  try { await NfcManager.start(); started = true; return true; }
  catch { return false; }
}

export async function isNfcSupported() {
  try { return await NfcManager.isSupported(); } catch { return false; }
}
export async function isNfcEnabled() {
  try { return await NfcManager.isEnabled(); } catch { return false; }
}

export async function readToken() {
  await NfcManager.requestTechnology(NfcTech.Ndef);
  const tag = await NfcManager.getTag();
  const records = (tag && tag.ndefMessage) || [];
  for (const r of records) {
    if (r.tnf === Ndef.TNF_WELL_KNOWN && Ndef.isType(r, Ndef.TNF_WELL_KNOWN, Ndef.RTD_TEXT)) {
      const text = Ndef.text.decodePayload(new Uint8Array(r.payload));
      if (text) return text.trim().toLowerCase();
    }
    if (r.tnf === Ndef.TNF_WELL_KNOWN && Ndef.isType(r, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI)) {
      const uri = Ndef.uri.decodePayload(new Uint8Array(r.payload));
      if (uri) return uri.split("/").pop().trim().toLowerCase();
    }
  }
  for (const r of records) {
    try {
      const guess = String.fromCharCode.apply(null, r.payload).replace(/[^\x20-\x7e]/g, "").trim().toLowerCase();
      if (guess) return guess;
    } catch {}
  }
  return null;
}

export async function cancelNfc() {
  try { await NfcManager.cancelTechnologyRequest(); } catch {}
}
