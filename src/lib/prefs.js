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
