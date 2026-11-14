// Självservice-profil (v13): logga, öppettider, adress, webbplats och Instagram i appen.
import React from "react";
import { act } from "react-test-renderer";
import { Linking, Platform } from "react-native";
import { mount, unmountAll, text, until, flush } from "./helpers";

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
  birthdayStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false, birthday: null, window: null, gifts: [] })),
  getAuthMethods: jest.fn(() => Promise.resolve({ email: false, apple: false, google: false })),
  accountStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false })), newDeviceId: jest.fn(() => Promise.resolve("d_ny")),
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
  redeemByTap: jest.fn(), cancelSavedReward: jest.fn(), getCafeLogo: jest.fn(),
}));

const sb = require("../src/lib/supabase");
const hours = require("../src/lib/hours");
const logos = require("../src/lib/logos");
const AsyncStorage = require("@react-native-async-storage/async-storage");
const CafeAvatar = require("../src/components/CafeAvatar").default;
const PlaceSheet = require("../src/components/PlaceSheet").default;
const { mapsUrl } = require("../src/components/PlaceSheet");

beforeEach(async () => { jest.clearAllMocks(); logos._resetLogoCache(); await AsyncStorage.clear(); });
afterEach(async () => { await unmountAll(); jest.useRealTimers(); });

// Tider i svensk tid (november = UTC+1)
const at = (iso) => Date.parse(iso + "+01:00");
const H = [{ days: [1, 2, 3, 4, 5], from: "07:00", to: "18:00" }, { days: [6, 7], from: "09:00", to: "16:00" }];

test("openState/openText: öppet, stänger, öppnar senare i dag, i morgon och efter helgen", () => {
  const wed = (h) => at("2026-11-11T" + h);   // onsdag
  expect(hours.openText(hours.openState(H, wed("10:15:00")))).toBe("Öppet nu · stänger 18");
  expect(hours.openText(hours.openState(H, wed("06:30:00")))).toBe("Stängt · öppnar 7");
  expect(hours.openText(hours.openState(H, wed("18:00:00")))).toBe("Stängt · öppnar i morgon 7");
  expect(hours.openText(hours.openState(H, at("2026-11-14T17:00:00")))).toBe("Stängt · öppnar i morgon 9");   // lördag
  const monOnly = [{ days: [1], from: "08:30", to: "12:00" }];
  expect(hours.openText(hours.openState(monOnly, wed("10:00:00")))).toBe("Stängt · öppnar mån 8.30");
  expect(hours.openState([], wed("10:00:00"))).toBe(null);
  expect(hours.openState(undefined)).toBe(null);
  // Över midnatt: fre 18–24 + lör 00–02 räknas som en period
  const late = [{ days: [5], from: "18:00", to: "24:00" }, { days: [6], from: "00:00", to: "02:00" }];
  expect(hours.openText(hours.openState(late, at("2026-11-13T23:30:00")))).toBe("Öppet nu · stänger 2");
  expect(hours.openText(hours.openState(late, at("2026-11-14T01:00:00")))).toBe("Öppet nu · stänger 2");
});

test("hoursLines, siteLabel, instagramUrl och kartlänk", () => {
  expect(hours.hoursLines(H)).toEqual(["mån–fre 7–18", "lör, sön 9–16"]);
  expect(hours.siteLabel("https://www.cafelinnea.se/")).toBe("cafelinnea.se");
  expect(hours.instagramUrl("@cafe.linnea")).toBe("https://instagram.com/cafe.linnea");
  const url = mapsUrl({ name: "Café Linnea", address: "Upplandsgatan 9", city: "Stockholm" });
  expect(url).toBe((Platform.OS === "ios" ? "https://maps.apple.com/?q=" : "https://www.google.com/maps/search/?api=1&query=") + encodeURIComponent("Upplandsgatan 9, Stockholm"));
});

test("loggan: hämtas en gång per version och sparas för nästa start", async () => {
  sb.getCafeLogo.mockResolvedValue({ ok: true, version: 3, mime: "image/png", data: "iVBORw0KGgo=" });
  const [a, b] = await Promise.all([logos.loadLogo("linnea", 3), logos.loadLogo("linnea", 3)]);
  expect(a).toBe("data:image/png;base64,iVBORw0KGgo=");
  expect(b).toBe(a);
  expect(sb.getCafeLogo).toHaveBeenCalledTimes(1);                 // samtidiga anrop delar på hämtningen
  expect(await logos.loadLogo("linnea", 3)).toBe(a);
  expect(sb.getCafeLogo).toHaveBeenCalledTimes(1);                 // minnet
  logos._resetLogoCache();
  expect(await logos.loadLogo("linnea", 3)).toBe(a);
  expect(sb.getCafeLogo).toHaveBeenCalledTimes(1);                 // AsyncStorage (ny start)
  sb.getCafeLogo.mockResolvedValue({ ok: true, version: 4, mime: "image/webp", data: "UklGRg==" });
  expect(await logos.loadLogo("linnea", 4)).toBe("data:image/webp;base64,UklGRg==");   // ny version hämtas
  expect(await logos.loadLogo("linnea", 0)).toBe(null);
  sb.getCafeLogo.mockResolvedValue({ ok: false });
  logos._resetLogoCache();
  await AsyncStorage.clear();
  expect(await logos.loadLogo("miyabi", 1)).toBe(null);            // nätfel utan sparad logga
});

const LINNEA = { slug: "linnea", name: "Café Linnea", type: "Kafé", area: "Vasastan", city: "Stockholm", ink: "#7A4A26", reward: "En kaffe på huset", rewardShort: "Gratis kaffe", needed: 10, tiers: [{ at: 5, text: "Valfri kaka" }],
  quietHours: [{ days: [2], from: "14:00", to: "16:00" }], openingHours: H, address: "Upplandsgatan 9, 113 23 Stockholm", description: "Surdeg och kaffe sedan 2012.",
  website: "https://cafelinnea.se", instagram: "cafe.linnea", logoVersion: 0 };

test("avatar: loggan i cookie-formen, annars initialen", async () => {
  sb.getCafeLogo.mockResolvedValue({ ok: true, version: 2, mime: "image/png", data: "iVBORw0KGgo=" });
  const withLogo = await mount(<CafeAvatar cafe={{ ...LINNEA, logoVersion: 2 }} size={44} color="#333" />);
  await until(() => withLogo.root.findAll((n) => n.props && n.props.href && n.props.href.uri).length > 0, "loggan");
  const img = withLogo.root.findAll((n) => n.props && n.props.href && n.props.href.uri)[0];
  expect(img.props.href.uri).toBe("data:image/png;base64,iVBORw0KGgo=");
  expect(img.props.clipPath).toMatch(/^url\(#logo\d+\)$/);
  const plain = await mount(<CafeAvatar cafe={LINNEA} size={44} color="#333" />);
  expect(text(plain)).toBe("C");
  expect(sb.getCafeLogo).toHaveBeenCalledTimes(1);
});

test("ställets sida: profilen, belöningen, lugna timmar, kortet och länkarna", async () => {
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const card = { ...LINNEA, stamps: 4, pendingReward: false, visits: 12, hasLevels: true };
  const tree = await mount(<PlaceSheet cafe={LINNEA} card={card} onClose={() => {}} />);
  const t = text(tree);
  for (const s of ["Café Linnea", "Kafé · Vasastan", "Surdeg och kaffe sedan 2012.", "Gratis kaffe efter 10 stämplar", "Eller valfri kaka vid 5",
                   "Dubbla stämplar ¦ tis 14–16", "Öppettider ¦ mån–fre 7–18\nlör, sön 9–16", "Upplandsgatan 9, 113 23 Stockholm ¦ Visa på kartan",
                   "cafelinnea.se", "@cafe.linnea ¦ Instagram", "Ditt kort", "4 av 10 stämplar · Silvergäst · 13 besök till Guld"])
    expect(t).toContain(s);
  const links = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "link" && typeof n.props.onPress === "function");
  expect(links.length).toBe(3);
  for (const l of links) await act(async () => { l.props.onPress(); });
  expect(Linking.openURL.mock.calls.map((c) => c[0])).toEqual([mapsUrl(LINNEA), "https://cafelinnea.se", "https://instagram.com/cafe.linnea"]);
  const bare = await mount(<PlaceSheet cafe={{ ...LINNEA, address: "", website: "", instagram: "", description: "", openingHours: [], quietHours: [] }} card={null} onClose={() => {}} />);
  const b = text(bare);
  expect(b).not.toMatch(/Öppettider|Visa på kartan|Instagram|Ditt kort|Dubbla stämplar/);
  expect(b).toContain("Gratis kaffe efter 10 stämplar");
});

// ── Appen: Ställen ───────────────────────────────────────────────────
const ROW = { slug: "linnea", name: "Café Linnea", type: "Kafé", area: "Vasastan", symbol: "", ink_color: "#7A4A26", soft_color: "", deep_color: "", reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", stamps_needed: 10, city: "Stockholm",
  opening_hours: [{ days: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "24:00" }], address: "Upplandsgatan 9", description: "Surdeg och kaffe.", website: "https://cafelinnea.se", instagram: "cafe.linnea", logo_version: 0 };

test("appen: Ställen visar öppet nu och öppnar ställets sida", async () => {
  sb.loadCafes.mockResolvedValue([ROW]);
  sb.loadWallet.mockResolvedValue([]);
  sb.wheelStatus.mockResolvedValue({ ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 3600e3).toISOString(), cities: [] });
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Inga kort än"), "start");
  const tabs = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function");
  await act(async () => { tabs.find((x) => x.props.accessibilityLabel === "Ställen").props.onPress(); });
  await flush();
  expect(text(tree)).toContain("Öppet nu · stänger 24");
  const place = tree.root.findAll((n) => n.props && n.props.accessibilityHint === "Visa mer om Café Linnea" && typeof n.props.onPress === "function")[0];
  await act(async () => { place.props.onPress(); });
  await flush();
  expect(text(tree)).toContain("Surdeg och kaffe.");
  expect(text(tree)).toContain("Visa på kartan");
  const close = tree.root.findAll((n) => n.props && typeof n.props.onPress === "function" &&
    n.findAll((x) => x.props && x.props.children === "Stäng").length > 0);
  await act(async () => { close[close.length - 1].props.onPress(); });
  await flush();
  expect(text(tree)).not.toContain("Visa på kartan");
});
