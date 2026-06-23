import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_URL = "https://yaizagzyjfxvbqpknlsj.supabase.co";
const SUPABASE_KEY = "sb_publishable_Oy72AtSsEQMTHeebp1TmLg_mceB0gf6";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const DEVICE_KEY = "tappass.device_id";
let cachedDeviceId = null;

export async function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  let id = await AsyncStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "d_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    await AsyncStorage.setItem(DEVICE_KEY, id);
  }
  cachedDeviceId = id;
  return id;
}

export async function tapToken(token) {
  const device_id = await getDeviceId();
  const { data, error } = await supabase.rpc("tap_token", { p_device_id: device_id, p_token: token });
  if (error) return { ok: false, error: error.message };
  return data;
}

// Save reward — now returns { ok, code } so we can show the redemption code
export async function saveReward(cafeSlug) {
  const device_id = await getDeviceId();
  const { data, error } = await supabase.rpc("save_reward", { p_device_id: device_id, p_cafe_slug: cafeSlug });
  if (error) return { ok: false, error: error.message };
  return data;
}

// Redeem reward (customer-side hold-to-redeem)
export async function redeemReward(cafeSlug) {
  const device_id = await getDeviceId();
  const { data, error } = await supabase.rpc("redeem_reward", { p_device_id: device_id, p_cafe_slug: cafeSlug });
  if (error) return { ok: false, error: error.message };
  return data;
}

// Get the existing saved code (so the card can re-display it after app restart)
export async function getCurrentSavedCode(cafeSlug) {
  const device_id = await getDeviceId();
  const { data, error } = await supabase.rpc("current_saved_code", { p_device_id: device_id, p_cafe_slug: cafeSlug });
  if (error) return null;
  return data?.code || null;
}

export async function loadWallet() {
  const device_id = await getDeviceId();
  const { data, error } = await supabase.rpc("load_wallet", { p_device_id: device_id });
  if (error) return [];
  return data || [];
}

export async function loadCafes() {
  const { data, error } = await supabase
    .from("cafes")
    .select("*")
    .eq("active", true)
    .order("name");
  if (error) return [];
  return data || [];
}
