// Lugna timmar (v8) i appen: schema, "just nu", kortets banner, stämpelarket och Ställen.
import React from "react";
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
  hasOnboarded: jest.fn(() => Promise.resolve(true)), markOnboarded: jest.fn(),
  getWheelCity: jest.fn(() => Promise.resolve("Stockholm")), setWheelCity: jest.fn(),
  hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
}));

const Linking = require("expo-linking");
const sb = require("../src/lib/supabase");
const App = require("../App").default;
const StampSheet = require("../src/components/StampSheet").default;
const { quietNow, quietSummary, daysText, clockText, sthlmClock } = require("../src/lib/quiet");

const WEEKDAYS = [{ days: [1, 2, 3, 4, 5], from: "14:00", to: "16:00" }];
const MIYABI = { slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", ink_color: "#1B5A66", reward_text: "En 5-bitars sushi på huset", reward_short: "Gratis 5-bitars sushi", stamps_needed: 6, city: "Stockholm", quiet_hours: WEEKDAYS };
const STATUS = { ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 36e5).toISOString(), today: null, prize: null, bonuses: [], cities: [{ city: "Stockholm", places: 1 }] };
// Måndag 16 nov 2026 14.20 svensk tid = 13.20 UTC
const MON_1420 = Date.UTC(2026, 10, 16, 13, 20);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  sb.loadCafes.mockResolvedValue([MIYABI]);
  sb.wheelStatus.mockResolvedValue(STATUS);
  sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 3, pending: false, bonus_expires_at: null }]);
});
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

test("svensk tid oavsett telefonens tidszon, även sommartid", () => {
  expect(sthlmClock(MON_1420)).toEqual({ dow: 1, minutes: 14 * 60 + 20 });
  expect(sthlmClock(Date.UTC(2026, 5, 15, 12, 30))).toEqual({ dow: 1, minutes: 14 * 60 + 30 });   // sommartid
  expect(quietNow(WEEKDAYS, MON_1420)).toEqual(WEEKDAYS[0]);
  expect(quietNow(WEEKDAYS, Date.UTC(2026, 10, 16, 15, 0))).toBeNull();     // 16.00 räknas inte
  expect(quietNow(WEEKDAYS, Date.UTC(2026, 10, 14, 13, 20))).toBeNull();    // lördag
  expect(quietNow([], MON_1420)).toBeNull();
  expect(quietNow(undefined, MON_1420)).toBeNull();
  expect(quietNow([{ days: [1], from: "xx", to: "yy" }], MON_1420)).toBeNull();
});

test("schemat i klartext", () => {
  expect(daysText([1, 2, 3, 4, 5])).toBe("mån–fre");
  expect(daysText([6, 7])).toBe("lör, sön");
  expect(daysText([1, 3, 5])).toBe("mån, ons, fre");
  expect(daysText([1, 2, 3, 4, 5, 6, 7])).toBe("alla dagar");
  expect(clockText("14:00")).toBe("14");
  expect(clockText("14:30")).toBe("14.30");
  expect(quietSummary([...WEEKDAYS, { days: [6], from: "09:30", to: "11:00" }])).toBe("mån–fre 14–16 · lör 9.30–11");
  expect(quietSummary([])).toBe("");
});

test("hemskärmen: 'Lugn timme just nu' på kortet under butikens tider", async () => {
  jest.setSystemTime(MON_1420);
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  await flush();
  expect(text(tree)).toContain("Lugn timme just nu");
  expect(text(tree)).toContain("Varje stämpel här ger 2 · till 16.00");
});

test("utanför tiderna syns ingen banner, och den försvinner när timmen tar slut", async () => {
  jest.setSystemTime(Date.UTC(2026, 10, 16, 14, 59, 40));   // 15.59.40
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  await flush();
  expect(text(tree)).toContain("Lugn timme just nu");
  await tick(31000);   // 16.00.11 — nästa kontroll
  expect(text(tree)).not.toContain("Lugn timme just nu");
});

test("stämpelarket säger LUGN TIMME när servern gav lugn timme", async () => {
  const tree = await mount(<StampSheet card={{ id: "miyabi", slug: "miyabi", name: "Miyabi", reward: "x", rewardShort: "Gratis sushi", ink: "#1B5A66", needed: 6, stamps: 5, added: 2, quiet: true }} onClose={() => {}} />);
  expect(text(tree)).toContain("LUGN TIMME · 2 STÄMPLAR");
  expect(text(tree)).toContain("Dubbelstämpel hos Miyabi");
});

test("tappet skickar quiet_applied vidare till arket", async () => {
  jest.setSystemTime(MON_1420);
  sb.tapToken.mockResolvedValue({ ok: true, cafe: MIYABI, stamps: 5, complete: false, stamps_added: 2, bonus_applied: false, quiet_applied: true, carry_over: 0 });
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  await flush();
  await press(tree, "+1 Miyabi");   // dev-knappen skickar samma tap_token som en tagg
  await until(() => text(tree).includes("LUGN TIMME · 2 STÄMPLAR"), "arket");
  expect(text(tree)).toContain("Dubbelstämpel hos Miyabi");
});

test("Ställen: schemat och '×2 nu'", async () => {
  jest.setSystemTime(MON_1420);
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  await press(tree, "Ställen");
  await flush();
  expect(text(tree)).toContain("Dubbla stämplar ¦ mån–fre 14–16");
  expect(text(tree)).toContain("×2 nu");
});
