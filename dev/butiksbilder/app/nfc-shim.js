// Attrapp för react-native-nfc-manager i webbversionen (bara för butiksbilder).
// window.__nfcTap("https://tappass.se/t/<token>") låtsas att en stämpel läses.
const TNF_WELL_KNOWN = 1;
let pending = null;
let lastUri = "";
function tap(uri) {
  lastUri = uri;
  const p = pending;
  pending = null;
  if (p) p.resolve();
  return !!p;
}
if (typeof window !== "undefined") window.__nfcTap = tap;
const NfcManager = {
  start: async () => true,
  isSupported: async () => true,
  isEnabled: async () => true,
  requestTechnology: () => new Promise((resolve, reject) => { pending = { resolve, reject }; }),
  getTag: async () => ({ ndefMessage: [{ tnf: TNF_WELL_KNOWN, __kind: "U", payload: [] }] }),
  cancelTechnologyRequest: async () => {
    const p = pending;
    pending = null;
    if (p) p.reject(Object.assign(new Error("cancelled"), { code: "UserCancel" }));
  },
  setAlertMessageIOS: async () => {},
  setEventListener: () => {},
  registerTagEvent: async () => {},
  unregisterTagEvent: async () => {},
};
export const NfcTech = { Ndef: "Ndef" };
export const NfcEvents = {};
export const Ndef = {
  TNF_WELL_KNOWN,
  RTD_TEXT: "T",
  RTD_URI: "U",
  isType: (r, tnf, type) => r && r.tnf === tnf && r.__kind === type,
  text: { decodePayload: () => "" },
  uri: { decodePayload: () => lastUri },
};
export default NfcManager;
