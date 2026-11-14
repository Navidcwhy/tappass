// Stamgästnivåer (v11): Brons/Silver/Guld per ställe utifrån besök senaste 12 månaderna.
import React from "react";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, until, tick, flush } from "./helpers";

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
  hasOnboarded: jest.fn(() => Promise.resolve(true)), markOnboarded: jest.fn(),
  getWheelCity: jest.fn(() => Promise.resolve("Stockholm")), setWheelCity: jest.fn(),
  hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
  redeemByTap: jest.fn(), cancelSavedReward: jest.fn(),
}));

const sb = require("../src/lib/supabase");
const lv = require("../src/lib/levels");
const LoyaltyCard = require("../src/components/LoyaltyCard").default;
const StampSheet = require("../src/components/StampSheet").default;

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

const DAY = 86400000;
const NOW = Date.parse("2026-11-14T10:00:00Z");   // 11.00 svensk tid

// ── Hjälpfunktionerna ────────────────────────────────────────────────
test("nivåer: gränser, nästa nivå och nya nivåer", () => {
  expect([0, 2, 3, 9, 10, 24, 25, 99].map((v) => (lv.levelFor(v) || {}).key || null))
    .toEqual([null, null, "brons", "brons", "silver", "silver", "guld", "guld"]);
  expect(lv.nextLevel(0)).toEqual({ level: lv.LEVELS[0], left: 3 });
  expect(lv.nextLevel(12)).toEqual({ level: lv.LEVELS[2], left: 13 });
  expect(lv.nextLevel(25)).toBe(null);
  expect(lv.crossedLevel(9, 10).key).toBe("silver");
  expect(lv.crossedLevel(2, 3).key).toBe("brons");
  expect(lv.crossedLevel(10, 11)).toBe(null);
  expect(lv.crossedLevel(10, 10)).toBe(null);
  expect(lv.guestName(lv.LEVELS[2])).toBe("Guldgäst");
});

test("progressText", () => {
  expect(lv.progressText(1)).toBe("1 besök · 2 till Brons");
  expect(lv.progressText(4)).toBe("Bronsgäst · 6 besök till Silver");
  expect(lv.progressText(12)).toBe("Silvergäst · 13 besök till Guld");
  expect(lv.progressText(31)).toBe("Guldgäst · 31 besök senaste året");
});

test("svenskt datum och besök efter ett tapp", () => {
  expect(lv.sthlmDate(Date.parse("2026-11-14T22:30:00Z"))).toBe("2026-11-14");   // 23.30 svensk tid
  expect(lv.sthlmDate(Date.parse("2026-11-14T23:30:00Z"))).toBe("2026-11-15");   // 00.30 svensk tid
  const prev = { slug: "l", visits: 9, lastVisit: "2026-11-13", hasLevels: true };
  const next = lv.afterTap({ slug: "l", stamps: 5 }, prev, NOW);
  expect([next.visits, next.lastVisit, next.hasLevels, next.stamps]).toEqual([10, "2026-11-14", true, 5]);
  const again = lv.afterTap({ slug: "l", stamps: 6 }, next, NOW + 3600e3);
  expect(again.visits).toBe(10);                                                // samma dag: inget nytt besök
  expect(lv.afterTap({ slug: "ny" }, undefined, NOW)).toMatchObject({ visits: 1, hasLevels: false });
});

test("visitsFields: server före v11 ger inga nivåer", () => {
  expect(lv.visitsFields({ visits_12m: 12, last_visit: "2026-11-13" })).toEqual({ visits: 12, lastVisit: "2026-11-13", hasLevels: true });
  expect(lv.visitsFields({ visits_12m: 0, last_visit: null })).toEqual({ visits: 0, lastVisit: null, hasLevels: true });
  expect(lv.visitsFields({})).toEqual({ visits: 0, lastVisit: null, hasLevels: false });
  expect(lv.visitsFields({ visits_12m: "x", last_visit: "igår" })).toEqual({ visits: 0, lastVisit: null, hasLevels: false });
});

// ── Kortet och stämpelarket ──────────────────────────────────────────
const LINNEA = { id: "linnea", slug: "linnea", name: "Café Linnea", type: "Kafé", area: "Vasastan", reward: "En kaffe på huset", rewardShort: "Gratis kaffe", ink: "#7A4A26", needed: 10, tiers: [] };

test("kortet visar nivån bredvid namnet — bara när servern skickar besök", async () => {
  const silver = await mount(<LoyaltyCard card={{ ...LINNEA, stamps: 4, visits: 12, hasLevels: true }} onOpenReward={() => {}} />);
  expect(text(silver)).toContain("Café Linnea ¦ Silver");
  expect(silver.root.findAll((n) => n.props && n.props.accessibilityLabel === "Silvergäst hos Café Linnea").length).toBeGreaterThan(0);
  const none = await mount(<LoyaltyCard card={{ ...LINNEA, stamps: 4, visits: 2, hasLevels: true }} onOpenReward={() => {}} />);
  expect(text(none)).not.toMatch(/Brons|Silver|Guld/);
  const old = await mount(<LoyaltyCard card={{ ...LINNEA, stamps: 4, visits: 30, hasLevels: false }} onOpenReward={() => {}} />);
  expect(text(old)).not.toMatch(/Brons|Silver|Guld/);
});

test("stämpelarket: ny nivå poppar fram efter nedslaget", async () => {
  const tree = await mount(<StampSheet card={{ ...LINNEA, stamps: 5, added: 1, levelUp: lv.LEVELS[1] }} onClose={() => {}} />);
  expect(text(tree)).toContain("NY NIVÅ ¦ Du är Silvergäst hos Café Linnea");
  const box = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Ny nivå: du är Silvergäst hos Café Linnea")[0];
  expect(box.props.accessibilityLiveRegion).toBe("polite");
  const haptics = require("expo-haptics");
  haptics.notificationAsync.mockClear();
  await tick(1200);
  expect(haptics.notificationAsync).toHaveBeenCalledWith("success");
  const plain = await mount(<StampSheet card={{ ...LINNEA, stamps: 5, added: 1 }} onClose={() => {}} />);
  expect(text(plain)).not.toContain("NY NIVÅ");
});

// ── Appen ────────────────────────────────────────────────────────────
const CAFE = { slug: "linnea", name: "Café Linnea", type: "Kafé", area: "Vasastan", symbol: "", ink_color: "#7A4A26", soft_color: "", deep_color: "", reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", stamps_needed: 10, city: "Stockholm" };
const MIYABI = { ...CAFE, slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", ink_color: "#1B5A66", reward_text: "En 5-bitars sushi på huset", reward_short: "Gratis 5-bitars sushi", stamps_needed: 6 };

async function startApp(rows) {
  sb.loadCafes.mockResolvedValue([CAFE, MIYABI]);
  sb.loadWallet.mockResolvedValue(rows);
  sb.wheelStatus.mockResolvedValue({ ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 3600e3).toISOString(), cities: [] });
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Café Linnea"), "plånboken");
  return tree;
}
const pressDev = async (tree, label) => {
  const hits = tree.root.findAll((n) => n.props && typeof n.props.onPress === "function" &&
    n.findAll((x) => x.props && (x.props.children === label || (Array.isArray(x.props.children) && x.props.children.join("") === label))).length > 0);
  await act(async () => { hits[hits.length - 1].props.onPress(); });
  await flush();
};

test("appen: tappet som blir tionde besöket ger Silver direkt", async () => {
  const yesterday = lv.sthlmDate(Date.now() - DAY);
  const tree = await startApp([{ cafe: CAFE, stamps: 4, pending: false, visits_12m: 9, last_visit: yesterday }]);
  expect(text(tree)).toContain("Café Linnea ¦ Brons");
  sb.tapToken.mockResolvedValue({ ok: true, cafe: CAFE, stamps: 5, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 });
  await pressDev(tree, "+1 Café Linnea");
  await until(() => text(tree).includes("NY NIVÅ"), "nivån i arket");
  expect(text(tree)).toContain("Du är Silvergäst hos Café Linnea");
  await tick(7000);                                             // arket stängs (6,2 s)
  expect(text(tree)).not.toContain("NY NIVÅ");
  expect(text(tree)).toContain("Café Linnea ¦ Silver");
  // Samma dag igen: inget nytt besök, ingen ny nivå
  sb.tapToken.mockResolvedValue({ ok: true, cafe: CAFE, stamps: 6, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 });
  await pressDev(tree, "+1 Café Linnea");
  await tick(1500);
  expect(text(tree)).not.toContain("NY NIVÅ");
});

test("appen: Ställen visar nivå och hur långt det är kvar", async () => {
  const tree = await startApp([
    { cafe: CAFE, stamps: 4, pending: false, visits_12m: 12, last_visit: "2026-11-01" },
    { cafe: MIYABI, stamps: 1, pending: false, visits_12m: 1, last_visit: "2026-11-01" },
  ]);
  const tabs = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function");
  await act(async () => { tabs.find((t) => t.props.accessibilityLabel === "Ställen").props.onPress(); });
  await flush();
  expect(text(tree)).toContain("Silvergäst · 13 besök till Guld");
  expect(text(tree)).toContain("1 besök · 2 till Brons");
});

test("appen: server före v11 — inga nivåer någonstans", async () => {
  const tree = await startApp([{ cafe: CAFE, stamps: 4, pending: false }]);
  sb.tapToken.mockResolvedValue({ ok: true, cafe: CAFE, stamps: 5, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 });
  await pressDev(tree, "+1 Café Linnea");
  await tick(1500);
  expect(text(tree)).not.toMatch(/NY NIVÅ|Brons|Silver|Guld|besök/);
});
