// Regressionstester för buggfixarna 2026-11-11 (appnivå).
import React from "react";
import { act } from "react-test-renderer";
import { AppState } from "react-native";
import { mount, unmountAll, text, press, until, tick, flush, byLabel } from "./helpers";

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

const sb = require("../src/lib/supabase");
const App = require("../App").default;
const { segmentAt } = require("../src/lib/wheel");

const MIYABI = { slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", symbol: "", ink_color: "#1B5A66", soft_color: "", deep_color: "", reward_text: "En 5-bitars sushi på huset", reward_short: "Gratis 5-bitars sushi", stamps_needed: 6, city: "Stockholm" };
const BRYGGAN = { ...MIYABI, slug: "bryggan", name: "Bryggans Bageri", type: "Bageri", area: "Södermalm", ink_color: "#56642B", reward_text: "En kanelbulle", reward_short: "Kanelbulle", stamps_needed: 8 };
const future = (h) => new Date(Date.now() + h * 3600000).toISOString();
const past = (h) => new Date(Date.now() - h * 3600000).toISOString();
const STATUS = (over = {}) => ({ ok: true, can_spin: true, next_spin_at: future(13), today: null, prize: null, bonuses: [], cities: [{ city: "Stockholm", places: 2, available: 2 }], ...over });
const tabLabels = (tree) => tree.root.findAll((n) => n.props && n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function").map((t) => t.props.accessibilityLabel);
const wheelSegment = (tree) => {
  const v = tree.root.findAll((n) => n.type === "View" && n.props.style && JSON.stringify(n.props.style).includes("rotate"))
    .map((n) => JSON.stringify(n.props.style.transform || n.props.style))[0];
  return segmentAt(parseFloat(/rotate":"(-?[\d.]+)deg/.exec(v)[1]));
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  sb.loadCafes.mockResolvedValue([MIYABI, BRYGGAN]);
  sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 3, pending: false, bonus_expires_at: null }]);
  sb.wheelStatus.mockResolvedValue(STATUS());
});
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

async function start() {
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Dina kort"), "start");
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  return tree;
}

test("tappat svar på hämtningen: already_claimed stänger arket, laddar om och visar kortet", async () => {
  const PRIZE = { spin_id: "spin-7", claim_until: future(40), offers: [{ cafe: BRYGGAN, stamps: 0, is_new: true }] };
  sb.wheelStatus.mockResolvedValue(STATUS({ can_spin: false, prize: PRIZE }));
  sb.claimWheelPrize
    .mockResolvedValueOnce({ ok: false, error: "network" })          // servern sparade, svaret tappades
    .mockResolvedValue({ ok: false, error: "already_claimed" });
  const tree = await start();
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Du har en dubbelstämpel att hämta"), "banner");
  await press(tree, "Välj ställe");
  await press(tree, "Använd hos Bryggans Bageri");
  await until(() => text(tree).includes("Ingen anslutning just nu"), "nätfel");
  // Servern har nu valet sparat:
  sb.wheelStatus.mockResolvedValue(STATUS({ can_spin: false, prize: null, bonuses: [{ cafe: BRYGGAN, expires_at: future(40) }] }));
  sb.loadWallet.mockResolvedValue([
    { cafe: MIYABI, stamps: 3, pending: false, bonus_expires_at: null },
    { cafe: BRYGGAN, stamps: 0, pending: false, bonus_expires_at: future(40) },
  ]);
  const statusCalls = sb.wheelStatus.mock.calls.length, walletCalls = sb.loadWallet.mock.calls.length;
  await press(tree, "Använd hos Bryggans Bageri");
  await until(() => text(tree).includes("Vinsten är redan hämtad"), "besked");
  expect(text(tree)).not.toContain("Grattis");                       // arket stängt
  expect(sb.wheelStatus.mock.calls.length).toBeGreaterThan(statusCalls);
  expect(sb.loadWallet.mock.calls.length).toBeGreaterThan(walletCalls);
  await until(() => text(tree).includes("Dubbelstämpel aktiv"), "bonusen på kortet");
  expect(sb.claimWheelPrize).toHaveBeenCalledTimes(2);
});

test("stänga vinstarket stämmer av läget med servern", async () => {
  const PRIZE = { spin_id: "spin-8", claim_until: future(40), offers: [{ cafe: BRYGGAN, stamps: 0, is_new: true }] };
  sb.wheelStatus.mockResolvedValue(STATUS({ can_spin: false, prize: PRIZE }));
  const tree = await start();
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Du har en dubbelstämpel att hämta"), "banner");
  await press(tree, "Välj ställe");
  await until(() => text(tree).includes("Grattis"), "arket");
  const before = sb.wheelStatus.mock.calls.length;
  await act(async () => { byLabel(tree, "Stäng").props.onPress(); });
  await flush();
  expect(sb.wheelStatus.mock.calls.length).toBe(before + 1);
});

test("byta flik under snurret: läget hämtas ändå, pricken försvinner och hjulet står på dagens fält", async () => {
  const tree = await start();
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Snurra"), "hjulfliken");
  let resolveSpin;
  sb.spinWheel.mockImplementation(() => new Promise((r) => { resolveSpin = r; }));
  sb.wheelStatus.mockResolvedValue(STATUS({ can_spin: false, today: { spin_id: "s1", won: false, segment: 7 } }));
  const before = sb.wheelStatus.mock.calls.length;
  await press(tree, "Snurra");
  await press(tree, "Kort");
  await act(async () => { resolveSpin({ ok: true, won: false, segment: 7, spin_id: "s1", offers: [], claim_until: null, next_spin_at: future(13) }); });
  await flush();
  expect(sb.wheelStatus.mock.calls.length).toBe(before + 1);
  expect(tabLabels(tree)).toContain("Hjul");
  expect(tabLabels(tree)).not.toContain("Hjul, nytt snurr väntar");
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Nästa snurr om"), "tillbaka");
  await flush();
  expect(wheelSegment(tree)).toBe(7);
});

test("vinst under flikbyte: vinsten ligger kvar att hämta när fliken öppnas igen", async () => {
  const tree = await start();
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Snurra"), "hjulfliken");
  let resolveSpin;
  sb.spinWheel.mockImplementation(() => new Promise((r) => { resolveSpin = r; }));
  const PRIZE = { spin_id: "s2", claim_until: future(50), offers: [{ cafe: BRYGGAN, stamps: 0, is_new: true }] };
  sb.wheelStatus.mockResolvedValue(STATUS({ can_spin: false, today: { spin_id: "s2", won: true, segment: 3 }, prize: PRIZE }));
  await press(tree, "Snurra");
  await press(tree, "Kort");
  await act(async () => { resolveSpin({ ok: true, won: true, segment: 3, spin_id: "s2", offers: PRIZE.offers, claim_until: PRIZE.claim_until, next_spin_at: future(13) }); });
  await flush();
  expect(tabLabels(tree)).toContain("Hjul, nytt snurr väntar");      // oupphämtad vinst = prick
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Du har en dubbelstämpel att hämta"), "vinsten finns kvar");
  expect(wheelSegment(tree)).toBe(3);
});

test("långsam appstart skriver inte över läget efter ett snurr", async () => {
  let resolveStatus;
  sb.loadCafes.mockResolvedValue([MIYABI, BRYGGAN]);
  sb.wheelStatus.mockImplementationOnce(() => new Promise((r) => { resolveStatus = r; }));   // appstartens hämtning hänger
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Dina kort"), "start");
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Snurra"), "hjulfliken");      // flikens egen hämtning
  sb.spinWheel.mockResolvedValue({ ok: true, won: false, segment: 1, spin_id: "s1", offers: [], claim_until: null, next_spin_at: future(13) });
  sb.wheelStatus.mockResolvedValue(STATUS({ can_spin: false, today: { spin_id: "s1", won: false, segment: 1 } }));
  await press(tree, "Snurra");
  await tick(4500);
  await until(() => text(tree).includes("Nästa snurr om"), "efter snurret");
  await act(async () => { resolveStatus(STATUS()); });               // det gamla svaret kommer sist
  await flush();
  expect(text(tree)).toContain("Nästa snurr om");
  expect(tabLabels(tree)).not.toContain("Hjul, nytt snurr väntar");
});

test("dubbelstämpel hos alla ställen i staden: ingen prick, tydlig knapp och inget misslett snurr", async () => {
  sb.wheelStatus.mockResolvedValue(STATUS({
    cities: [{ city: "Stockholm", places: 2, available: 0 }],
    bonuses: [{ cafe: MIYABI, expires_at: future(30) }, { cafe: BRYGGAN, expires_at: future(50) }],
  }));
  const tree = await start();
  await flush();
  expect(tabLabels(tree)).toContain("Hjul");
  expect(tabLabels(tree)).not.toContain("Hjul, nytt snurr väntar");
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Använd en dubbelstämpel först"), "spärrad knapp");
  expect(text(tree)).toContain("Du har dubbelstämplar hos alla ställen i Stockholm");
  expect(sb.spinWheel).not.toHaveBeenCalled();
});

test("all_bonused från servern ger rätt besked (inte 'Inga ställen')", async () => {
  sb.spinWheel.mockResolvedValue({ ok: false, error: "all_bonused" });
  const tree = await start();
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Snurra"), "hjulfliken");
  const before = sb.wheelStatus.mock.calls.length;
  await press(tree, "Snurra");
  await until(() => text(tree).includes("Du har redan dubbelstämplar i Stockholm"), "besked");
  expect(text(tree)).not.toContain("Inga ställen");
  expect(sb.wheelStatus.mock.calls.length).toBe(before + 1);
});

test("nätfel vid snurr: läget stäms av med servern", async () => {
  sb.spinWheel.mockResolvedValue({ ok: false, error: "network" });
  const tree = await start();
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Snurra"), "hjulfliken");
  const before = sb.wheelStatus.mock.calls.length;
  await press(tree, "Snurra");
  await flush();
  expect(sb.wheelStatus.mock.calls.length).toBe(before + 1);
});

test("tillbaka från bakgrunden: kort och hjul hämtas igen", async () => {
  const tree = await start();
  await flush();
  const wallet = sb.loadWallet.mock.calls.length, wheel = sb.wheelStatus.mock.calls.length;
  const handler = AppState.addEventListener.mock.calls.filter(([ev]) => ev === "change").map(([, h]) => h).pop();
  await act(async () => { handler("background"); });
  await act(async () => { handler("active"); });
  await flush();
  expect(sb.loadWallet.mock.calls.length).toBe(wallet + 1);
  expect(sb.wheelStatus.mock.calls.length).toBe(wheel + 1);
});

test("utgången dubbelstämpel visas inte på kortet eller under Ställen", async () => {
  sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 3, pending: false, bonus_expires_at: past(30) }]);
  const tree = await start();
  await flush();
  expect(text(tree)).not.toContain("Dubbelstämpel aktiv");
  await press(tree, "Ställen");
  await flush();
  expect(text(tree)).not.toContain("×2");
});

test("kampanjen pausad (inga städer): oupphämtad vinst och aktiva bonusar syns ändå", async () => {
  const PRIZE = { spin_id: "s9", claim_until: future(40), offers: [{ cafe: BRYGGAN, stamps: 0, is_new: true }] };
  sb.wheelStatus.mockResolvedValue(STATUS({ can_spin: false, cities: [], prize: PRIZE, bonuses: [{ cafe: MIYABI, expires_at: future(20) }] }));
  const tree = await start();
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Dagens hjul startar snart"), "pausat");
  expect(text(tree)).toContain("Du har en dubbelstämpel att hämta");
  expect(text(tree)).toContain("DINA DUBBELSTÄMPLAR");
});
