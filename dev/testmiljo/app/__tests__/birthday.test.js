// Födelsedagspresent (v15): hjälpfunktionerna, presentarket (lös in med stämpeln eller
// koden), födelsedagen på kontot och rutan under Kort.
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
  inviteHintDismissed: jest.fn(() => Promise.resolve(true)), dismissInviteHint: jest.fn(),
  getAccount: jest.fn(() => Promise.resolve(null)), setAccount: jest.fn(), clearAccount: jest.fn(),
  accountHintDismissed: jest.fn(() => Promise.resolve(true)), dismissAccountHint: jest.fn(),
  hasOnboarded: jest.fn(() => Promise.resolve(true)), markOnboarded: jest.fn(),
  getWheelCity: jest.fn(() => Promise.resolve("Stockholm")), setWheelCity: jest.fn(),
  hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  inviteStatus: jest.fn(() => Promise.resolve({ ok: true, unavailable: true })), ackInvites: jest.fn(() => Promise.resolve({ ok: true })),
  getInviteCode: jest.fn(), redeemInvite: jest.fn(),
  birthdayStatus: jest.fn(), setBirthday: jest.fn(), claimBirthday: jest.fn(), getBirthdayCode: jest.fn(), redeemBirthdayByTap: jest.fn(),
  getAuthMethods: jest.fn(() => Promise.resolve({ email: true, apple: false, google: false })),
  accountStatus: jest.fn(() => Promise.resolve({ ok: true, linked: true })), newDeviceId: jest.fn(() => Promise.resolve("d_ny")),
  sendLoginCode: jest.fn(), verifyLoginCode: jest.fn(), linkAccount: jest.fn(), rotateAccountKey: jest.fn(),
  deleteAccount: jest.fn(), endAuthSession: jest.fn(() => Promise.resolve()),
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
  redeemByTap: jest.fn(), cancelSavedReward: jest.fn(), getCafeLogo: jest.fn(),
}));

const sb = require("../src/lib/supabase");
const prefs = require("../src/lib/prefs");
const bd = require("../src/lib/birthday");
const BirthdaySheet = require("../src/components/BirthdaySheet").default;
const AccountSheet = require("../src/components/AccountSheet").default;

beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => { await unmountAll(); });

const WINDOW = { from: "2026-11-14", to: "2026-11-20" };
const G_LINNEA = { cafe_slug: "linnea", cafe_name: "Café Linnea", reward: "En kaka på huset", value_kr: 35, status: "available", code: null, redeemed_at: null, valid_until: "2026-11-20T23:00:00Z" };
const G_MIYABI = { cafe_slug: "miyabi", cafe_name: "Miyabi", reward: "Två makirullar", value_kr: null, status: "available", code: null, redeemed_at: null, valid_until: "2026-11-20T23:00:00Z" };
const STATUS = { ok: true, linked: true, birthday: { month: 11, day: 14 }, next_gift: "2026-11-14", window: WINDOW, gifts: [G_LINNEA, G_MIYABI] };
const CAFES = [{ slug: "linnea", name: "Café Linnea", ink: "#7A4A26" }, { slug: "miyabi", name: "Miyabi", ink: "#1B5A66" }];

test("hjälpfunktionerna: datum, texter och rutan", () => {
  expect(bd.daysIn(2)).toBe(29);
  expect(bd.daysIn(4)).toBe(30);
  expect(bd.daysIn(12)).toBe(31);
  expect(bd.validBirthday(2, 29)).toBe(true);
  expect(bd.validBirthday(2, 30)).toBe(false);
  expect(bd.validBirthday(13, 1)).toBe(false);
  expect(bd.validBirthday(null, 1)).toBe(false);
  expect(bd.birthdayText({ month: 5, day: 12 })).toBe("12 maj");
  expect(bd.birthdayText(null)).toBe("");
  expect(bd.dateText("2027-05-12")).toBe("12 maj 2027");
  expect(bd.dateText("2026-11-20", { year: false })).toBe("20 november");
  expect(bd.placesText([G_LINNEA])).toBe("hos Café Linnea");
  expect(bd.placesText([G_LINNEA, G_MIYABI])).toBe("hos Café Linnea och Miyabi");
  expect(bd.placesText([G_LINNEA, G_MIYABI, { cafe_name: "Nonna" }])).toBe("hos 3 ställen");
  expect(bd.bannerText(STATUS)).toEqual({ title: "Grattis på födelsedagen!", text: "2 presenter hos Café Linnea och Miyabi · t.o.m. 20 november" });
  expect(bd.bannerText({ ...STATUS, gifts: [G_LINNEA, { ...G_MIYABI, status: "redeemed" }] }).text).toBe("En present hos Café Linnea · t.o.m. 20 november");
  expect(bd.bannerText({ ...STATUS, gifts: [{ ...G_LINNEA, status: "redeemed" }] })).toBeNull();
  expect(bd.bannerText({ ...STATUS, window: null })).toBeNull();
  expect(bd.bannerText(null)).toBeNull();
  expect(bd.birthdayRowText({ birthday: { month: 5, day: 12 }, next_gift: "2027-05-12" })).toBe("12 maj · nästa present 12 maj 2027");
  expect(bd.birthdayRowText({ birthday: null })).toBe("Lägg till – få en present där det erbjuds");
});

const sheet = (props) => mount(<BirthdaySheet visible status={STATUS} cafes={CAFES} registerRedeem={() => {}} onChanged={jest.fn()} onClose={jest.fn()} {...props} />);

test("presentarket: lös in med koden — personalen skriver in den i panelen", async () => {
  const onChanged = jest.fn();
  const tree = await sheet({ onChanged });
  let t = text(tree);
  expect(t).toContain("Grattis på födelsedagen!");
  expect(t).toContain("Hämta dina presenter t.o.m. 20 november.");
  expect(t).toContain("En kaka på huset");
  expect(t).toContain("Två makirullar");
  expect(t).toContain("Presenten rör inte ditt stämpelkort");
  sb.claimBirthday.mockResolvedValueOnce({ ok: true, code: "047123", reward: "En kaka på huset" });
  sb.getBirthdayCode.mockResolvedValue({ ok: true, code: "047123", redeemed: false, redeemedAt: null });
  const lös = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Lös in presenten hos Café Linnea" && typeof n.props.onPress === "function")[0];
  await act(async () => { lös.props.onPress(); });
  await flush();
  expect(sb.claimBirthday).toHaveBeenCalledWith("linnea");
  t = text(tree);
  expect(t).toContain("Födelsedagspresent: En kaka på huset");
  expect(t).toContain("Personalen håller Café Linneas TapPass-stämpel mot din telefon.");
  await press(tree, "Visa sifferkod i stället");
  await flush();
  expect(tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Kod 0 4 7 1 2 3").length).toBeGreaterThan(0);
  expect(text(tree)).toContain("Presenten rör inte ditt stämpelkort.");
  expect(text(tree)).not.toContain("pausas");
  // Personalen löser in koden → nästa fråga ser det
  sb.getBirthdayCode.mockResolvedValue({ ok: true, code: null, redeemed: true, redeemedAt: "2026-11-14T13:32:07Z" });
  await act(async () => { await new Promise((r) => setTimeout(r, 2100)); });   // nästa fråga
  await act(async () => { await new Promise((r) => setTimeout(r, 900)); });    // koden löses upp
  await until(() => text(tree).includes("Inlöst!"), "inlöst");
  expect(text(tree)).toContain("Med koden · kl.");
  expect(onChanged).toHaveBeenCalled();
});

test("presentarket: personalen håller stämpeln mot telefonen direkt i listan (rätt ställe hittas)", async () => {
  let handler = null;
  const registerRedeem = (h) => { if (h) handler = h; };
  const onChanged = jest.fn();
  const tree = await sheet({ registerRedeem, onChanged });
  expect(handler).toBeTruthy();
  // Första försöket gäller Café Linnea; stämpeln är Miyabis → appen provar Miyabi
  sb.redeemBirthdayByTap
    .mockResolvedValueOnce({ ok: false, error: "wrong_tag", expected: "Café Linnea", got: "Miyabi" })
    .mockResolvedValueOnce({ ok: true, reward: "Två makirullar", redeemed_at: "2026-11-14T13:40:00Z" });
  await act(async () => { await handler("miyabi-01"); });
  await flush();
  expect(sb.redeemBirthdayByTap.mock.calls).toEqual([["linnea", "miyabi-01"], ["miyabi", "miyabi-01"]]);
  expect(text(tree)).toContain("Inlöst!");
  expect(text(tree)).toContain("Födelsedagspresent: Två makirullar");
  expect(text(tree)).toContain("Med stämpeln · kl.");
  expect(onChanged).toHaveBeenCalled();
  // Klar → tillbaka till listan
  await press(tree, "Klar");
  expect(text(tree)).toContain("Hämta dina presenter");
});

test("presentarket: fel stämpel i väntläget, redan inlöst och inlösta rader", async () => {
  let handler = null;
  const tree = await sheet({ registerRedeem: (h) => { if (h) handler = h; }, status: { ...STATUS, gifts: [G_LINNEA, { ...G_MIYABI, status: "redeemed", redeemed_at: "2026-11-14T10:00:00Z" }] } });
  expect(text(tree)).toContain("Inlöst");
  expect(tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Lös in presenten hos Miyabi").length).toBe(0);
  sb.claimBirthday.mockResolvedValueOnce({ ok: false, error: "already_redeemed" });
  const lös = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Lös in presenten hos Café Linnea" && typeof n.props.onPress === "function")[0];
  await act(async () => { lös.props.onPress(); });
  await flush();
  expect(text(tree)).toContain("Presenten hos Café Linnea är redan inlöst.");
  // Väntläget: fel butiks stämpel ger ett tydligt besked
  sb.claimBirthday.mockResolvedValueOnce({ ok: true, code: "012345" });
  sb.getBirthdayCode.mockResolvedValue({ ok: true, code: "012345", redeemed: false });
  await act(async () => { lös.props.onPress(); });
  await flush();
  sb.redeemBirthdayByTap.mockResolvedValueOnce({ ok: false, error: "wrong_tag", expected: "Café Linnea", got: "Miyabi" });
  await act(async () => { await handler("miyabi-01"); });
  await flush();
  expect(text(tree)).toContain("Fel stämpel");
  expect(text(tree)).toContain("Använd Café Linnea-stämpeln.");
});

test("kontot: välj födelsedag, spara och ta bort", async () => {
  const onChanged = jest.fn();
  const tree = await mount(<AccountSheet visible account={{ email: "anna@exempel.se" }} onChanged={onChanged} onClose={jest.fn()}
    birthdayOn birthday={{ ok: true, birthday: null, next_gift: null }} />);
  await flush();
  expect(text(tree)).toContain("Lägg till – få en present där det erbjuds");
  await press(tree, "Födelsedag");
  expect(text(tree)).toContain("Din födelsedag");
  expect(text(tree)).toContain("Vi sparar bara dag och månad, inte året.");
  const pick = async (l) => { const el = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === l && typeof n.props.onPress === "function")[0]; await act(async () => { el.props.onPress(); }); };
  await pick("januari");
  await pick("31");
  await pick("februari");   // 31 finns inte i februari → dagen väljs om
  expect(text(tree)).not.toContain("Spara 31 februari");
  expect(tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "30" && n.props.accessibilityState && n.props.accessibilityState.disabled).length).toBeGreaterThan(0);
  await pick("maj");
  await pick("12");
  sb.setBirthday.mockResolvedValueOnce({ ok: true, birthday: { month: 5, day: 12 }, next_gift: "2027-05-12" });
  await press(tree, "Spara 12 maj");
  await flush();
  expect(sb.setBirthday).toHaveBeenCalledWith(5, 12);
  expect(text(tree)).toContain("Sparat. Nästa present: 12 maj 2027.");
  expect(onChanged).toHaveBeenCalledWith({ type: "birthday", result: expect.objectContaining({ next_gift: "2027-05-12" }) });
  await unmountAll();

  const had = await mount(<AccountSheet visible account={{ email: "anna@exempel.se" }} onChanged={onChanged} onClose={jest.fn()}
    birthdayOn birthday={{ ok: true, birthday: { month: 5, day: 12 }, next_gift: "2027-05-12" }} />);
  await flush();
  expect(text(had)).toContain("12 maj · nästa present 12 maj 2027");
  await press(had, "Födelsedag");
  sb.setBirthday.mockResolvedValueOnce({ ok: true, birthday: null, next_gift: null });
  await press(had, "Ta bort födelsedag");
  await flush();
  expect(sb.setBirthday).toHaveBeenLastCalledWith(null, null);
  expect(text(had)).toContain("Födelsedagen är borttagen.");
});

test("kontot: utan v15 på servern syns ingen födelsedagsrad", async () => {
  const tree = await mount(<AccountSheet visible account={{ email: "anna@exempel.se" }} onChanged={jest.fn()} onClose={jest.fn()} />);
  await flush();
  expect(text(tree)).toContain("Ditt konto");
  expect(text(tree)).not.toContain("Födelsedag");
});

// ── Appen ───────────────────────────────────────────────────────────
const LINNEA_ROW = { slug: "linnea", name: "Café Linnea", type: "Kafé", area: "Vasastan", ink_color: "#7A4A26", reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", stamps_needed: 8, city: "Stockholm", birthday_text: "En kaka på huset", birthday_value_kr: 35 };
const WHEEL = { ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 3600e3).toISOString(), cities: [] };
const label = (tree, l) => tree.root.findAll((n) => n.props && n.props.accessibilityLabel === l && typeof n.props.onPress === "function")[0];

test("appen: grattisrutan under Kort öppnar presenterna; Ställen visar presenten", async () => {
  prefs.getAccount.mockResolvedValue({ email: "anna@exempel.se" });
  sb.birthdayStatus.mockResolvedValue({ ...STATUS, gifts: [G_LINNEA] });
  sb.loadCafes.mockResolvedValue([LINNEA_ROW]);
  sb.loadWallet.mockResolvedValue([{ cafe: LINNEA_ROW, stamps: 3, pending: false }]);
  sb.wheelStatus.mockResolvedValue(WHEEL);
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Grattis på födelsedagen!"), "rutan");
  expect(text(tree)).toContain("En present hos Café Linnea · t.o.m. 20 november");
  const banner = tree.root.findAll((n) => n.props && n.props.accessibilityHint === "Visa dina födelsedagspresenter" && typeof n.props.onPress === "function")[0];
  await act(async () => { banner.props.onPress(); });
  await flush();
  expect(text(tree)).toContain("Hämta dina presenter t.o.m. 20 november.");
  await press(tree, "Stäng");
  await flush();
  // Ställets sida
  const tabs = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function");
  await act(async () => { tabs.find((x) => x.props.accessibilityLabel === "Ställen").props.onPress(); });
  await flush();
  const place = tree.root.findAll((n) => n.props && n.props.accessibilityHint === "Visa mer om Café Linnea" && typeof n.props.onPress === "function")[0];
  await act(async () => { place.props.onPress(); });
  await flush();
  expect(text(tree)).toContain("Födelsedagspresent");
  expect(text(tree)).toContain("En kaka på huset – på födelsedagen, för dig med konto");
});

test("appen: utan konto hämtas ingen födelsedag och ingen ruta visas", async () => {
  prefs.getAccount.mockResolvedValue(null);
  sb.loadCafes.mockResolvedValue([LINNEA_ROW]);
  sb.loadWallet.mockResolvedValue([{ cafe: LINNEA_ROW, stamps: 3, pending: false }]);
  sb.wheelStatus.mockResolvedValue(WHEEL);
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Café Linnea"), "plånboken");
  await flush();
  expect(sb.birthdayStatus).not.toHaveBeenCalled();
  expect(text(tree)).not.toContain("Grattis på födelsedagen!");
});
