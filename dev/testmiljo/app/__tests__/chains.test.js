// Kedjekort (v18): kedjan visas som ett kort och ett ställe med sina ställen; ställena ligger under kedjan.
import React from "react";
import { act } from "react-test-renderer";
import { Linking, Platform } from "react-native";
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
  inviteHintDismissed: jest.fn(() => Promise.resolve(true)), dismissInviteHint: jest.fn(),
  getAccount: jest.fn(() => Promise.resolve(null)), setAccount: jest.fn(), clearAccount: jest.fn(),
  accountHintDismissed: jest.fn(() => Promise.resolve(false)), dismissAccountHint: jest.fn(),
  hasOnboarded: jest.fn(() => Promise.resolve(true)), markOnboarded: jest.fn(),
  getWheelCity: jest.fn(() => Promise.resolve("Stockholm")), setWheelCity: jest.fn(),
  hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  inviteStatus: jest.fn(() => Promise.resolve({ ok: true, unavailable: true })), ackInvites: jest.fn(() => Promise.resolve({ ok: true })),
  getInviteCode: jest.fn(), redeemInvite: jest.fn(),
  birthdayStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false, birthday: null, window: null, gifts: [] })),
  getAuthMethods: jest.fn(() => Promise.resolve({ email: false, apple: false, google: false })),
  accountStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false })), newDeviceId: jest.fn(() => Promise.resolve("d_ny")),
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
  redeemByTap: jest.fn(), cancelSavedReward: jest.fn(), getCafeLogo: jest.fn(),
}));

const sb = require("../src/lib/supabase");
const chains = require("../src/lib/chains");
const PlaceSheet = require("../src/components/PlaceSheet").default;
const { mapsUrl } = require("../src/components/PlaceSheet");
const LoyaltyCard = require("../src/components/LoyaltyCard").default;

beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => { await unmountAll(); });

const HQ = { id: "u-hq", slug: "kaffekedjan", name: "Kaffekedjan", type: "Kafé", area: "Flera ställen", symbol: "coffee", ink_color: "#6B3A1F", soft_color: "", deep_color: "",
  reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", stamps_needed: 5, city: "Stockholm", is_chain: true, chain_id: null, own_card: false, opening_hours: [], logo_version: 0 };
const store = (slug, name, area, extra = {}) => ({ id: "u-" + slug, slug, name, type: "Kafé", area, symbol: "coffee", ink_color: "#6B3A1F", soft_color: "", deep_color: "",
  reward_text: "Gammal", reward_short: "Gammal", stamps_needed: 9, city: "Stockholm", is_chain: false, chain_id: "u-hq", own_card: false, opening_hours: [], logo_version: 0, ...extra });
const SODER = store("kk-soder", "Kaffekedjan Södermalm", "Södermalm", { address: "Götgatan 1" });
const VASA = store("kk-vasa", "Kaffekedjan Vasastan", "Vasastan");
const EGET = store("kk-eget", "Kaffekedjan Kungsholmen", "Kungsholmen", { own_card: true, reward_short: "Gratis bulle", stamps_needed: 4 });
const SOLO = { ...store("linnea", "Café Linnea", "Vasastan"), chain_id: null, id: "u-linnea", reward_short: "Gratis kaffe", stamps_needed: 10 };

test("placesWithChains: kedjan får sina ställen, delade ställen göms, eget kort och vanliga ställen visas", () => {
  const norm = (c) => ({ slug: c.slug, name: c.name, type: c.type, area: c.area, uuid: c.id, chainId: c.chain_id, isChain: c.is_chain, ownCard: c.own_card,
    address: c.address || "", openingHours: c.opening_hours, logoVersion: 0 });
  const list = chains.placesWithChains([VASA, HQ, SODER, EGET, SOLO].map(norm));
  expect(list.map((c) => c.slug)).toEqual(["kaffekedjan", "kk-eget", "linnea"]);
  expect(list[0].stores.map((s) => [s.slug, s.name, s.address])).toEqual([["kk-soder", "Kaffekedjan Södermalm", "Götgatan 1"], ["kk-vasa", "Kaffekedjan Vasastan", ""]]);
  expect(list[1].stores).toBeUndefined();
  // Utan v18 (inga kedjefält) är listan oförändrad
  const old = [{ slug: "a", name: "A" }, { slug: "b", name: "B" }];
  expect(chains.placesWithChains(old)).toEqual(old);
  expect(chains.placesWithChains(null)).toEqual([]);
});

test("texterna: Gäller på N ställen, rad under namnet och sökning på ställena", () => {
  expect(chains.chainText(1)).toBe("Gäller på 1 ställe");
  expect(chains.chainText(3)).toBe("Gäller på 3 ställen");
  const hq = { name: "Kaffekedjan", type: "Kafé", area: "Flera ställen", stores: [chains.storeFields(SODER), chains.storeFields(VASA)] };
  expect(chains.metaText(hq)).toBe("Kafé · Gäller på 2 ställen");
  expect(chains.metaText({ type: "Kafé", area: "Vasastan" })).toBe("Kafé · Vasastan");
  expect(chains.metaText({ type: "Kafé", area: "Vasastan", stores: [] })).toBe("Kafé · Vasastan");
  expect(chains.searchText(hq)).toContain("södermalm");
  expect(chains.storeFields({ slug: "x", name: "X", opening_hours: [{ days: [1], from: "07:00", to: "18:00" }], logo_version: "2" }))
    .toEqual({ slug: "x", name: "X", area: "", address: "", openingHours: [{ days: [1], from: "07:00", to: "18:00" }], website: "", logoVersion: 2 });
});

test("ställets sida för en kedja: belöningen och alla ställen med kartlänk", async () => {
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const cafe = { slug: "kaffekedjan", name: "Kaffekedjan", type: "Kafé", area: "Flera ställen", ink: "#6B3A1F", reward: "En kaffe på huset", rewardShort: "Gratis kaffe", needed: 5, tiers: [],
    quietHours: [], openingHours: [], address: "", description: "", website: "", instagram: "", logoVersion: 0, isChain: true,
    stores: [chains.storeFields(SODER), chains.storeFields(VASA)] };
  const tree = await mount(<PlaceSheet cafe={cafe} card={null} onClose={() => {}} />);
  const t = text(tree);
  for (const s of ["Kaffekedjan", "Kafé · Gäller på 2 ställen", "Gratis kaffe efter 5 stämplar", "Gäller på 2 ställen", "Kaffekedjan Södermalm ¦ Götgatan 1", "Kaffekedjan Vasastan ¦ Vasastan"])
    expect(t).toContain(s);
  const links = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "link" && typeof n.props.onPress === "function");
  expect(links.length).toBe(1);   // bara ställen med adress
  await act(async () => { links[0].props.onPress(); });
  expect(Linking.openURL).toHaveBeenCalledWith(mapsUrl({ name: "Kaffekedjan Södermalm", address: "Götgatan 1" }));
  // Kortets ställen räcker när listan saknar dem (kortet från load_wallet)
  const fromCard = await mount(<PlaceSheet cafe={{ ...cafe, stores: undefined }} card={{ ...cafe, stamps: 2, pendingReward: false, stores: [chains.storeFields(SODER)] }} onClose={() => {}} />);
  expect(text(fromCard)).toContain("Gäller på 1 ställe");
});

test("kortet: kedjan visar Gäller på N ställen i stället för området", async () => {
  const card = { slug: "kaffekedjan", name: "Kaffekedjan", type: "Kafé", area: "Flera ställen", ink: "#6B3A1F", reward: "En kaffe på huset", rewardShort: "Gratis kaffe", needed: 5, tiers: [],
    stamps: 2, pendingReward: false, stores: [chains.storeFields(SODER), chains.storeFields(VASA)] };
  const tree = await mount(<LoyaltyCard card={card} onOpenReward={() => {}} />);
  expect(text(tree)).toContain("Kafé · Gäller på 2 ställen");
  expect(text(tree)).not.toContain("Flera ställen");
});

test("appen: ett kedjekort, kedjan under Ställen med sökning på ställena, tappet behåller ställena", async () => {
  sb.loadCafes.mockResolvedValue([HQ, SODER, VASA, EGET, SOLO]);
  sb.loadWallet.mockResolvedValue([{ cafe: HQ, stamps: 2, pending: false, stores: [SODER, VASA].map((s) => ({ slug: s.slug, name: s.name, area: s.area, address: s.address || null, opening_hours: [], logo_version: 0 })) }]);
  sb.wheelStatus.mockResolvedValue({ ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 3600e3).toISOString(), cities: [] });
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Gäller på 2 ställen"), "kedjekortet");
  expect(text(tree)).toContain("Kaffekedjan");
  const tabs = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function");
  await act(async () => { tabs.find((x) => x.props.accessibilityLabel === "Ställen").props.onPress(); });
  await flush();
  const hints = () => tree.root.findAll((n) => n.props && typeof n.props.accessibilityHint === "string" && n.props.accessibilityHint.startsWith("Visa mer om ") && typeof n.props.onPress === "function")
    .map((n) => n.props.accessibilityHint.slice(12));
  expect([...new Set(hints())].sort()).toEqual(["Café Linnea", "Kaffekedjan", "Kaffekedjan Kungsholmen"]);
  expect(text(tree)).toContain("3 ställen");
  const input = tree.root.findAll((n) => n.props && n.props.placeholder === "Sök ställe eller område")[0];
  await act(async () => { input.props.onChangeText("södermalm"); });
  await flush();
  expect([...new Set(hints())]).toEqual(["Kaffekedjan"]);
  // Tappet hos Södermalm: arket visar stället, kortet behåller kedjans ställen
  const kort = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "tab" && n.props.accessibilityLabel === "Kort" && typeof n.props.onPress === "function")[0];
  await act(async () => { kort.props.onPress(); });
  await flush();
  sb.tapToken.mockResolvedValue({ ok: true, cafe: HQ, stamps: 3, complete: false, stamps_added: 1, bonus_applied: false, quiet_applied: false, carry_over: 0,
    place: { slug: "kk-soder", name: "Kaffekedjan Södermalm", area: "Södermalm" } });
  await press(tree, "+1 Kaffekedjan");
  await until(() => text(tree).includes("Stämpel hos Kaffekedjan Södermalm"), "stämpelarket");
  await press(tree, "Klart");
  await flush();
  expect(text(tree)).toContain("Kafé · Gäller på 2 ställen");
  expect(text(tree)).not.toContain("Flera ställen");
  expect(text(tree)).toContain("3/5");
});

test("stämpelarket: rubriken visar stället i kedjan, räkningen kedjans kort", async () => {
  jest.useFakeTimers();
  const StampSheet = require("../src/components/StampSheet").default;
  const card = { slug: "kaffekedjan", name: "Kaffekedjan", type: "Kafé", ink: "#6B3A1F", reward: "En kaffe på huset", rewardShort: "Gratis kaffe", needed: 5, tiers: [],
    stamps: 2, added: 1, place: "Kaffekedjan Södermalm" };
  const tree = await mount(<StampSheet card={card} onClose={() => {}} />);
  expect(text(tree)).toContain("Stämpel hos Kaffekedjan Södermalm");
  expect(text(tree)).toContain("2 av 5 – 3 kvar till gratis kaffe.");
  const plain = await mount(<StampSheet card={{ ...card, place: null }} onClose={() => {}} />);
  expect(text(plain)).toContain("Stämpel hos Kaffekedjan");
  jest.useRealTimers();
});
