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
