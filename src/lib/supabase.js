import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanEmail, cleanCode } from "./account";

const SUPABASE_URL = "https://yaizagzyjfxvbqpknlsj.supabase.co";
const SUPABASE_KEY = "sb_publishable_Oy72AtSsEQMTHeebp1TmLg_mceB0gf6";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const DEVICE_KEY = "tappass.device_id";
let deviceIdPromise = null;
const makeId = () => "d_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

// Ett enda id per installation. Alla samtidiga anrop väntar på samma läsning —
// annars kan första start (t.ex. via en tagglänk) skapa flera id:n, och den
// första stämpeln hamnar på ett id som appen sedan glömmer.
// Med konto (v14) byts id:t mot kontots nyckel (setDeviceId).
export function getDeviceId() {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      let id = await AsyncStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = makeId();
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

// Byt telefonens id: kontots nyckel efter inloggning, eller ett nytt slumpat id när
// kunden loggar ut eller raderar kontot (telefonen börjar då om med tomma kort).
export async function setDeviceId(id) {
  await AsyncStorage.setItem(DEVICE_KEY, id);
  deviceIdPromise = Promise.resolve(id);
  return id;
}
export const newDeviceId = () => setDeviceId(makeId());

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

// Butikens logga (v13): { ok, version, mime, data (base64) } — data null = ingen logga.
// Nätfel → { ok: false } (appen visar då initialen eller en äldre sparad logga).
export async function getCafeLogo(cafeSlug) {
  try {
    const { data, error } = await supabase.rpc("cafe_logo", { p_slug: cafeSlug });
    if (error || !data || typeof data !== "object") return { ok: false };
    return data;
  } catch {
    return { ok: false };
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

// ── Konto (v14) ──────────────────────────────────────────────────────────
// Inloggningen sker i en egen klient: bara account_*-anropen går som inloggad, alla
// andra anrop går som förut. Sessionen sparas inte — den behövs bara medan telefonen
// kopplas, nyckeln byts eller kontot raderas, och avslutas direkt efteråt.
let authClient = null;
const auth = () => {
  if (!authClient) {
    authClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "tappass-konto" },
    });
  }
  return authClient;
};

export function endAuthSession() {
  if (!authClient) return Promise.resolve();
  return authClient.auth.signOut({ scope: "local" }).then(() => {}, () => {});
}

// Supabase Auth-fel → { ok: false, error: "rate_limit" (+ retryAfter) | "invalid_email" |
// "bad_code" | "not_found" | "disabled" | "network" }. notFound: inloggning för att
// bekräfta (inget nytt konto får skapas) — en okänd adress är då "not_found".
function authError(error, notFound) {
  const code = (error && error.code) || "";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || (error && error.status === 429)) {
    const m = /(\d+)\s*sec/i.exec((error && error.message) || "");
    return { ok: false, error: "rate_limit", retryAfter: m ? Number(m[1]) : null };
  }
  if (code === "email_address_invalid" || code === "validation_failed") return { ok: false, error: "invalid_email" };
  if (code === "otp_expired") return { ok: false, error: "bad_code" };
  if (notFound && (code === "otp_disabled" || code === "signup_disabled" || code === "user_not_found")) return { ok: false, error: "not_found" };
  if (["otp_disabled", "signup_disabled", "email_provider_disabled", "email_address_not_authorized"].includes(code)) return { ok: false, error: "disabled" };
  return { ok: false, error: "network" };
}

// Vilka inloggningssätt appen visar ({ email, apple, google }). null = okänt (nätfel);
// en server före v14 svarar att inget är påslaget.
export async function getAuthMethods() {
  try {
    const { data, error } = await supabase.rpc("auth_methods");
    if (error) return error.code === "PGRST202" ? { email: false, apple: false, google: false } : null;
    if (!data || typeof data !== "object") return null;
    return { email: !!data.email, apple: !!data.apple, google: !!data.google };
  } catch {
    return null;
  }
}

// Mejla en inloggningskod. create: false = bara befintliga konton (bekräfta att det är
// kunden innan andra telefoner loggas ut eller kontot raderas).
export async function sendLoginCode(email, { create = true } = {}) {
  try {
    const { error } = await auth().auth.signInWithOtp({ email: cleanEmail(email), options: { shouldCreateUser: create } });
    return error ? authError(error, !create) : { ok: true };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function verifyLoginCode(email, code) {
  try {
    const { data, error } = await auth().auth.verifyOtp({ email: cleanEmail(email), token: cleanCode(code), type: "email" });
    if (error) return authError(error, false);
    return data && data.session ? { ok: true } : { ok: false, error: "bad_code" };
  } catch {
    return { ok: false, error: "network" };
  }
}

// Koppla telefonen till kontot (efter verifyLoginCode). Svaret innehåller kontots
// nyckel, som blir telefonens id: { ok, device_id, created, merged, moved_stamps, already? }
// eller { ok: false, error: "other_account" | "not_signed_in" | "network" … }.
// Vid nätfel finns sessionen kvar, så att "Försök igen" fungerar utan ny kod.
export async function linkAccount() {
  try {
    const device_id = await getDeviceId();
    const { data, error } = await auth().rpc("account_link", { p_device_id: device_id });
    if (error || !data || typeof data !== "object") return { ok: false, error: error && error.code === "PGRST202" ? "disabled" : "network" };
    if (!data.ok) return data;
    if (data.device_id && data.device_id !== device_id) await setDeviceId(String(data.device_id));
    endAuthSession();   // väntar inte: ett segt nät får inte hålla kvar "Loggar in…"
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}

// Ny kontonyckel: alla andra telefoner loggas ut. { ok, device_id } eller { ok: false, error }.
export async function rotateAccountKey() {
  try {
    const { data, error } = await auth().rpc("account_rotate");
    if (error || !data || typeof data !== "object") return { ok: false, error: "network" };
    if (!data.ok) return data;
    await setDeviceId(String(data.device_id));
    endAuthSession();
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}

// Radera kontot. Telefonen får ett nytt id och börjar om utan konto. { ok, deleted }.
export async function deleteAccount() {
  try {
    const { data, error } = await auth().rpc("account_delete");
    if (error || !data || typeof data !== "object") return { ok: false, error: "network" };
    if (!data.ok) return data;
    await newDeviceId();
    endAuthSession();
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}

// Är telefonen kopplad till ett konto? { ok, linked, email (maskad) } — { ok: false } = vet inte (nätfel).
export async function accountStatus() {
  try {
    const device_id = await getDeviceId();
    const { data, error } = await supabase.rpc("account_status", { p_device_id: device_id });
    if (error) return error.code === "PGRST202" ? { ok: true, linked: false } : { ok: false };
    if (!data || data.ok !== true) return { ok: false };
    return { ok: true, linked: !!data.linked, email: data.email || null };
  } catch {
    return { ok: false };
  }
}

// ── Födelsedagspresent (v15) ─────────────────────────────────────────────
// Bara konton. Nätfel → { ok: false }; en server före v15 → { ok: true, unavailable: true }.
async function birthdayRpc(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return error.code === "PGRST202" ? { ok: false, error: "unavailable", unavailable: true } : { ok: false, error: "network" };
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}

// { ok, linked, birthday: { month, day } | null, next_gift, window: { from, to } | null, gifts: [...] }
export async function birthdayStatus() {
  const device_id = await getDeviceId();
  const r = await birthdayRpc("birthday_status", { p_device_id: device_id });
  return r.unavailable ? { ok: true, unavailable: true, linked: false, birthday: null, window: null, gifts: [] } : r;
}

// month/day null = ta bort. { ok, birthday, next_gift } eller { ok: false, error: not_linked | invalid_date | network }
export async function setBirthday(month, day) {
  const device_id = await getDeviceId();
  return birthdayRpc("account_set_birthday", { p_device_id: device_id, p_month: month, p_day: day });
}

// Kunden trycker "Lös in": { ok, code, reward, valid_until } eller { ok: false, error: not_eligible | already_redeemed | network }
export async function claimBirthday(cafeSlug) {
  const device_id = await getDeviceId();
  return birthdayRpc("birthday_claim", { p_device_id: device_id, p_cafe_slug: cafeSlug });
}

// Kodrutans pollning: { ok, code, redeemed, redeemedAt } — { ok: false } = vet inte (nätfel)
export async function getBirthdayCode(cafeSlug) {
  const device_id = await getDeviceId();
  const r = await birthdayRpc("birthday_code", { p_device_id: device_id, p_cafe_slug: cafeSlug });
  if (!r.ok) return { ok: false };
  return { ok: true, code: r.code || null, redeemed: !!r.redeemed, redeemedAt: r.redeemed_at || null };
}

// Personalen håller butikens stämpel mot telefonen: { ok, reward, redeemed_at, already? } eller
// { ok: false, error: wrong_tag | unknown_tag (+ expected/got) | not_eligible | unavailable | network }
export async function redeemBirthdayByTap(cafeSlug, token) {
  const device_id = await getDeviceId();
  return birthdayRpc("redeem_birthday_by_tap", { p_device_id: device_id, p_cafe_slug: cafeSlug, p_token: token });
}

// ── Bjud in en vän (v16) ─────────────────────────────────────────────────
// { ok, code, can_redeem, redeem_until, entered, friends, rewarded, unseen }. Server före v16
// → { ok: true, unavailable: true }; nätfel → { ok: false }.
async function inviteRpc(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return error.code === "PGRST202" ? { ok: true, unavailable: true } : { ok: false, error: "network" };
    if (!data || typeof data !== "object") return { ok: false, error: "network" };
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}
export async function inviteStatus() { return inviteRpc("invite_status", { p_device_id: await getDeviceId() }); }
// Skapar koden (och kundraden) första gången
export async function getInviteCode() { return inviteRpc("invite_code", { p_device_id: await getDeviceId() }); }
// { ok, status: pending (+ until) | rewarded (+ cafe_slug, cafe_name) } eller { ok: false, error: unknown_code | own_code | already_used | too_late | mutual | network }
export async function redeemInvite(code) { return inviteRpc("invite_redeem", { p_device_id: await getDeviceId(), p_code: code }); }
export async function ackInvites() { return inviteRpc("invite_ack", { p_device_id: await getDeviceId() }); }

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
