import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import NfcManager from "react-native-nfc-manager";

const IS_IOS = Platform.OS === "ios";

let started = false;
async function ensureStarted() {
  if (started) return true;
  try { await NfcManager.start(); started = true; return true; }
  catch { return false; }
}

/**
 * Returns { supported, enabled }.
 *  - Android: re-checks every 2s and on foreground, because the user can
 *    toggle the OS-level NFC switch at any time.
 *  - iOS: there is no user-facing NFC toggle and isEnabled() is hardcoded
 *    true in the library, so we check isSupported once and skip the polling.
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
        // On iOS enabled has no meaning (no OS toggle) — gate the UI on support.
        const enabled = supported ? (IS_IOS ? true : await NfcManager.isEnabled()) : false;
        if (alive) setStatus({ supported, enabled });
      } catch {
        if (alive) setStatus({ supported: false, enabled: false });
      }
    };

    check();
    if (!IS_IOS) {
      timer = setInterval(check, 2000);
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") check();
      });
      return () => { alive = false; if (timer) clearInterval(timer); sub.remove(); };
    }

    return () => { alive = false; };
  }, []);

  return status;
}
