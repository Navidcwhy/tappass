import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_URL = "https://yaizagzyjfxvbqpknlsj.supabase.co";
const SUPABASE_KEY = "sb_publishable_Oy72AtSsEQMTHeebp1TmLg_mceB0gf6";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const DEVICE_KEY = "tappass.device_id";
let deviceIdPromise = null;

// Ett enda id per installation. Alla samtidiga anrop väntar på samma läsning —
// annars kan första start (t.ex. via en tagglänk) skapa flera id:n, och den
// första stämpeln hamnar på ett id som appen sedan glömmer.
export function getDeviceId() {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      let id = await AsyncStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = "d_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        await AsyncStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    })().catch((e) => {
      deviceIdPromise = null;   // försök igen vid nästa anrop
      throw e;
    });
  }
  return deviceIdPromise;
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
// tierAt (v10): vald belöning hos butiker med flera belöningar. Skickas bara då —
// utan nivå fungerar anropet även mot servrar före v10 (hela kortet).
export async function saveReward(cafeSlug, tierAt) {
  try {
    const device_id = await getDeviceId();
    const params = { p_device_id: device_id, p_cafe_slug: cafeSlug };
    if (tierAt != null) params.p_tier_at = tierAt;
    const { data, error } = await supabase.rpc("save_reward", params);
    if (error || !data || typeof data !== "object") return { ok: false, error: "network" };
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}

// Inlösen görs med butikens stämpel (redeem_by_tap, nedan) eller av personalen med
// koden (merchant_redeem_by_code i tappass.se/m). Appens gamla redeem_reward-anrop är
// borttaget — servern stängde det i v4.

// Sparad kod för ett kort.
//   { ok: true, code: "123456" } — belöningen väntar på inlösen
//   { ok: true, code: null }     — ingen sparad belöning (t.ex. personalen har löst in)
//   { ok: false }                — nät-/serverfel: vi vet INGENTING, tolka det aldrig som inlöst
export async function getCurrentSavedCode(cafeSlug) {
  try {
    const device_id = await getDeviceId();
    const { data, error } = await supabase.rpc("current_saved_code", { p_device_id: device_id, p_cafe_slug: cafeSlug });
    if (error || !data || data.ok !== true) return { ok: false };
    // tierAt (v10): vilken belöning som är sparad (null före v10 = hela kortet);
    // reward: dess namn när den sparades (samma som personalen ser)
    return {
      ok: true,
      code: data.code || null,
      tierAt: data.tier_at == null ? null : Number(data.tier_at),
      reward: data.code && data.reward ? String(data.reward) : null,
    };
  } catch {
    return { ok: false };
  }
}

// Kunden ångrar en sparad belöning och samlar vidare (v10). { ok, stamps } eller
// { ok: false, error: "nothing_saved" | "network" … }.
export async function cancelSavedReward(cafeSlug) {
  try {
    const device_id = await getDeviceId();
    const { data, error } = await supabase.rpc("cancel_saved_reward", { p_device_id: device_id, p_cafe_slug: cafeSlug });
    if (error || !data || typeof data !== "object") return { ok: false, error: "network" };
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}

// Inlösen med butikens stämpel (v9): kunden har tryckt "Lös in" och personalen håller
// stämpeln mot telefonen. Servern kontrollerar att stämpeln hör till butiken.
// { ok: true, carry_over, stamps, already? } eller { ok: false, error: "wrong_tag" |
// "unknown_tag" (+ expected/got) | "not_complete" | "unavailable" | "network" … }.
// "unavailable" = funktionen finns inte på servern (v9 inte körd) — appen hänvisar till koden.
export async function redeemByTap(cafeSlug, token) {
  try {
    const device_id = await getDeviceId();
    const { data, error } = await supabase.rpc("redeem_by_tap", { p_device_id: device_id, p_cafe_slug: cafeSlug, p_token: token });
    if (error) return { ok: false, error: error.code === "PGRST202" ? "unavailable" : "network" };
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}

// ── Dagens hjul (v6) ─────────────────────────────────────────────────────
// Alla tre returnerar serverns jsonb. Nät-/RPC-fel blir { ok: false, error: "network" }
// så att UI:t aldrig tolkar ett nätfel som "redan snurrat" eller "ingen vinst".
async function wheelRpc(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error || !data || typeof data !== "object") return { ok: false, error: "network" };
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}

// { ok, can_spin, next_spin_at, today, prize, bonuses, cities }
export async function wheelStatus() {
  const device_id = await getDeviceId();
  return wheelRpc("wheel_status", { p_device_id: device_id });
}

// Staden skickas med men sparas inte på servern.
// { ok, spin_id, won, segment, next_spin_at, claim_until, offers } eller
// { ok: false, error: "already_spun" | "no_places" | "all_bonused" | "no_city" | "network" }
// all_bonused (v7): kunden har redan en aktiv dubbelstämpel hos alla ställen i staden.
export async function spinWheel(city) {
  const device_id = await getDeviceId();
  return wheelRpc("spin_wheel", { p_device_id: device_id, p_city: city });
}

// { ok, cafe, expires_at, stamps } eller
// { ok: false, error: "not_offered" | "already_claimed" | "expired" | "bonus_exists" | "network" }
export async function claimWheelPrize(spinId, cafeSlug) {
  const device_id = await getDeviceId();
  return wheelRpc("claim_wheel_prize", { p_device_id: device_id, p_spin_id: spinId, p_cafe_slug: cafeSlug });
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
