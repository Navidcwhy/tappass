import { Platform } from "react-native";
import NfcManager, { NfcTech, Ndef } from "react-native-nfc-manager";

export const IS_IOS = Platform.OS === "ios";

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

// On iOS every requestTechnology call presents the system "Ready to Scan"
// sheet; alertMessage is the instruction text shown on it (ignored on Android).
export async function readToken({ alertMessage } = {}) {
  await NfcManager.requestTechnology(
    NfcTech.Ndef,
    alertMessage ? { alertMessage } : undefined
  );
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

// Update the text on the iOS scan sheet before it closes (no-op on Android).
export async function setIosAlert(message) {
  if (!IS_IOS) return;
  try { await NfcManager.setAlertMessageIOS(message); } catch {}
}

// True when the thrown NFC error is a user-cancel or session timeout rather
// than a genuine read failure. iOS surfaces these as a code, not a message.
export function isCancelOrTimeout(e) {
  const code = e && (e.code || e.name);
  if (typeof code === "string" && /cancel|timeout|invalidat|userCancel|session/i.test(code)) return true;
  const msg = (e && e.message) || "";
  return /cancel|timeout|invalidat|session was invalidated/i.test(msg);
}
