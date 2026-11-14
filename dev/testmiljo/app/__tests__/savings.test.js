// Sparat-räknaren (v10): "Du har fått 7 belöningar" och vad de var värda.
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
  redeemByTap: jest.fn(), cancelSavedReward: jest.fn(),
}));

const sb = require("../src/lib/supabase");
const sv = require("../src/lib/savings");
const tiers = require("../src/lib/tiers");
const SavingsBanner = require("../src/components/SavingsBanner").default;
const RewardSheet = require("../src/components/RewardSheet").default;
const LoyaltyCard = require("../src/components/LoyaltyCard").default;

const KR = (n) => sv.formatKr(n);
const CARDS = [
  { slug: "bryggan", name: "Bryggans Bageri", ink: "#56642B", redeemed: 4, savedKr: 128, unvalued: 0 },
  { slug: "miyabi", name: "Miyabi", ink: "#1B5A66", redeemed: 3, savedKr: 117, unvalued: 0 },
];

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

// ── Hjälpfunktionerna ────────────────────────────────────────────────
test("formatKr: hårda mellanslag, tusental, aldrig negativt", () => {
  expect(sv.formatKr(245)).toBe("245 kr");
  expect(sv.formatKr(1245)).toBe("1 245 kr");
  expect(sv.formatKr(1234567)).toBe("1 234 567 kr");
  expect(sv.formatKr(-5)).toBe("0 kr");
  expect(sv.rewardsText(1)).toBe("1 belöning");
  expect(sv.rewardsText(7)).toBe("7 belöningar");
  expect(sv.placesText([{ name: "Miyabi" }])).toBe("hos Miyabi");
  expect(sv.placesText([{ name: "A" }, { name: "B" }])).toBe("hos 2 ställen");
});

test("walletSavings: summerar, sorterar och markerar när summan är ett golv", () => {
  const s = sv.walletSavings([
    ...CARDS,
    { slug: "linnea", name: "Café Linnea", redeemed: 0, savedKr: 0, unvalued: 0 },   // inget inlöst → inte med
    { slug: "ramen", name: "Ramen Bros", redeemed: 2, savedKr: 0, unvalued: 2 },     // inga värden
  ]);
  expect([s.rewards, s.kr, s.unvalued, s.partial]).toEqual([9, 245, 2, true]);
  expect(s.places.map((p) => p.slug)).toEqual(["bryggan", "miyabi", "ramen"]);
  expect(sv.walletSavings(CARDS).partial).toBe(false);
  expect(sv.walletSavings([]).rewards).toBe(0);
  expect(sv.walletSavings([{ slug: "x", name: "X", redeemed: 2, savedKr: 0, unvalued: 2 }]).partial).toBe(false);   // inget golv utan kronor
});

test("savingsFields och keepSavings", () => {
  expect(sv.savingsFields({ rewards_redeemed: 3, saved_kr: 117, rewards_unvalued: 0 })).toEqual({ redeemed: 3, savedKr: 117, unvalued: 0 });
  expect(sv.savingsFields({})).toEqual({ redeemed: 0, savedKr: 0, unvalued: 0 });            // server före v10
  expect(sv.savingsFields({ saved_kr: "x", rewards_redeemed: -1 })).toEqual({ redeemed: 0, savedKr: 0, unvalued: 0 });
  const after = sv.keepSavings({ slug: "miyabi", stamps: 4, redeemed: 0 }, CARDS[1]);
  expect([after.stamps, after.redeemed, after.savedKr]).toEqual([4, 3, 117]);
  expect(sv.keepSavings({ slug: "ny" }, undefined)).toEqual({ slug: "ny" });
});

test("tiers: värdet följer med nivåerna och huvudbelöningen", () => {
  expect(tiers.cleanTiers([{ at: 3, text: "Bulle", value_kr: 25 }, { at: 5, text: "Kaka", value_kr: "x" }, { at: 4, text: "Muffin", value_kr: 0 }], 10))
    .toEqual([{ at: 3, text: "Bulle", value: 25 }, { at: 4, text: "Muffin" }, { at: 5, text: "Kaka" }]);
  const card = { slug: "l", name: "L", needed: 10, reward: "En kaffe", rewardShort: "Kaffe", rewardValue: 39, tiers: [{ at: 3, text: "Bulle", value: 25 }, { at: 5, text: "Kaka" }] };
  expect(tiers.rewardOptions(card).map((o) => o.value)).toEqual([25, null, 39]);
  expect([tiers.krValue(39), tiers.krValue("39"), tiers.krValue(0), tiers.krValue(10001), tiers.krValue(true), tiers.krValue(2.5), tiers.krValue(null)])
    .toEqual([39, 39, null, null, null, null, null]);
});

// ── Bannern ──────────────────────────────────────────────────────────
const pressBanner = async (tree) => {
  const b = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "button" && typeof n.props.onPress === "function")[0];
  await act(async () => { b.props.onPress(); });
};

test("bannern: antal, summa och per ställe", async () => {
  const tree = await mount(<SavingsBanner savings={sv.walletSavings(CARDS)} synced />);
  const t = text(tree);
  expect(t).toContain("Du har fått 7 belöningar");
  expect(t).toContain("hos 2 ställen");
  expect(t).toContain("SPARAT");
  expect(t).not.toContain("MINST");
  expect(t).toContain(KR(245));
  const btn = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "button")[0];
  expect(btn.props.accessibilityLabel).toBe("Du har fått 7 belöningar hos 2 ställen, värda 245 kronor. Tryck för att se per ställe.");
  await pressBanner(tree);
  const open = text(tree);
  expect(open).toContain("Bryggans Bageri ¦ 4 belöningar ¦ " + KR(128));
  expect(open).toContain("Miyabi ¦ 3 belöningar ¦ " + KR(117));
  expect(open).toContain("Värdet anges av varje ställe.");
  expect(open).not.toContain("räknas inte in");
});

test("golv och utan värden", async () => {
  const partial = [...CARDS, { slug: "ramen", name: "Ramen Bros", ink: "#7A2E1F", redeemed: 2, savedKr: 30, unvalued: 1 }];
  const tree = await mount(<SavingsBanner savings={sv.walletSavings(partial)} synced />);
  expect(text(tree)).toContain("SPARAT MINST");
  expect(text(tree)).toContain(KR(275));
  await pressBanner(tree);
  expect(text(tree)).toContain("Ramen Bros ¦ 2 belöningar ¦ minst " + KR(30));
  expect(text(tree)).toContain("räknas inte in i summan");

  const none = await mount(<SavingsBanner savings={sv.walletSavings([{ slug: "ramen", name: "Ramen Bros", ink: "#7A2E1F", redeemed: 2, savedKr: 0, unvalued: 2 }])} synced />);
  expect(text(none)).toContain("Du har fått 2 belöningar");
  expect(text(none)).toContain("hos Ramen Bros");
  expect(text(none)).not.toContain("SPARAT");
  expect(text(none)).not.toContain("kr");
});

test("utan inlösta belöningar visas ingenting", async () => {
  const tree = await mount(<SavingsBanner savings={sv.walletSavings([{ slug: "a", name: "A", redeemed: 0 }])} synced />);
  expect(tree.toJSON()).toBe(null);
});

test("räknar upp efter inlösen — först när arket stängts", async () => {
  const before = sv.walletSavings([{ ...CARDS[0], redeemed: 3, savedKr: 89 }, CARDS[1]]);   // 206 kr
  const after = sv.walletSavings(CARDS);                                                      // 245 kr
  const tree = await mount(<SavingsBanner savings={before} synced />);
  expect(text(tree)).toContain(KR(206));
  await act(async () => { tree.update(<SavingsBanner savings={after} hold synced />); });
  expect(text(tree)).toContain(KR(206));                 // bakom arket: oförändrat
  expect(text(tree)).toContain("Du har fått 7 belöningar");
  await act(async () => { tree.update(<SavingsBanner savings={after} hold={false} synced />); });
  expect(text(tree)).toContain("+" + KR(39));
  await tick(600);
  const mid = Number((text(tree).match(/(\d+) kr$/m) || [])[1]);
  await tick(2500);
  expect(text(tree)).toContain(KR(245));
  expect(text(tree)).not.toContain("+" + KR(39));
  expect(mid === undefined || Number.isNaN(mid) || mid <= 245).toBe(true);
});

test("första hämtningen från servern räknas inte upp", async () => {
  const empty = sv.walletSavings([]);
  const tree = await mount(<SavingsBanner savings={empty} synced={false} />);
  expect(tree.toJSON()).toBe(null);
  await act(async () => { tree.update(<SavingsBanner savings={sv.walletSavings(CARDS)} synced />); });
  expect(text(tree)).toContain(KR(245));
  expect(text(tree)).not.toContain("+");
});

test("första inlösta belöningen någonsin: bannern dyker upp och räknar upp", async () => {
  const tree = await mount(<SavingsBanner savings={sv.walletSavings([])} synced />);
  expect(tree.toJSON()).toBe(null);
  await act(async () => { tree.update(<SavingsBanner savings={sv.walletSavings([CARDS[1]].map((c) => ({ ...c, redeemed: 1, savedKr: 39 })))} synced />); });
  expect(text(tree)).toContain("Du har fått 1 belöning");
  expect(text(tree)).toContain("+" + KR(39));
  await tick(3000);
  expect(text(tree)).toContain(KR(39));
});

// ── Inlöst!: värdet på bekräftelsen ───────────────────────────────────
const LINNEA = { id: "linnea", slug: "linnea", name: "Café Linnea", type: "Kafé", area: "Vasastan", reward: "En kaffe på huset", rewardShort: "Gratis kaffe", ink: "#7A4A26", needed: 10, rewardValue: 39, tiers: [{ at: 3, text: "Kanelbulle", value: 25 }, { at: 5, text: "Valfri kaka" }] };

async function redeemWith(card, saved) {
  sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: "305174", ...saved });
  sb.redeemByTap.mockResolvedValue({ ok: true, carry_over: 0 });
  const box = { handler: null };
  const tree = await mount(<RewardSheet visible card={card} onClose={() => {}} onRedeemed={() => {}} registerRedeem={(h) => { box.handler = h; }} />);
  await until(() => !!box.handler && text(tree).includes("stämpel"), "väntar på stämpeln");
  const shownTitle = text(tree);
  await act(async () => { await box.handler("linnea-01"); });
  await flush();
  return { tree, shownTitle };
}

test("Inlöst!: 'Sparat 25 kr' för kanelbullen, inget värde för kakan", async () => {
  const bulle = await redeemWith({ ...LINNEA, stamps: 3, pendingReward: true, pendingTier: 3 }, { tierAt: 3, reward: "Kanelbulle" });
  await until(() => text(bulle.tree).includes("Inlöst!"), "inlöst");
  expect(text(bulle.tree)).toContain("Sparat " + KR(25));
  const label = bulle.tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Du sparade 25 kronor");
  expect(label.length).toBeGreaterThan(0);
  await unmountAll();
  const kaka = await redeemWith({ ...LINNEA, stamps: 5, pendingReward: true, pendingTier: 5 }, { tierAt: 5, reward: "Valfri kaka" });
  await until(() => text(kaka.tree).includes("Inlöst!"), "inlöst");
  expect(text(kaka.tree)).not.toContain("Sparat");
});

test("sparad belöning vars nivå butiken tagit bort: namnet från servern, inget påhittat värde", async () => {
  const card = { ...LINNEA, tiers: [{ at: 5, text: "Valfri kaka" }], stamps: 3, pendingReward: true, pendingTier: 3 };
  const { tree, shownTitle } = await redeemWith(card, { tierAt: 3, reward: "Kanelbulle" });
  expect(shownTitle).toContain("Kanelbulle");
  expect(shownTitle).not.toContain("En kaffe på huset");
  await until(() => text(tree).includes("Inlöst!"), "inlöst");
  expect(text(tree)).not.toContain("Sparat");
});

test("kortet: sparad mindre belöning heter som när den sparades", async () => {
  const tree = await mount(<LoyaltyCard card={{ ...LINNEA, tiers: [], stamps: 3, pendingReward: true, pendingTier: 3, pendingName: "Kanelbulle" }} onOpenReward={() => {}} />);
  expect(text(tree)).toContain("SPARAD BELÖNING ¦ Kanelbulle");
  const full = await mount(<LoyaltyCard card={{ ...LINNEA, stamps: 10, pendingReward: true, pendingTier: 10, pendingName: "Gratis kaffe" }} onOpenReward={() => {}} />);
  expect(text(full)).toContain("SPARAD BELÖNING ¦ En kaffe på huset");   // huvudbelöningen: den långa texten som förut
});

// ── Appen: bannern på Kort, och ett tapp tappar inte siffrorna ──────────
const MIYABI = { slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", symbol: "", ink_color: "#1B5A66", soft_color: "", deep_color: "", reward_text: "En 5-bitars sushi på huset", reward_short: "Gratis 5-bitars sushi", stamps_needed: 6, city: "Stockholm", reward_value_kr: 39 };
const BRYGGAN = { ...MIYABI, slug: "bryggan", name: "Bryggans Bageri", ink_color: "#56642B", reward_text: "En kanelbulle", reward_short: "Kanelbulle", stamps_needed: 8, reward_value_kr: 32 };

test("appen: bannern visar summan från plånboken och står kvar efter ett tapp", async () => {
  sb.loadCafes.mockResolvedValue([MIYABI, BRYGGAN]);
  sb.loadWallet.mockResolvedValue([
    { cafe: MIYABI, stamps: 3, pending: false, rewards_redeemed: 3, saved_kr: 117, rewards_unvalued: 0 },
    { cafe: BRYGGAN, stamps: 2, pending: false, rewards_redeemed: 4, saved_kr: 128, rewards_unvalued: 0 },
  ]);
  sb.wheelStatus.mockResolvedValue({ ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 3600e3).toISOString(), cities: [] });
  sb.tapToken.mockResolvedValue({ ok: true, cafe: MIYABI, stamps: 4, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 });
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Du har fått 7 belöningar"), "bannern");
  expect(text(tree)).toContain(KR(245));
  const dev = tree.root.findAll((n) => n.props && typeof n.props.onPress === "function" &&
    n.findAll((x) => x.props && x.props.children === "+1 Miyabi" || (Array.isArray(x.props && x.props.children) && x.props.children.join("") === "+1 Miyabi")).length > 0);
  await act(async () => { dev[dev.length - 1].props.onPress(); });
  await flush();
  await until(() => sb.tapToken.mock.calls.length === 1, "tappet");
  await tick(500);
  await until(() => text(tree).includes("4/6"), "kortet uppdaterat");
  expect(text(tree)).toContain("Du har fått 7 belöningar");
  expect(text(tree)).toContain(KR(245));
});

test("appen: server före v10 (inga sparat-fält) — ingen banner", async () => {
  sb.loadCafes.mockResolvedValue([MIYABI]);
  sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 3, pending: false }]);
  sb.wheelStatus.mockResolvedValue({ ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 3600e3).toISOString(), cities: [] });
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  expect(text(tree)).not.toContain("Du har fått");
});
