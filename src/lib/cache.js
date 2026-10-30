import AsyncStorage from "@react-native-async-storage/async-storage";

// Last known cafes + wallet, so the UI can render instantly on cold start
// and refresh from Supabase in the background (stale-while-revalidate).
// Device-local only; the backend stays the source of truth.
const KEY = "tappass.cache.v1";

export async function readCache() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && Array.isArray(c.cafes) && c.wallet && typeof c.wallet === "object" ? c : null;
  } catch { return null; }
}

export async function writeCache(cafes, wallet) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify({ cafes, wallet })); }
  catch {}
}
