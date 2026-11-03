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

// Returns the RPC's own jsonb ({ ok, error: "unknown_tag" | "pending_reward" |
// "cooldown" | ... }). Transport/RPC failures are normalized to error: "network"
// so the UI never shows a network failure as "unknown tag".
export async function tapToken(token) {
  const device_id = await getDeviceId();
  try {
    const { data, error } = await supabase.rpc("tap_token", { p_device_id: device_id, p_token: token });
    if (error) return { ok: false, error: "network", detail: error.message };
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    return data;
  } catch (e) {
    return { ok: false, error: "network", detail: e?.message };
  }
}

// Spara belöning → { ok, code }. Servern kräver fullt kort och returnerar
// samma kod om belöningen redan är sparad. Nät-/serverfel → { ok: false }.
export async function saveReward(cafeSlug) {
  try {
    const device_id = await getDeviceId();
    const { data, error } = await supabase.rpc("save_reward", { p_device_id: device_id, p_cafe_slug: cafeSlug });
    if (error || !data || typeof data !== "object") return { ok: false, error: "network" };
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}

// Inlösen görs bara av personalen (merchant_redeem_by_code i tappass.se/m).
// Appens gamla redeem_reward-anrop är borttaget — servern stängde det i v4.

// Sparad kod för ett kort.
//   { ok: true, code: "123456" } — belöningen väntar på inlösen
//   { ok: true, code: null }     — ingen sparad belöning (t.ex. personalen har löst in)
//   { ok: false }                — nät-/serverfel: vi vet INGENTING, tolka det aldrig som inlöst
export async function getCurrentSavedCode(cafeSlug) {
  try {
    const device_id = await getDeviceId();
    const { data, error } = await supabase.rpc("current_saved_code", { p_device_id: device_id, p_cafe_slug: cafeSlug });
    if (error || !data || data.ok !== true) return { ok: false };
    return { ok: true, code: data.code || null };
  } catch {
    return { ok: false };
  }
}

export async function loadWallet() {
  const device_id = await getDeviceId();
  const { data, error } = await supabase.rpc("load_wallet", { p_device_id: device_id });
  if (error) return null;   // null = request failed (keep what we have); [] = genuinely empty
  return data || [];
}

export async function loadCafes() {
  const { data, error } = await supabase
    .from("cafes")
    .select("*")
    .eq("active", true)
    .order("name");
  if (error) return null;   // null = request failed (keep what we have)
  return data || [];
}
