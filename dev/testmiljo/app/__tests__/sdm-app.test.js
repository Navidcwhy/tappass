// Dynamiska taggar (v17) i appen: SUN följer med från NFC-läsningen och länken till
// tap_token, dubbelläsningar spärras på token, och serverns nya svar (replay, sdm_invalid,
// sdm_required) ger rätt besked.
import React from "react";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, until, flush, press } from "./helpers";

jest.setTimeout(90000);
jest.mock("react-native-url-polyfill/auto", () => ({}));
jest.mock("expo-font", () => ({ loadAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(() => Promise.resolve()), hideAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-linking", () => ({
  getInitialURL: jest.fn(() => Promise.resolve(null)),
  addEventListener: jest.fn(() => ({ remove() {} })),
  parse: jest.fn((url) => {
    const m = String(url).match(/^(\w+):\/\/([^/?#]*)\/?([^?#]*)/);
    return m ? { scheme: m[1], hostname: m[2], path: m[3] } : { path: "" };
  }),
}));
// Läsningar: en väntande läsning får nästa tagg som hålls fram (mockTag)
const mockReads = { waiting: [], queued: [] };
jest.mock("../src/lib/nfc", () => ({
  IS_IOS: require("react-native").Platform.OS === "ios",
  initNfc: jest.fn(() => Promise.resolve()),
  readToken: jest.fn(() => new Promise((resolve) => {
    if (mockReads.queued.length) resolve(mockReads.queued.shift());
    else mockReads.waiting.push(resolve);
  })),
  cancelNfc: jest.fn(() => Promise.resolve()),
  setIosAlert: jest.fn(() => Promise.resolve()), isCancelOrTimeout: jest.fn(() => true),
}));
jest.mock("../src/lib/useNfcStatus", () => ({ useNfcStatus: () => ({ supported: true, enabled: true }) }));
jest.mock("../src/lib/cache", () => ({ readCache: jest.fn(() => Promise.resolve(null)), writeCache: jest.fn() }));
jest.mock("../src/lib/prefs", () => ({
  inviteHintDismissed: jest.fn(() => Promise.resolve(true)), dismissInviteHint: jest.fn(),
  getAccount: jest.fn(() => Promise.resolve(null)), setAccount: jest.fn(), clearAccount: jest.fn(),
  accountHintDismissed: jest.fn(() => Promise.resolve(true)), dismissAccountHint: jest.fn(),
  hasOnboarded: jest.fn(() => Promise.resolve(true)), markOnboarded: jest.fn(),
  getWheelCity: jest.fn(() => Promise.resolve("Stockholm")), setWheelCity: jest.fn(),
  hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  inviteStatus: jest.fn(() => Promise.resolve({ ok: true, unavailable: true })), ackInvites: jest.fn(), getInviteCode: jest.fn(), redeemInvite: jest.fn(),
  birthdayStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false, birthday: null, window: null, gifts: [] })),
  getAuthMethods: jest.fn(() => Promise.resolve({ email: false, apple: false, google: false })),
  accountStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false })), newDeviceId: jest.fn(() => Promise.resolve("d_ny")),
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
  redeemByTap: jest.fn(), cancelSavedReward: jest.fn(), getCafeLogo: jest.fn(),
}));

const sb = require("../src/lib/supabase");
const Linking = require("expo-linking");
const { Platform } = require("react-native");
const IOS = Platform.OS === "ios";
const androidOnly = IOS ? test.skip : test;
const mockTag = (url) => { const w = mockReads.waiting.shift(); if (w) w(url); else mockReads.queued.push(url); };

const E1 = "ef963ff7828658a599f3041510671e88", C1 = "94eed9ee65337086";
const E2 = "0123456789abcdef0123456789abcdef", C2 = "fedcba9876543210";
const URL1 = "https://tappass.se/t/miyabi-01?e=" + E1.toUpperCase() + "&c=" + C1.toUpperCase();
const URL2 = "https://tappass.se/t/miyabi-01?e=" + E2 + "&c=" + C2;
const MIYABI = { slug: "miyabi", name: "Miyabi", type: "Sushi", area: "Lidingö", ink_color: "#1B5A66", reward_text: "En 5-bitars sushi", reward_short: "Gratis sushi", stamps_needed: 6, city: "Stockholm" };
const WHEEL = { ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 3600e3).toISOString(), cities: [] };
const OK = { ok: true, cafe: MIYABI, stamps: 3, complete: false, stamps_added: 1, bonus_applied: false, quiet_applied: false, carry_over: 0 };
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  jest.clearAllMocks();
  mockReads.waiting.length = 0;
  mockReads.queued.length = 0;
  sb.loadCafes.mockResolvedValue([MIYABI]);
  sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 2, pending: false }]);
  sb.wheelStatus.mockResolvedValue(WHEEL);
});
afterEach(async () => { await unmountAll(); });

async function start() {
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => sb.loadWallet.mock.calls.length >= 1 && text(tree).includes("Miyabi"), "korten");
  await flush();
  return tree;
}
// Håll fram en tagg: Android läser i bakgrunden, iPhone läser när Skanna trycks
const tapNow = async (tree, url) => {
  mockTag(url);
  if (IOS) await press(tree, "Skanna stämpel");
  await wait(600);
  await flush();
};

androidOnly("NFC: e/c från en dynamisk tagg följer med; en andra läsning inom 5 s spärras på token", async () => {
  sb.tapToken.mockResolvedValue(OK);
  const tree = await start();
  mockTag(URL1);   // taggen ligger kvar: två läsningar, olika adresser
  mockTag(URL2);
  await wait(1200);
  await flush();
  expect(sb.tapToken).toHaveBeenCalledTimes(1);
  expect(sb.tapToken).toHaveBeenCalledWith("miyabi-01", { e: E1, c: C1 });
  await until(() => text(tree).includes("3 av 6") || text(tree).includes("3/6"), "stämpeln");
});

test("replay: inget besked, korten hämtas igen", async () => {
  sb.tapToken.mockResolvedValue({ ok: false, error: "replay" });
  const tree = await start();
  const loads = sb.loadWallet.mock.calls.length;
  await tapNow(tree, URL1);
  expect(sb.tapToken).toHaveBeenCalledWith("miyabi-01", { e: E1, c: C1 });
  await until(() => sb.loadWallet.mock.calls.length > loads, "korten hämtas igen");
  const t = text(tree);
  for (const s of ["Ingen anslutning", "känns inte igen", "kunde inte kontrolleras", "Läs av stämpeln i kassan"]) expect(t).not.toContain(s);
});

test("sdm_invalid: felrutan säger att stämpeln inte kunde kontrolleras", async () => {
  sb.tapToken.mockResolvedValue({ ok: false, error: "sdm_invalid" });
  const tree = await start();
  await tapNow(tree, URL1);
  await until(() => text(tree).includes("Stämpeln kunde inte kontrolleras"), "felrutan");
  expect(text(tree)).toContain("Försök igen. Fungerar det inte – säg till personalen.");
  expect(text(tree)).not.toContain("Stämpeln känns inte igen");
});

test("sdm_required: länken utan e/c ger beskedet att läsa av stämpeln i kassan", async () => {
  sb.tapToken.mockResolvedValue({ ok: false, error: "sdm_required" });
  Linking.getInitialURL.mockResolvedValueOnce("tappass://t/miyabi-01");
  const tree = await start();
  await until(() => sb.tapToken.mock.calls.length >= 1, "länken");
  expect(sb.tapToken).toHaveBeenCalledWith("miyabi-01", null);
  await until(() => text(tree).includes("Läs av stämpeln i kassan"), "beskedet");
  expect(text(tree)).toContain(IOS ? "Tryck på Skanna och håll iPhonen mot stämpeln – en länk räcker inte." : "Stämpeln räknas bara när telefonen hålls mot den – en länk räcker inte.");
});

test("länk (App Link) från en dynamisk tagg: e/c följer med", async () => {
  sb.tapToken.mockResolvedValue(OK);
  Linking.getInitialURL.mockResolvedValueOnce(URL2);
  await start();
  await until(() => sb.tapToken.mock.calls.length >= 1, "länken");
  expect(sb.tapToken).toHaveBeenCalledWith("miyabi-01", { e: E2, c: C2 });
});

test("nätfel → Försök igen skickar samma läsning; redan räknad → tyst", async () => {
  sb.tapToken.mockResolvedValueOnce({ ok: false, error: "network" }).mockResolvedValueOnce({ ok: false, error: "replay" });
  const tree = await start();
  await tapNow(tree, URL1);
  await until(() => text(tree).includes("Ingen anslutning just nu."), "nätfelet");
  const loads = sb.loadWallet.mock.calls.length;
  await press(tree, "Försök igen");
  await flush();
  expect(sb.tapToken).toHaveBeenCalledTimes(2);
  expect(sb.tapToken.mock.calls[1]).toEqual(["miyabi-01", { e: E1, c: C1 }]);
  await until(() => sb.loadWallet.mock.calls.length > loads, "korten hämtas igen");
});

test("iPhone/Android: en läsning av en dynamisk tagg ger tap_token med e/c", async () => {
  sb.tapToken.mockResolvedValue(OK);
  const tree = await start();
  await tapNow(tree, URL2);
  expect(sb.tapToken).toHaveBeenCalledTimes(1);
  expect(sb.tapToken).toHaveBeenCalledWith("miyabi-01", { e: E2, c: C2 });
});

test("statisk tagg som förut: textrecord med bara slug blir <slug>-01 utan SUN", async () => {
  sb.tapToken.mockResolvedValue(OK);
  const tree = await start();
  await tapNow(tree, "miyabi");
  expect(sb.tapToken).toHaveBeenCalledWith("miyabi-01", null);
});
