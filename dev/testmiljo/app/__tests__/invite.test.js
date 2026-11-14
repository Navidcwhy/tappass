// Bjud in en vän (v16): hjälpfunktionerna, inbjudningsarket och appens meddelanden.
import React from "react";
import { act } from "react-test-renderer";
import { Share } from "react-native";
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
  inviteHintDismissed: jest.fn(() => Promise.resolve(false)), dismissInviteHint: jest.fn(),
  getAccount: jest.fn(() => Promise.resolve(null)), setAccount: jest.fn(), clearAccount: jest.fn(),
  accountHintDismissed: jest.fn(() => Promise.resolve(true)), dismissAccountHint: jest.fn(),
  hasOnboarded: jest.fn(() => Promise.resolve(true)), markOnboarded: jest.fn(),
  getWheelCity: jest.fn(() => Promise.resolve("Stockholm")), setWheelCity: jest.fn(),
  hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  inviteStatus: jest.fn(), ackInvites: jest.fn(() => Promise.resolve({ ok: true })), getInviteCode: jest.fn(), redeemInvite: jest.fn(),
  birthdayStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false, birthday: null, window: null, gifts: [] })),
  getAuthMethods: jest.fn(() => Promise.resolve({ email: false, apple: false, google: false })),
  accountStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false })), newDeviceId: jest.fn(() => Promise.resolve("d_ny")),
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
  redeemByTap: jest.fn(), cancelSavedReward: jest.fn(), getCafeLogo: jest.fn(),
}));

const sb = require("../src/lib/supabase");
const prefs = require("../src/lib/prefs");
const iv = require("../src/lib/invite");
const InviteSheet = require("../src/components/InviteSheet").default;

beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => { await unmountAll(); });

const NEW = { ok: true, code: "K7M3QF", can_redeem: true, redeem_until: "2026-11-21T10:00:00Z", entered: null, friends: 0, rewarded: 0, unseen: [] };

test("hjälpfunktionerna: koden, delningstexten och lägena", () => {
  expect(iv.cleanInviteCode(" k7m-3qf ")).toBe("K7M3QF");
  expect(iv.validInviteCode("k7m 3qf")).toBe(true);
  for (const bad of ["K7M3Q", "K7M3QO", "K7M3Q0", "K7M3Q1", "I7M3QF", "L7M3QF", ""]) expect(iv.validInviteCode(bad)).toBe(false);
  expect(iv.formatInviteCode("k7m3qf")).toBe("K7M 3QF");
  expect(iv.formatInviteCode("K7")).toBe("K7");
  const share = iv.shareText("K7M3QF");
  expect(share).toContain("K7M 3QF");
  expect(share).toContain("inom 7 dagar");
  expect(share).toContain("2 stämplar var");
  expect(share).toContain("https://tappass.se");
  expect(iv.inviteErrorText({ error: "own_code" })).toMatch(/din egen kod/);
  expect(iv.inviteErrorText({ error: "too_late" })).toMatch(/de första 7 dagarna/);
  expect(iv.inviteErrorText({ error: "mutual" })).toMatch(/varandras koder/);
  expect(iv.inviteErrorText({ error: "unknown_code" })).toMatch(/Koden finns inte/);
  expect(iv.inviteErrorText({ error: "network" })).toMatch(/Ingen kontakt/);
  expect(iv.enteredText({ status: "rewarded", cafe_name: "Café Linnea" })).toBe("Ni fick 2 stämplar var hos Café Linnea.");
  expect(iv.enteredText({ status: "expired" })).toMatch(/ingen bonus/);
  expect(iv.enteredText({ status: "pending", window_until: "2026-11-21T10:00:00Z" })).toMatch(/^Stämpla hos ett TapPass-ställe senast 21 november/);
  expect(iv.unseenText([{ cafe_name: "Miyabi" }])).toEqual({ title: "Din vän har stämplat!", subtitle: "Du fick 2 stämplar hos Miyabi." });
  expect(iv.unseenText([{ cafe_name: "A" }, { cafe_name: "B" }]).title).toBe("2 vänner har stämplat!");
  expect(iv.unseenText([])).toBeNull();
  expect(iv.friendsText({ friends: 3, rewarded: 1 })).toBe("1 vän har stämplat · 2 väntar");
  expect(iv.friendsText({ friends: 2, rewarded: 2 })).toBe("2 vänner har stämplat");
  expect(iv.friendsText({ friends: 0, rewarded: 0 })).toBe("");
});

test("arket: din kod delas, och en ny kund anger en väns kod", async () => {
  jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
  let status = { ...NEW, code: null };
  const onChanged = jest.fn((ev) => { if (ev.status) status = ev.status; });
  sb.getInviteCode.mockResolvedValue(NEW);
  const tree = await mount(<InviteSheet visible status={status} onChanged={onChanged} onClose={jest.fn()} />);
  await flush();
  expect(sb.getInviteCode).toHaveBeenCalled();
  expect(onChanged).toHaveBeenCalledWith({ status: NEW });
  await act(async () => { tree.update(<InviteSheet visible status={status} onChanged={onChanged} onClose={jest.fn()} />); });
  let t = text(tree);
  expect(t).toContain("Bjud in en vän");
  expect(t).toContain("K7M 3QF");
  expect(t).toContain("När din vän stämplar första gången får ni 2 stämplar var hos det stället.");
  expect(t).toContain("Har du fått en kod?");
  await press(tree, "Dela koden");
  expect(Share.share).toHaveBeenCalledWith({ message: expect.stringContaining("K7M 3QF") });
  // Fel kod: egen
  const input = () => tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Väns kod" && typeof n.props.onChangeText === "function")[0];
  await act(async () => { input().props.onChangeText("k7m 3qf"); });
  sb.redeemInvite.mockResolvedValueOnce({ ok: false, error: "own_code" });
  await press(tree, "Använd koden");
  await flush();
  expect(sb.redeemInvite).toHaveBeenCalledWith("K7M3QF");
  expect(text(tree)).toContain("Det där är din egen kod");
  // En väns kod → väntar på första stämpeln
  await act(async () => { input().props.onChangeText("abc-234"); });
  sb.redeemInvite.mockResolvedValueOnce({ ok: true, status: "pending", until: "2026-11-21T10:00:00Z" });
  await press(tree, "Använd koden");
  await flush();
  expect(sb.redeemInvite).toHaveBeenLastCalledWith("ABC234");
  expect(text(tree)).toContain("Klart! Stämpla hos ett TapPass-ställe senast 21 november så får ni 2 stämplar var.");
  expect(onChanged).toHaveBeenCalledWith({ redeemed: expect.objectContaining({ status: "pending" }) });
});

test("arket: angiven kod och kund som inte är ny", async () => {
  sb.getInviteCode.mockResolvedValue({ ...NEW, can_redeem: false, entered: { status: "rewarded", cafe_name: "Miyabi" }, friends: 2, rewarded: 1 });
  const st = { ...NEW, can_redeem: false, entered: { status: "rewarded", cafe_name: "Miyabi" }, friends: 2, rewarded: 1 };
  const tree = await mount(<InviteSheet visible status={st} onChanged={jest.fn()} onClose={jest.fn()} />);
  await flush();
  expect(text(tree)).toContain("Ni fick 2 stämplar var hos Miyabi.");
  expect(text(tree)).toContain("1 vän har stämplat · 1 väntar");
  await unmountAll();
  const old = await mount(<InviteSheet visible status={{ ...NEW, can_redeem: false }} onChanged={jest.fn()} onClose={jest.fn()} />);
  await flush();
  expect(text(old)).not.toContain("Har du fått en kod?");
  expect(text(old)).toContain("K7M 3QF");
});

// ── Appen ───────────────────────────────────────────────────────────
const LINNEA = { slug: "linnea", name: "Café Linnea", type: "Kafé", area: "Vasastan", ink_color: "#7A4A26", reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", stamps_needed: 8, city: "Stockholm" };
const WHEEL = { ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 3600e3).toISOString(), cities: [] };
const tabTo = async (tree, l) => {
  const tabs = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function");
  await act(async () => { tabs.find((x) => x.props.accessibilityLabel === l).props.onPress(); });
  await flush();
};

test("appen: inbjudaren får veta när vännen stämplat; Ställen har kortet Bjud in en vän", async () => {
  sb.inviteStatus.mockResolvedValue({ ...NEW, can_redeem: false, friends: 1, rewarded: 1, unseen: [{ cafe_slug: "linnea", cafe_name: "Café Linnea" }] });
  sb.loadCafes.mockResolvedValue([LINNEA]);
  sb.loadWallet.mockResolvedValue([{ cafe: LINNEA, stamps: 4, pending: false }]);
  sb.wheelStatus.mockResolvedValue(WHEEL);
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Din vän har stämplat!"), "meddelandet");
  expect(text(tree)).toContain("Du fick 2 stämplar hos Café Linnea.");
  expect(sb.ackInvites).toHaveBeenCalled();
  await until(() => sb.loadWallet.mock.calls.length >= 2, "korten hämtas igen");
  // Rutan under korten (kontorutan visas inte)
  expect(text(tree)).toContain("Ni får 2 stämplar var när din vän stämplar första gången.");
  await tabTo(tree, "Ställen");
  const card = tree.root.findAll((n) => n.props && n.props.accessibilityHint === "Dela din kod med en vän" && typeof n.props.onPress === "function")[0];
  expect(card).toBeTruthy();
  sb.getInviteCode.mockResolvedValue(NEW);
  await act(async () => { card.props.onPress(); });
  await flush();
  expect(text(tree)).toContain("DIN KOD");
});

test("appen: den nya kundens första stämpel ger välkomstbonusen", async () => {
  sb.inviteStatus
    .mockResolvedValueOnce({ ...NEW, code: null, can_redeem: false, entered: { status: "pending", window_until: "2026-11-21T10:00:00Z" } })
    .mockResolvedValue({ ...NEW, code: null, can_redeem: false, entered: { status: "rewarded", cafe_slug: "linnea", cafe_name: "Café Linnea" } });
  sb.loadCafes.mockResolvedValue([LINNEA]);
  sb.loadWallet.mockResolvedValue([]);
  sb.wheelStatus.mockResolvedValue(WHEEL);
  sb.tapToken.mockResolvedValue({ ok: true, cafe: LINNEA, stamps: 3, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 });
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Har du en kod från en vän?"), "tomt läge med länken");
  await until(() => sb.inviteStatus.mock.calls.length >= 1, "läget hämtat");
  const dev = tree.root.findAll((n) => n.props && typeof n.props.onPress === "function" &&
    n.findAll((x) => x.props && (x.props.children === "+1 Café Linnea" || (Array.isArray(x.props.children) && x.props.children.join("") === "+1 Café Linnea"))).length > 0);
  await act(async () => { dev[dev.length - 1].props.onPress(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
  expect(text(tree)).not.toContain("Välkomstbonus!");   // inte bakom stämpelarket
  await act(async () => { await new Promise((r) => setTimeout(r, 4200)); });   // arket stänger sig själv
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });    // läget hämtas strax efter
  await until(() => text(tree).includes("Välkomstbonus!"), "välkomstbonusen");
  expect(text(tree)).toContain("Du och din vän fick 2 stämplar var hos Café Linnea.");
});

test("appen: server före v16 — inga inbjudningar syns", async () => {
  sb.inviteStatus.mockResolvedValue({ ok: true, unavailable: true });
  sb.loadCafes.mockResolvedValue([LINNEA]);
  sb.loadWallet.mockResolvedValue([]);
  sb.wheelStatus.mockResolvedValue(WHEEL);
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Inga kort än"), "tomt läge");
  await flush();
  expect(text(tree)).not.toContain("Har du en kod från en vän?");
  await tabTo(tree, "Ställen");
  expect(text(tree)).not.toContain("Bjud in en vän");
});
