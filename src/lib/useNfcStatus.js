import { useEffect, useState } from "react";
import { AppState } from "react-native";
import NfcManager from "react-native-nfc-manager";

let started = false;
async function ensureStarted() {
  if (started) return true;
  try { await NfcManager.start(); started = true; return true; }
  catch { return false; }
}

/**
 * Returns { supported, enabled } and re-checks:
 *  - every 2 seconds while app is in foreground
 *  - whenever the app comes back from background
 */
export function useNfcStatus() {
  const [status, setStatus] = useState({ supported: null, enabled: null });

  useEffect(() => {
    let alive = true;
    let timer = null;

    const check = async () => {
      const ok = await ensureStarted();
      if (!alive) return;
      if (!ok) { setStatus({ supported: false, enabled: false }); return; }
      try {
        const supported = await NfcManager.isSupported();
        const enabled = supported ? await NfcManager.isEnabled() : false;
        if (alive) setStatus({ supported, enabled });
      } catch {
        if (alive) setStatus({ supported: false, enabled: false });
      }
    };

    check();
    timer = setInterval(check, 2000);

    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });

    return () => { alive = false; if (timer) clearInterval(timer); sub.remove(); };
  }, []);

  return status;
}
