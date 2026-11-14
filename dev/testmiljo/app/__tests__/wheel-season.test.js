// Hjulet (tick per fält, strålar vid vinst, vickning vid förlust) och säsongsdetaljer (2026-11-13).
import React from "react";
import { AccessibilityInfo } from "react-native";
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
  hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  getAuthMethods: jest.fn(() => Promise.resolve({ email: false, apple: false, google: false })),
  accountStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false })), newDeviceId: jest.fn(() => Promise.resolve("d_ny")),
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
}));

const Haptics = require("expo-haptics");
const sb = require("../src/lib/supabase");
const App = require("../App").default;
const DailyWheel = require("../src/components/DailyWheel").default;
const LightRays = require("../src/components/LightRays").default;
const SeasonFall = require("../src/components/SeasonFall").default;
const { tickTimes, SEGMENT_DEG } = require("../src/lib/wheel");
const { seasonFor, easterSunday, midsummerEve } = require("../src/lib/season");

const MIYABI = { slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", ink_color: "#1B5A66", reward_text: "En 5-bitars sushi på huset", reward_short: "Gratis 5-bitars sushi", stamps_needed: 6, city: "Stockholm" };
const future = (h) => new Date(Date.now() + h * 3600000).toISOString();
const STATUS = { ok: true, can_spin: true, next_spin_at: future(13), today: null, prize: null, bonuses: [], cities: [{ city: "Stockholm", places: 3 }] };
const wheel = (props = {}) => <DailyWheel status={STATUS} onReload={() => {}} onToast={() => {}} onClaimed={() => {}} onOpenRules={() => {}} onCloseRules={() => {}} {...props} />;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  sb.loadCafes.mockResolvedValue([MIYABI]);
  sb.wheelStatus.mockResolvedValue(STATUS);
  sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 3, pending: false, bonus_expires_at: null }]);
});
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

test("ticks: en per fältgräns, glesare mot slutet, aldrig tätare än 55 ms", () => {
  const from = -18, to = from + 6 * 360 + 180;
  const t = tickTimes(from, to, 4200);
  expect(t.length).toBeGreaterThan(25);
  expect(t.length).toBeLessThanOrEqual(Math.floor(to / SEGMENT_DEG) - Math.floor(from / SEGMENT_DEG));
  for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(55);
  expect(t[t.length - 1] - t[t.length - 2]).toBeGreaterThan(t[1] - t[0]);   // inbromsning
  expect(t[t.length - 1]).toBeLessThan(4200);
  expect(tickTimes(10, 10, 4200)).toEqual([]);
  expect(tickTimes(0, 100, 0)).toEqual([]);
});

test("vinst: tick-vibrationer under snurret, strålar och lysande fält före vinstarket", async () => {
  sb.spinWheel.mockResolvedValue({ ok: true, won: true, segment: 3, spin_id: "s1", offers: [{ cafe: MIYABI, stamps: 3, is_new: false }], claim_until: future(60), next_spin_at: future(13) });
  const tree = await mount(wheel());
  await flush();
  await press(tree, "Snurra");
  await flush();
  await tick(200);
  expect(tree.root.findAllByType(LightRays).length).toBe(1);        // hjulet har stannat på vinst
  expect(text(tree)).not.toContain("Grattis");
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  await tick(1300);
  expect(text(tree)).toContain("Grattis! Dubbelstämpel");           // efter REVEAL_MS
  await tick(600);
  expect(tree.root.findAllByType(LightRays).length).toBe(0);        // strålarna borta bakom arket
  await tick(4000);
  expect(Haptics.selectionAsync.mock.calls.length).toBeGreaterThan(25);
});

test("förlust: vickning och sedan förlusttexten en gång", async () => {
  sb.spinWheel.mockResolvedValue({ ok: true, won: false, segment: 1, spin_id: "s2", offers: [], claim_until: null, next_spin_at: future(13) });
  const onToast = jest.fn();
  const tree = await mount(wheel({ onToast }));
  await flush();
  await press(tree, "Snurra");
  await flush();
  await tick(5000);
  await until(() => onToast.mock.calls.length === 1, "förlusttext");
  expect(onToast.mock.calls[0][0].type).toBe("wheel-miss");
  expect(tree.root.findAllByType(LightRays).length).toBe(0);
  expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
});

test("säsonger efter svensk kalender", () => {
  const at = (y, m, d) => seasonFor(new Date(y, m - 1, d, 12));
  expect(at(2026, 11, 13)).toBeNull();
  expect(at(2026, 12, 1).id).toBe("vinter");
  expect(at(2026, 12, 1).greeting).toBeNull();
  expect(at(2026, 12, 13).greeting).toBe("Glad Lucia!");
  expect(at(2026, 12, 24).greeting).toBe("God jul!");
  expect(at(2026, 12, 31).burst).toBe(true);
  expect(at(2027, 1, 1).greeting).toBe("Gott nytt år!");
  expect(at(2027, 1, 6).id).toBe("vinter");
  expect(at(2027, 1, 7)).toBeNull();
  expect(at(2026, 2, 17).greeting).toBe("Glad fettisdag!");
  expect(at(2027, 2, 9).greeting).toBe("Glad fettisdag!");
  expect(at(2026, 4, 2).id).toBe("pask");
  expect(at(2026, 4, 6).id).toBe("pask");
  expect(at(2026, 4, 7)).toBeNull();
  expect(at(2026, 6, 19).greeting).toBe("Glad midsommar!");
  expect(at(2026, 6, 21)).toBeNull();
  expect(at(2026, 10, 4).greeting).toBe("Glad kanelbullens dag!");
  expect([2025, 2026, 2027, 2028].map((y) => easterSunday(y).toDateString())).toEqual(["Sun Apr 20 2025", "Sun Apr 05 2026", "Sun Mar 28 2027", "Sun Apr 16 2028"]);
  expect([2025, 2026, 2027, 2028].map((y) => midsummerEve(y).getDate())).toEqual([20, 19, 25, 23]);
});

test("Lucia: snöfall och hälsning på hemskärmen", async () => {
  jest.setSystemTime(new Date(2026, 11, 13, 9, 0));
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  await flush();
  expect(text(tree)).toContain("Glad Lucia!");
  expect(tree.root.findAllByType(SeasonFall).length).toBe(1);
});

test("vanlig dag: ingen säsongsdetalj", async () => {
  jest.setSystemTime(new Date(2026, 10, 13, 9, 0));
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  await flush();
  expect(tree.root.findAllByType(SeasonFall).length).toBe(0);
  expect(text(tree)).not.toContain("Glad ");
});

test("Reducera rörelse: hälsningen blir kvar men inget faller", async () => {
  jest.setSystemTime(new Date(2026, 11, 24, 9, 0));
  const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  await flush();
  expect(text(tree)).toContain("God jul!");
  expect(tree.root.findAllByType(SeasonFall).length).toBe(0);
  spy.mockRestore();
});
