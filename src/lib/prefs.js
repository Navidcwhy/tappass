import AsyncStorage from "@react-native-async-storage/async-storage";

// Small local UI preferences (not synced to the backend).
const ONBOARDED_KEY = "tappass.onboarded";

export async function hasOnboarded() {
  try { return (await AsyncStorage.getItem(ONBOARDED_KEY)) === "1"; }
  catch { return false; }
}

export async function markOnboarded() {
  try { await AsyncStorage.setItem(ONBOARDED_KEY, "1"); }
  catch {}
}

// Kundens första stämpel någonsin på den här telefonen (välkomstfirandet visas en gång).
const FIRST_STAMP_KEY = "tappass.firstStamp";

export async function hasFirstStamp() {
  try { return (await AsyncStorage.getItem(FIRST_STAMP_KEY)) === "1"; }
  catch { return false; }
}

export async function markFirstStamp() {
  try { await AsyncStorage.setItem(FIRST_STAMP_KEY, "1"); }
  catch {}
}

// Dagens hjul: vald stad sparas BARA på telefonen (utlovat i integritetspolicyn).
const CITY_KEY = "tappass.wheel.city";

export async function getWheelCity() {
  try { return (await AsyncStorage.getItem(CITY_KEY)) || null; }
  catch { return null; }
}

export async function setWheelCity(city) {
  try { await AsyncStorage.setItem(CITY_KEY, String(city || "")); }
  catch {}
}

// Konto (v14): e-posten sparas på telefonen så att en ny kod kan skickas (bekräfta före
// "Logga ut andra telefoner" och "Radera konto"). Inget lösenord finns.
const ACCOUNT_KEY = "tappass.account";

export async function getAccount() {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNT_KEY);
    const a = raw ? JSON.parse(raw) : null;
    return a && typeof a.email === "string" ? a : null;
  } catch { return null; }
}

export async function setAccount(account) {
  try { await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(account)); }
  catch {}
}

export async function clearAccount() {
  try { await AsyncStorage.removeItem(ACCOUNT_KEY); }
  catch {}
}

// Rutan "Spara dina stämplar" under Kort — stängd av kunden
const ACCOUNT_HINT_KEY = "tappass.accountHint";

export async function accountHintDismissed() {
  try { return (await AsyncStorage.getItem(ACCOUNT_HINT_KEY)) === "1"; }
  catch { return false; }
}

export async function dismissAccountHint() {
  try { await AsyncStorage.setItem(ACCOUNT_HINT_KEY, "1"); }
  catch {}
}
