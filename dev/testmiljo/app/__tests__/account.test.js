// Konto (v14): kontoarket (e-postkod, koppla telefonen, logga ut, byt nyckel, radera)
// och appen (kontoknappen, rutan "Spara dina stämplar", byte av telefonens id).
import React from "react";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, until, flush, press } from "./helpers";

jest.setTimeout(90000);
jest.mock("react-native-url-polyfill/auto", () => ({}));
jest.mock("expo-font", () => ({ loadAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(() => Promise.resolve()), hideAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-linking", () => ({ getInitialURL: jest.fn(() => Promise.resolve(null)), addEventListener: jest.fn(() => ({ remove() {} })), parse: jest.fn(() => ({ path: "" })) }));
jest.mock("../src/lib/nfc", () => ({
  IS_IOS: false,
  initNfc: jest.fn(() => Promise.resolve()), readToken: jest.fn(() => new Promise(() => {})), cancelNfc: jest.fn(() => Promise.resolve()),
  setIosAlert: jest.fn(() => Promise.resolve()), isCancelOrTimeout: jest.fn(() => true),
}));
jest.mock("../src/lib/useNfcStatus", () => ({ useNfcStatus: () => ({ supported: true, enabled: true }) }));
jest.mock("../src/lib/cache", () => ({ readCache: jest.fn(() => Promise.resolve(null)), writeCache: jest.fn() }));
jest.mock("../src/lib/prefs", () => ({
  getAccount: jest.fn(() => Promise.resolve(null)), setAccount: jest.fn(), clearAccount: jest.fn(),
  accountHintDismissed: jest.fn(() => Promise.resolve(false)), dismissAccountHint: jest.fn(),
  hasOnboarded: jest.fn(() => Promise.resolve(true)), markOnboarded: jest.fn(),
  getWheelCity: jest.fn(() => Promise.resolve("Stockholm")), setWheelCity: jest.fn(),
  hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  getAuthMethods: jest.fn(), accountStatus: jest.fn(), newDeviceId: jest.fn(() => Promise.resolve("d_ny")),
  sendLoginCode: jest.fn(), verifyLoginCode: jest.fn(), linkAccount: jest.fn(), rotateAccountKey: jest.fn(),
  deleteAccount: jest.fn(), endAuthSession: jest.fn(() => Promise.resolve()),
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
  redeemByTap: jest.fn(), cancelSavedReward: jest.fn(), getCafeLogo: jest.fn(),
}));

const sb = require("../src/lib/supabase");
const prefs = require("../src/lib/prefs");
const AccountSheet = require("../src/components/AccountSheet").default;

beforeEach(() => {
  jest.clearAllMocks();
  sb.accountStatus.mockResolvedValue({ ok: true, linked: true, email: "n***@exempel.se" });
  sb.getAuthMethods.mockResolvedValue({ email: true, apple: false, google: false });
});
afterEach(async () => { await unmountAll(); });

const input = (tree, label) => tree.root.findAll((n) => n.props && n.props.accessibilityLabel === label && typeof n.props.onChangeText === "function")[0];
const type = async (tree, label, value) => { await act(async () => { input(tree, label).props.onChangeText(value); }); };
// Knappens läge (de avstängda knapparna saknar onPress på själva Pressable)
const disabled = (tree, l) => {
  const hits = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "button" && n.props.accessibilityState &&
    n.findAll((x) => x.props && x.props.children === l).length > 0);
  if (!hits.length) throw new Error("Hittar ingen knapp: " + l);
  return !!hits[hits.length - 1].props.accessibilityState.disabled;
};
const sheet = (props) => mount(<AccountSheet visible account={null} onChanged={jest.fn()} onClose={jest.fn()} {...props} />);

test("start: tydligt att stämplarna bara finns i telefonen; kod → inloggad med sammanslagna stämplar", async () => {
  const onChanged = jest.fn();
  const tree = await sheet({ onChanged });
  const t = text(tree);
  expect(t).toContain("Spara dina stämplar");
  expect(t).toContain("Utan konto finns dina stämplar bara i den här telefonen.");
  expect(t).toContain("Samma kort på alla dina telefoner");
  expect(t).toContain("Integritetspolicy");
  expect(disabled(tree, "Skicka kod")).toBe(true);   // ingen giltig adress än
  await type(tree, "E-post", "Navid@Exempel");
  expect(disabled(tree, "Skicka kod")).toBe(true);
  await type(tree, "E-post", "Navid@Exempel.se");
  expect(disabled(tree, "Skicka kod")).toBe(false);
  sb.sendLoginCode.mockResolvedValue({ ok: true });
  await press(tree, "Skicka kod");
  await flush();
  expect(sb.sendLoginCode).toHaveBeenCalledWith("navid@exempel.se", { create: true });
  expect(text(tree)).toContain("Skriv in koden");
  expect(text(tree)).toContain("Vi har mejlat en kod till navid@exempel.se.");
  expect(text(tree)).toContain("Skicka ny kod om 60 s");
  expect(disabled(tree, "Logga in")).toBe(true);     // koden inte ifylld

  // Fel kod
  sb.verifyLoginCode.mockResolvedValueOnce({ ok: false, error: "bad_code" });
  await type(tree, "Kod från mejlet", "111 111");
  await press(tree, "Logga in");
  await flush();
  expect(text(tree)).toContain("Koden stämmer inte eller är för gammal");
  expect(sb.linkAccount).not.toHaveBeenCalled();

  // Rätt kod, men nätet går under kopplingen → "Försök igen" utan ny kod
  sb.verifyLoginCode.mockResolvedValueOnce({ ok: true });
  sb.linkAccount.mockResolvedValueOnce({ ok: false, error: "network" })
    .mockResolvedValueOnce({ ok: true, device_id: "d_kontonyckel", created: false, merged: true, moved_stamps: 7 });
  await type(tree, "Kod från mejlet", "123456");
  await press(tree, "Logga in");
  await flush();
  expect(sb.verifyLoginCode).toHaveBeenLastCalledWith("navid@exempel.se", "123456");
  expect(text(tree)).toContain("Ingen kontakt med servern");
  await press(tree, "Försök igen");
  await flush();
  expect(sb.verifyLoginCode).toHaveBeenCalledTimes(2);
  expect(sb.linkAccount).toHaveBeenCalledTimes(2);
  const done = text(tree);
  expect(done).toContain("Inloggad");
  expect(done).toContain("7 stämplar från den här telefonen ligger nu på kontot");
  expect(done).toContain("Inloggad som navid@exempel.se");
  expect(onChanged).toHaveBeenCalledWith({ type: "linked", result: expect.objectContaining({ moved_stamps: 7 }), email: "navid@exempel.se" });
});

test("start: nytt konto och för många försök", async () => {
  const tree = await sheet({});
  await type(tree, "E-post", "ny@exempel.se");
  sb.sendLoginCode.mockResolvedValueOnce({ ok: false, error: "rate_limit", retryAfter: 37 });
  await press(tree, "Skicka kod");
  await flush();
  expect(text(tree)).toContain("Vänta 37 sekunder och försök igen.");
  expect(text(tree)).not.toContain("Skriv in koden");
  sb.sendLoginCode.mockResolvedValueOnce({ ok: true });
  sb.verifyLoginCode.mockResolvedValueOnce({ ok: true });
  sb.linkAccount.mockResolvedValueOnce({ ok: true, device_id: "d_telefon", created: true, merged: false, moved_stamps: 0 });
  await press(tree, "Skicka kod");
  await flush();
  await type(tree, "Kod från mejlet", "654321");
  await press(tree, "Logga in");
  await flush();
  expect(text(tree)).toContain("Klart – kontot är skapat");
  expect(text(tree)).toContain("Logga in med samma e-post på en ny telefon så följer de med.");
});

test("inloggad: logga ut från telefonen (stämplarna finns kvar på kontot)", async () => {
  const onChanged = jest.fn(), onClose = jest.fn();
  const tree = await sheet({ account: { email: "navid@exempel.se" }, onChanged, onClose });
  await flush();
  const t = text(tree);
  expect(t).toContain("Ditt konto");
  expect(t).toContain("Inloggad som navid@exempel.se");
  expect(t).toContain("Dina stämplar sparas på kontot.");
  expect(t).toContain("Logga ut andra telefoner");
  expect(t).toContain("Radera konto");
  await press(tree, "Logga ut från den här telefonen");
  expect(text(tree)).toContain("Logga ut från den här telefonen?");
  expect(text(tree)).toContain("Dina stämplar finns kvar på kontot.");
  await press(tree, "Logga ut");
  expect(onChanged).toHaveBeenCalledWith({ type: "logout" });
  expect(onClose).toHaveBeenCalled();
  expect(sb.sendLoginCode).not.toHaveBeenCalled();   // ingen kod behövs för att logga ut
});

test("inloggad: logga ut andra telefoner kräver kod (inget nytt konto skapas)", async () => {
  const onChanged = jest.fn(), onClose = jest.fn();
  const tree = await sheet({ account: { email: "navid@exempel.se" }, onChanged, onClose });
  await flush();
  await press(tree, "Logga ut andra telefoner");
  expect(text(tree)).toContain("Logga ut andra telefoner?");
  expect(text(tree)).toContain("Vi mejlar en kod till navid@exempel.se");
  sb.sendLoginCode.mockResolvedValueOnce({ ok: true });
  await press(tree, "Skicka kod");
  await flush();
  expect(sb.sendLoginCode).toHaveBeenCalledWith("navid@exempel.se", { create: false });
  expect(text(tree)).toContain("Bekräfta att det är du");
  sb.verifyLoginCode.mockResolvedValueOnce({ ok: true });
  sb.rotateAccountKey.mockResolvedValueOnce({ ok: true, device_id: "k_ny" });
  await type(tree, "Kod från mejlet", "222333");
  await press(tree, "Logga ut andra telefoner");
  await flush();
  expect(sb.rotateAccountKey).toHaveBeenCalled();
  expect(onChanged).toHaveBeenCalledWith({ type: "rotated" });
  expect(onClose).toHaveBeenCalled();
});

test("inloggad: radera kontot med kod", async () => {
  const onChanged = jest.fn(), onClose = jest.fn();
  const tree = await sheet({ account: { email: "navid@exempel.se" }, onChanged, onClose });
  await flush();
  await press(tree, "Radera konto");
  const t = text(tree);
  expect(t).toContain("Radera kontot?");
  expect(t).toContain("försvinner ur appen – på alla dina telefoner. Det går inte att ångra.");
  expect(t).toContain("Butikerna behåller sin statistik över stämplingar, utan koppling till dig.");
  sb.sendLoginCode.mockResolvedValueOnce({ ok: true });
  await press(tree, "Skicka kod");
  await flush();
  expect(sb.sendLoginCode).toHaveBeenCalledWith("navid@exempel.se", { create: false });
  expect(text(tree)).toContain("Bekräfta raderingen");
  // Nätfel efter godkänd kod → "Försök igen" raderar utan ny kod
  sb.verifyLoginCode.mockResolvedValueOnce({ ok: true });
  sb.deleteAccount.mockResolvedValueOnce({ ok: false, error: "network" }).mockResolvedValueOnce({ ok: true, deleted: true });
  await type(tree, "Kod från mejlet", "999000");
  await press(tree, "Radera kontot");
  await flush();
  expect(onChanged).not.toHaveBeenCalled();
  await press(tree, "Försök igen");
  await flush();
  expect(sb.verifyLoginCode).toHaveBeenCalledTimes(1);
  expect(sb.deleteAccount).toHaveBeenCalledTimes(2);
  expect(onChanged).toHaveBeenCalledWith({ type: "deleted" });
  expect(onClose).toHaveBeenCalled();
});

test("inloggad men utloggad från en annan telefon: arket säger det och erbjuder inloggning", async () => {
  sb.accountStatus.mockResolvedValueOnce({ ok: true, linked: false });
  const onChanged = jest.fn();
  const tree = await sheet({ account: { email: "navid@exempel.se" }, onChanged });
  await until(() => text(tree).includes("Du har loggats ut på den här telefonen"), "notisen");
  expect(text(tree)).toContain("Spara dina stämplar");
  expect(input(tree, "E-post").props.value).toBe("navid@exempel.se");
  expect(onChanged).toHaveBeenCalledWith({ type: "gone" });
  // Nätfel vid kontrollen ändrar ingenting
  sb.accountStatus.mockResolvedValueOnce({ ok: false });
  const again = await sheet({ account: { email: "navid@exempel.se" } });
  await flush();
  expect(text(again)).toContain("Ditt konto");
});

// ── Appen ───────────────────────────────────────────────────────────
const MIYABI = { slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", symbol: "", ink_color: "#1B5A66", soft_color: "", deep_color: "", reward_text: "En 5-bitars sushi på huset", reward_short: "Gratis 5-bitars sushi", stamps_needed: 6, city: "Stockholm" };
const LINNEA = { ...MIYABI, slug: "linnea", name: "Café Linnea", ink_color: "#7A3B2E", reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", stamps_needed: 10 };
const WHEEL = { ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 3600e3).toISOString(), cities: [] };
const label = (tree, l) => tree.root.findAll((n) => n.props && n.props.accessibilityLabel === l && typeof n.props.onPress === "function")[0];

test("appen: kontoknapp och rutan under korten; inloggning byter till kontots kort", async () => {
  sb.loadCafes.mockResolvedValue([MIYABI, LINNEA]);
  sb.loadWallet.mockResolvedValueOnce([{ cafe: MIYABI, stamps: 2, pending: false }])
    .mockResolvedValue([{ cafe: MIYABI, stamps: 5, pending: false }, { cafe: LINNEA, stamps: 4, pending: false }]);
  sb.wheelStatus.mockResolvedValue(WHEEL);
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Utan konto finns de bara i den här telefonen."), "rutan");
  expect(label(tree, "Konto: spara dina stämplar")).toBeTruthy();
  await press(tree, "Skapa konto");
  await flush();
  expect(text(tree)).toContain("Utan konto finns dina stämplar bara i den här telefonen.");
  await type(tree, "E-post", "navid@exempel.se");
  sb.sendLoginCode.mockResolvedValueOnce({ ok: true });
  await press(tree, "Skicka kod");
  await flush();
  sb.verifyLoginCode.mockResolvedValueOnce({ ok: true });
  sb.linkAccount.mockResolvedValueOnce({ ok: true, device_id: "d_kontonyckel", created: false, merged: true, moved_stamps: 2 });
  await type(tree, "Kod från mejlet", "123456");
  await press(tree, "Logga in");
  await until(() => sb.loadWallet.mock.calls.length >= 2, "korten hämtas igen");
  await flush();
  expect(prefs.setAccount).toHaveBeenCalledWith(expect.objectContaining({ email: "navid@exempel.se" }));
  expect(text(tree)).toContain("2 stämplar från den här telefonen ligger nu på kontot");
  await press(tree, "Klar");
  await flush();
  expect(text(tree)).toContain("Café Linnea");
  expect(text(tree)).not.toContain("Utan konto finns de bara i den här telefonen.");
  expect(label(tree, "Konto, inloggad")).toBeTruthy();

  // Logga ut: nytt id, tomma kort, meddelande
  sb.loadWallet.mockResolvedValue([]);
  await act(async () => { label(tree, "Konto, inloggad").props.onPress(); });
  await flush();
  expect(text(tree)).toContain("Ditt konto");
  await press(tree, "Logga ut från den här telefonen");
  await press(tree, "Logga ut");
  await until(() => text(tree).includes("Inga kort än"), "tomma kort");
  expect(sb.newDeviceId).toHaveBeenCalled();
  expect(prefs.clearAccount).toHaveBeenCalled();
  expect(text(tree)).toContain("Utloggad från den här telefonen");
  expect(label(tree, "Konto: spara dina stämplar")).toBeTruthy();
});

test("appen: stängd ruta stannar stängd; avstängd inloggning visar ingen kontoknapp", async () => {
  sb.loadCafes.mockResolvedValue([MIYABI]);
  sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 2, pending: false }]);
  sb.wheelStatus.mockResolvedValue(WHEEL);
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Spara dina stämplar"), "rutan");
  await act(async () => { label(tree, "Stäng tipset om konto").props.onPress(); });
  await flush();
  expect(text(tree)).not.toContain("Spara dina stämplar");
  expect(prefs.dismissAccountHint).toHaveBeenCalled();
  expect(label(tree, "Konto: spara dina stämplar")).toBeTruthy();   // knappen finns kvar
  await unmountAll();

  sb.getAuthMethods.mockResolvedValue({ email: false, apple: false, google: false });
  const off = await mount(<App />);
  await until(() => text(off).includes("Miyabi"), "plånboken");
  await flush();
  expect(text(off)).not.toContain("Spara dina stämplar");
  expect(label(off, "Konto: spara dina stämplar")).toBeUndefined();
});

test("appen: utloggad från en annan telefon märks vid start", async () => {
  prefs.getAccount.mockResolvedValueOnce({ email: "navid@exempel.se" });
  sb.accountStatus.mockResolvedValue({ ok: true, linked: false });
  sb.loadCafes.mockResolvedValue([MIYABI]);
  sb.loadWallet.mockResolvedValue([]);
  sb.wheelStatus.mockResolvedValue(WHEEL);
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Utloggad från kontot"), "meddelandet");
  expect(prefs.clearAccount).toHaveBeenCalled();
  expect(label(tree, "Konto: spara dina stämplar")).toBeTruthy();
});
