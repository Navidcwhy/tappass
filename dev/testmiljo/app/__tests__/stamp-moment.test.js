// Stämpelögonblicket: nedslag i takt med vibrationen, dubbelstämpel, sista rutan och första stämpeln.
import React from "react";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, press, until, tick, flush } from "./helpers";

jest.setTimeout(90000);
jest.mock("react-native-url-polyfill/auto", () => ({}));
jest.mock("expo-font", () => ({ loadAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(() => Promise.resolve()), hideAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-linking", () => ({ getInitialURL: jest.fn(() => Promise.resolve(null)), addEventListener: jest.fn(() => ({ remove() {} })), parse: jest.fn(() => ({ path: "" })) }));
jest.mock("../src/lib/nfc", () => ({
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
  hasFirstStamp: jest.fn(() => Promise.resolve(false)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  birthdayStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false, birthday: null, window: null, gifts: [] })),
  getAuthMethods: jest.fn(() => Promise.resolve({ email: false, apple: false, google: false })),
  accountStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false })), newDeviceId: jest.fn(() => Promise.resolve("d_ny")),
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
}));

const Haptics = require("expo-haptics");
const sb = require("../src/lib/supabase");
const prefs = require("../src/lib/prefs");
const App = require("../App").default;
const StampSheet = require("../src/components/StampSheet").default;
const LoyaltyCard = require("../src/components/LoyaltyCard").default;

const MIYABI = { slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", symbol: "", ink_color: "#1B5A66", soft_color: "", deep_color: "", reward_text: "En 5-bitars sushi på huset", reward_short: "Gratis 5-bitars sushi", stamps_needed: 6, city: "Stockholm" };
const BRYGGAN = { ...MIYABI, slug: "bryggan", name: "Bryggans Bageri", type: "Bageri", area: "Södermalm", ink_color: "#56642B", reward_text: "En kanelbulle", reward_short: "Gratis kanelbulle", stamps_needed: 8 };
const card = { id: "miyabi", slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", reward: "En 5-bitars sushi på huset", rewardShort: "Gratis 5-bitars sushi", ink: "#1B5A66", needed: 6 };
const STATUS = { ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 36e5).toISOString(), today: null, prize: null, bonuses: [], cities: [{ city: "Stockholm", places: 2 }] };

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  sb.loadCafes.mockResolvedValue([MIYABI, BRYGGAN]);
  sb.wheelStatus.mockResolvedValue(STATUS);
  prefs.hasFirstStamp.mockResolvedValue(false);
});
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

test("vanlig stämpel: vibrationen kommer vid nedslaget, inte när arket öppnas", async () => {
  const tree = await mount(<StampSheet card={{ ...card, stamps: 3, added: 1 }} onClose={() => {}} />);
  await flush();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(560); });
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  expect(Haptics.impactAsync).toHaveBeenLastCalledWith("medium");
  expect(text(tree)).toContain("Stämpel hos Miyabi");
  expect(text(tree)).toContain("3 av 6 – 3 kvar till gratis 5-bitars sushi.");
});

test("dubbelstämpel: två nedslag, +1 blir +2 och andra vibrationen är kraftigare", async () => {
  const tree = await mount(<StampSheet card={{ ...card, stamps: 4, added: 2 }} onClose={() => {}} />);
  await act(async () => { jest.advanceTimersByTime(560); });
  expect(text(tree)).toContain("+1");
  expect(text(tree)).not.toContain("+2");
  await act(async () => { jest.advanceTimersByTime(700); });
  await flush();
  expect(text(tree)).toContain("+2");
  expect(text(tree)).toContain("×2");
  expect(Haptics.impactAsync.mock.calls.map((c) => c[0])).toEqual(["medium", "heavy"]);
});

test("sista rutan: arket och kortet säger Nästa är gratis!", async () => {
  let tree = await mount(<StampSheet card={{ ...card, stamps: 5, added: 1 }} onClose={() => {}} />);
  await flush();
  expect(text(tree)).toContain("5 av 6 – nästa är gratis!");
  await unmountAll();
  tree = await mount(<LoyaltyCard card={{ ...card, stamps: 5, pendingReward: false }} onOpenReward={() => {}} />);
  expect(text(tree)).toContain("Nästa är gratis!");
  expect(text(tree)).toContain("En stämpel kvar till gratis 5-bitars sushi");
  await unmountAll();
  tree = await mount(<LoyaltyCard card={{ ...card, stamps: 4, pendingReward: false }} onOpenReward={() => {}} />);
  expect(text(tree)).toContain("2 kvar till gratis 5-bitars sushi");
  expect(text(tree)).not.toContain("Nästa är gratis!");
});

test("första stämpeln: välkomsttext, framgångsvibration och Toppen!-knapp", async () => {
  const tree = await mount(<StampSheet card={{ ...card, stamps: 1, added: 1, first: true }} onClose={() => {}} />);
  await act(async () => { jest.advanceTimersByTime(560); });
  await flush();
  const t = text(tree);
  expect(t).toContain("VÄLKOMMEN TILL TAPPASS");
  expect(t).toContain("Din första stämpel!");
  expect(t).toContain("1 av 6 hos Miyabi. Samla 5 till för gratis 5-bitars sushi.");
  expect(t).toContain("Toppen!");
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
});

test("appen: tom plånbok + ingen flagga → första stämpeln firas och flaggan sätts", async () => {
  sb.loadWallet.mockResolvedValue([]);
  sb.tapToken.mockResolvedValue({ ok: true, cafe: BRYGGAN, stamps: 1, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 });
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Inga kort än"), "tom start");
  await flush();
  await press(tree, "+1 Bryggans Bageri");
  await until(() => text(tree).includes("Din första stämpel!"), "välkomstarket");
  expect(prefs.markFirstStamp).toHaveBeenCalledTimes(1);
});

test("appen: kort finns redan → vanlig stämpel, ingen välkomst (flaggan sätts ändå)", async () => {
  sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 3, pending: false, bonus_expires_at: null }]);
  sb.tapToken.mockResolvedValue({ ok: true, cafe: MIYABI, stamps: 4, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 });
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  await flush();
  await press(tree, "+1 Miyabi");
  await until(() => text(tree).includes("Stämpel hos Miyabi"), "arket");
  expect(text(tree)).not.toContain("Din första stämpel!");
  expect(prefs.markFirstStamp).toHaveBeenCalledTimes(1);
});

test("appen: arket stängs automatiskt — längre för dubbelstämpel", async () => {
  sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 3, pending: false, bonus_expires_at: null }]);
  sb.tapToken.mockResolvedValue({ ok: true, cafe: MIYABI, stamps: 5, complete: false, stamps_added: 2, bonus_applied: true, carry_over: 0 });
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  await flush();
  await press(tree, "+1 Miyabi");
  await until(() => text(tree).includes("Dubbelstämpel hos Miyabi"), "arket");
  await tick(4800);
  expect(text(tree)).toContain("Dubbelstämpel hos Miyabi");   // fortfarande öppet efter 4,8 s
  await tick(600);
  expect(text(tree)).not.toContain("Dubbelstämpel hos Miyabi");
});
