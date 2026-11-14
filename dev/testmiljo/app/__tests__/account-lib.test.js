// Konto (v14): hjälpfunktionerna och nätanropen i supabase.js. Bara Supabase-klienten är
// utbytt — den riktiga supabase.js körs, med AsyncStorage-mocken som telefonens lagring.
const mockClients = [];
jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn((url, key, opts) => {
    const c = {
      opts,
      rpc: jest.fn(async () => ({ data: null, error: { message: "inte inställt" } })),
      auth: {
        signInWithOtp: jest.fn(async () => ({ data: {}, error: null })),
        verifyOtp: jest.fn(async () => ({ data: { session: { access_token: "jwt" } }, error: null })),
        signOut: jest.fn(async () => ({ error: null })),
      },
    };
    mockClients.push(c);
    return c;
  }),
}));

const AsyncStorage = require("@react-native-async-storage/async-storage");
const acc = require("../src/lib/account");
const lib = require("../src/lib/supabase");
const main = mockClients[0];
const authC = () => mockClients[1];

beforeEach(() => { jest.clearAllMocks(); });

test("hjälpfunktionerna: e-post, kod, maskning och nedräkning", () => {
  expect(acc.cleanEmail("  Navid@Exempel.SE ")).toBe("navid@exempel.se");
  expect(acc.validEmail(" navid@exempel.se ")).toBe(true);
  for (const bad of ["", "navid", "navid@", "@exempel.se", "navid@exempel", "na vid@exempel.se", "navid@exempel.s"]) expect(acc.validEmail(bad)).toBe(false);
  expect(acc.cleanCode("12 34-56")).toBe("123456");
  expect(acc.cleanCode("12345678901")).toBe("1234567890");
  expect(acc.codeReady("12345")).toBe(false);
  expect(acc.codeReady("123 456")).toBe(true);
  expect(acc.maskEmail("navid@gmail.com")).toBe("n***@gmail.com");
  expect(acc.maskEmail("x")).toBe("");
  expect(acc.maskEmail("@exempel.se")).toBe("");
  expect(acc.resendIn(1000, 1000)).toBe(60);
  expect(acc.resendIn(1000, 31000)).toBe(30);
  expect(acc.resendIn(1000, 61500)).toBe(0);
  expect(acc.resendIn(0)).toBe(0);
});

test("texterna: fel och vad som hände vid inloggningen", () => {
  expect(acc.accountErrorText({ error: "rate_limit", retryAfter: 42 })).toBe("Vänta 42 sekunder och försök igen.");
  expect(acc.accountErrorText({ error: "rate_limit" })).toMatch(/För många försök/);
  expect(acc.accountErrorText("invalid_email")).toBe("Kontrollera e-postadressen.");
  expect(acc.accountErrorText({ error: "bad_code" })).toMatch(/Koden stämmer inte/);
  expect(acc.accountErrorText({ error: "other_account" })).toMatch(/annat konto/);
  expect(acc.accountErrorText({ error: "not_found" })).toMatch(/inget konto/);
  expect(acc.accountErrorText({ error: "network" })).toMatch(/Ingen kontakt/);
  expect(acc.accountErrorText({ error: "något nytt" })).toMatch(/Ingen kontakt/);
  expect(acc.linkResultText({ ok: true, created: true }).title).toBe("Klart – kontot är skapat");
  expect(acc.linkResultText({ ok: true, already: true }).title).toBe("Redan inloggad");
  expect(acc.linkResultText({ ok: true, merged: true, moved_stamps: 7 }).body).toMatch(/^7 stämplar från den här telefonen ligger nu på kontot/);
  expect(acc.linkResultText({ ok: true, merged: true, moved_stamps: 1 }).body).toMatch(/^1 stämpel från/);
  expect(acc.linkResultText({ ok: true, merged: true, moved_stamps: 0 }).title).toBe("Välkommen tillbaka");
  expect(acc.linkResultText({ ok: true, merged: false }).title).toBe("Välkommen tillbaka");
});

test("auth_methods: påslaget, server före v14 och nätfel", async () => {
  main.rpc.mockResolvedValueOnce({ data: { email: true, apple: false }, error: null });
  expect(await lib.getAuthMethods()).toEqual({ email: true, apple: false, google: false });
  expect(main.rpc).toHaveBeenCalledWith("auth_methods");
  main.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "saknas" } });
  expect(await lib.getAuthMethods()).toEqual({ email: false, apple: false, google: false });
  main.rpc.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
  expect(await lib.getAuthMethods()).toBeNull();
  main.rpc.mockRejectedValueOnce(new Error("offline"));
  expect(await lib.getAuthMethods()).toBeNull();
});

test("kod på e-post: egen inloggningsklient utan sparad session, och felen", async () => {
  expect(await lib.sendLoginCode(" Navid@Exempel.se ")).toEqual({ ok: true });
  const a = authC();
  expect(a).toBeTruthy();
  expect(a).not.toBe(main);
  expect(a.opts.auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  expect(a.auth.signInWithOtp).toHaveBeenCalledWith({ email: "navid@exempel.se", options: { shouldCreateUser: true } });

  a.auth.signInWithOtp.mockResolvedValueOnce({ error: { code: "over_email_send_rate_limit", status: 429, message: "For security purposes, you can only request this after 42 seconds." } });
  expect(await lib.sendLoginCode("navid@exempel.se")).toEqual({ ok: false, error: "rate_limit", retryAfter: 42 });
  a.auth.signInWithOtp.mockResolvedValueOnce({ error: { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" } });
  expect(await lib.sendLoginCode("okand@exempel.se", { create: false })).toEqual({ ok: false, error: "not_found" });
  expect(a.auth.signInWithOtp).toHaveBeenLastCalledWith({ email: "okand@exempel.se", options: { shouldCreateUser: false } });
  a.auth.signInWithOtp.mockResolvedValueOnce({ error: { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" } });
  expect(await lib.sendLoginCode("ny@exempel.se")).toEqual({ ok: false, error: "disabled" });
  a.auth.signInWithOtp.mockResolvedValueOnce({ error: { code: "email_address_invalid", status: 400 } });
  expect(await lib.sendLoginCode("x@y.zz")).toEqual({ ok: false, error: "invalid_email" });
  a.auth.signInWithOtp.mockRejectedValueOnce(new Error("offline"));
  expect(await lib.sendLoginCode("navid@exempel.se")).toEqual({ ok: false, error: "network" });

  expect(await lib.verifyLoginCode("navid@exempel.se", "123 456")).toEqual({ ok: true });
  expect(a.auth.verifyOtp).toHaveBeenCalledWith({ email: "navid@exempel.se", token: "123456", type: "email" });
  a.auth.verifyOtp.mockResolvedValueOnce({ data: {}, error: { code: "otp_expired", status: 403, message: "Token has expired or is invalid" } });
  expect(await lib.verifyLoginCode("navid@exempel.se", "000000")).toEqual({ ok: false, error: "bad_code" });
  a.auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: null });
  expect(await lib.verifyLoginCode("navid@exempel.se", "000000")).toEqual({ ok: false, error: "bad_code" });
});

test("koppla telefonen: kontonyckeln blir telefonens id och sessionen avslutas", async () => {
  await lib.setDeviceId("d_telefonB_123");
  await lib.verifyLoginCode("navid@exempel.se", "123456");
  const a = authC();
  // Nätfel: ingenting byts, sessionen finns kvar för "Försök igen"
  a.rpc.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
  expect(await lib.linkAccount()).toEqual({ ok: false, error: "network" });
  expect(await lib.getDeviceId()).toBe("d_telefonB_123");
  expect(a.auth.signOut).not.toHaveBeenCalled();
  // Annat konto: svaret skickas vidare, id:t är kvar
  a.rpc.mockResolvedValueOnce({ data: { ok: false, error: "other_account" }, error: null });
  expect(await lib.linkAccount()).toEqual({ ok: false, error: "other_account" });
  expect(await lib.getDeviceId()).toBe("d_telefonB_123");
  // Lyckat: telefonen får kontots nyckel
  a.rpc.mockResolvedValueOnce({ data: { ok: true, device_id: "d_kontonyckel_A", created: false, merged: true, moved_stamps: 7 }, error: null });
  const r = await lib.linkAccount();
  expect(r).toMatchObject({ ok: true, merged: true, moved_stamps: 7 });
  expect(a.rpc).toHaveBeenLastCalledWith("account_link", { p_device_id: "d_telefonB_123" });
  expect(await lib.getDeviceId()).toBe("d_kontonyckel_A");
  expect(await AsyncStorage.getItem("tappass.device_id")).toBe("d_kontonyckel_A");
  expect(a.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  // Vanliga anrop går fortfarande med den vanliga klienten — nu med kontonyckeln
  main.rpc.mockResolvedValueOnce({ data: [], error: null });
  await lib.loadWallet();
  expect(main.rpc).toHaveBeenLastCalledWith("load_wallet", { p_device_id: "d_kontonyckel_A" });
  expect(a.rpc).not.toHaveBeenCalledWith("load_wallet", expect.anything());
  // Server före v14
  a.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "saknas" } });
  expect(await lib.linkAccount()).toEqual({ ok: false, error: "disabled" });
});

test("ny nyckel, radera och status", async () => {
  await lib.setDeviceId("d_kontonyckel_A");
  const a = authC();
  a.rpc.mockResolvedValueOnce({ data: { ok: true, device_id: "k_0123456789abcdef0123456789abcdef" }, error: null });
  expect((await lib.rotateAccountKey()).ok).toBe(true);
  expect(a.rpc).toHaveBeenLastCalledWith("account_rotate");
  expect(await lib.getDeviceId()).toBe("k_0123456789abcdef0123456789abcdef");
  expect(a.auth.signOut).toHaveBeenCalledTimes(1);

  a.rpc.mockResolvedValueOnce({ data: { ok: false, error: "not_signed_in" }, error: null });
  expect(await lib.deleteAccount()).toEqual({ ok: false, error: "not_signed_in" });
  expect(await lib.getDeviceId()).toBe("k_0123456789abcdef0123456789abcdef");
  a.rpc.mockResolvedValueOnce({ data: { ok: true, deleted: true }, error: null });
  expect(await lib.deleteAccount()).toEqual({ ok: true, deleted: true });
  expect(a.rpc).toHaveBeenLastCalledWith("account_delete");
  const fresh = await lib.getDeviceId();
  expect(fresh).toMatch(/^d_[a-z0-9]{8,}$/);
  expect(await AsyncStorage.getItem("tappass.device_id")).toBe(fresh);

  main.rpc.mockResolvedValueOnce({ data: { ok: true, linked: true, email: "n***@exempel.se", since: "2026-11-14" }, error: null });
  expect(await lib.accountStatus()).toEqual({ ok: true, linked: true, email: "n***@exempel.se" });
  expect(main.rpc).toHaveBeenLastCalledWith("account_status", { p_device_id: fresh });
  main.rpc.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
  expect(await lib.accountStatus()).toEqual({ ok: false });
  main.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
  expect(await lib.accountStatus()).toEqual({ ok: true, linked: false });
});

test("newDeviceId: nytt slumpat id varje gång", async () => {
  const a = await lib.newDeviceId();
  const b = await lib.newDeviceId();
  expect(a).not.toBe(b);
  expect(await lib.getDeviceId()).toBe(b);
});
