// Fler belöningar (v10): kunden väljer en mindre belöning (kortet börjar om på resten)
// eller samlar vidare till huvudbelöningen.
import React from "react";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, until, tick, flush, press } from "./helpers";

jest.setTimeout(60000);
jest.mock("../src/lib/supabase", () => ({ saveReward: jest.fn(), getCurrentSavedCode: jest.fn(), redeemByTap: jest.fn(), cancelSavedReward: jest.fn() }));
jest.mock("../src/lib/nfc", () => ({
  IS_IOS: require("react-native").Platform.OS === "ios",
  readToken: jest.fn(() => new Promise(() => {})),
  cancelNfc: jest.fn(() => Promise.resolve()),
  setIosAlert: jest.fn(() => Promise.resolve()),
  isCancelOrTimeout: jest.fn(() => true),
}));
const sb = require("../src/lib/supabase");
const tiers = require("../src/lib/tiers");
const RewardSheet = require("../src/components/RewardSheet").default;
const LoyaltyCard = require("../src/components/LoyaltyCard").default;
const CelebrationScreen = require("../src/components/CelebrationScreen").default;

const TIERS = [{ at: 3, text: "Kanelbulle" }, { at: 5, text: "Valfri kaka" }];
const linnea = { id: "linnea", slug: "linnea", name: "Café Linnea", type: "Kafé", area: "Vasastan", reward: "En kaffe på huset", rewardShort: "Gratis kaffe", ink: "#7A4A26", needed: 10, tiers: TIERS };
const WAIT = "TapPass-stämpel mot din telefon";

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

// ── Hjälpfunktionerna ────────────────────────────────────────────────
test("cleanTiers: kontrollerar mot kortets längd, sorterar, tar bort dubbletter", () => {
  expect(tiers.cleanTiers([{ at: 5, text: " Kaka " }, { at: 3, text: "Bulle" }, { at: 10, text: "x" }, { at: 3, text: "dubbel" }, { at: 2, text: "" }, null], 10))
    .toEqual([{ at: 3, text: "Bulle" }, { at: 5, text: "Kaka" }]);
  expect(tiers.cleanTiers(undefined, 10)).toEqual([]);
});
test("rewardOptions, bestReached, tierReady och crossedTier", () => {
  const c = { ...linnea, stamps: 6 };
  expect(tiers.rewardOptions(c).map((o) => [o.at, o.text, o.full])).toEqual([[3, "Kanelbulle", false], [5, "Valfri kaka", false], [10, "Gratis kaffe", true]]);
  expect(tiers.bestReached(c).at).toBe(5);
  expect(tiers.tierReady(c).text).toBe("Valfri kaka");
  expect(tiers.tierReady({ ...c, stamps: 10 })).toBe(null);           // fullt kort är inte en "mindre belöning"
  expect(tiers.bestReached({ ...c, stamps: 2 })).toBe(null);
  expect(tiers.crossedTier({ ...c, stamps: 5 }, 1).text).toBe("Valfri kaka");
  expect(tiers.crossedTier({ ...c, stamps: 6 }, 2).text).toBe("Valfri kaka");   // dubbelstämpel 4 → 6
  expect(tiers.crossedTier({ ...c, stamps: 6 }, 1)).toBe(null);
  expect(tiers.crossedTier({ ...c, stamps: 10 }, 1)).toBe(null);       // fullt kort firas som vanligt
  expect(tiers.optionFor(c, null).title).toBe("En kaffe på huset");
  expect(tiers.carryAfter(7, 5)).toBe(2);
});

// ── Kodrutan ─────────────────────────────────────────────────────────
async function sheet(props = {}, stamps = 7) {
  sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: null });
  sb.saveReward.mockImplementation(async (slug, at) => {
    sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: "305174", tierAt: at });
    return { ok: true, code: "305174", tier_at: at };
  });
  const box = { handler: null };
  const onClose = jest.fn(), onCancelled = jest.fn(), onRedeemed = jest.fn();
  const tree = await mount(<RewardSheet visible card={{ ...linnea, stamps, pendingReward: false }} onClose={onClose} onCancelled={onCancelled} onRedeemed={onRedeemed} registerRedeem={(h) => { box.handler = h; }} {...props} />);
  const tag = async (tok) => { await act(async () => { await box.handler(tok); }); await flush(); };
  return { tree, onClose, onCancelled, onRedeemed, tag };
}

test("låst ark: välj belöning — den största som nåtts är förvald, större visar 'kvar'", async () => {
  const { tree } = await sheet();
  await until(() => text(tree).includes("Kanelbulle"), "väljaren");
  const t = text(tree);
  expect(t).toContain("Valfri kaka");
  expect(t).toContain("2 stämplar blir kvar på kortet");    // 7 − 5
  expect(t).toContain("4 stämplar blir kvar på kortet");    // 7 − 3
  expect(t).toContain("3 kvar");                            // kaffe vid 10
  expect(t).toContain("Kortet börjar om på 2/10 när belöningen är inlöst");
  const radios = tree.root.findAll((n) => n.props.accessibilityRole === "radio" && typeof n.props.onPress === "function");
  expect(radios.map((r) => r.props.accessibilityState.checked)).toEqual([false, true, false]);
  expect(radios[2].props.disabled).toBe(true);
});

test("kanelbullen: Lös in sparar nivå 3, stämpeln löser in och kortet börjar om på 4", async () => {
  sb.redeemByTap.mockResolvedValue({ ok: true, carry_over: 4, stamps: 4, tier_at: 3, reward: "Kanelbulle" });
  const { tree, tag } = await sheet();
  await until(() => text(tree).includes("Kanelbulle"), "väljaren");
  const radios = tree.root.findAll((n) => n.props.accessibilityRole === "radio" && typeof n.props.onPress === "function");
  await act(async () => { radios[0].props.onPress(); });
  expect(text(tree)).toContain("Kortet börjar om på 4/10 när belöningen är inlöst");
  await press(tree, "Lös in");
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  expect(sb.saveReward).toHaveBeenCalledWith("linnea", 3);
  expect(text(tree)).toContain("Kanelbulle");
  expect(text(tree)).toContain("Ångra – samla vidare");
  await tag("linnea-01");
  expect(text(tree)).toContain("Inlöst!");
  expect(text(tree)).toContain("7/10");          // så många som fanns innan
  expect(text(tree)).toContain("Nästa belöning efter 3 stämplar");
  await tick(2500);
  expect(text(tree)).toContain("4/10");          // 4 blir kvar
});

test("Ångra – samla vidare: den sparade mindre belöningen tas bort", async () => {
  sb.cancelSavedReward.mockResolvedValue({ ok: true, stamps: 7 });
  const { tree, onClose, onCancelled } = await sheet();
  await until(() => text(tree).includes("Kanelbulle"), "väljaren");
  await press(tree, "Lös in");
  await until(() => text(tree).includes("Ångra – samla vidare"), "stämpelskärmen");
  await press(tree, "Ångra – samla vidare");
  await flush();
  expect(sb.cancelSavedReward).toHaveBeenCalledWith("linnea");
  expect(onCancelled).toHaveBeenCalledWith("linnea");
  expect(onClose).toHaveBeenCalled();
});

test("huvudbelöningen kan inte ångras härifrån", async () => {
  const { tree } = await sheet({}, 10);
  await until(() => text(tree).includes("Gratis kaffe"), "väljaren");
  await press(tree, "Lös in");
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  expect(sb.saveReward).toHaveBeenCalledWith("linnea", 10);
  expect(text(tree)).not.toContain("Ångra – samla vidare");
});

test("från firandet (mindre belöning): sparar den valda direkt", async () => {
  const { tree } = await sheet({ autoRedeem: true, preferTier: 5 }, 6);
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  expect(sb.saveReward).toHaveBeenCalledWith("linnea", 5);
  expect(text(tree)).toContain("Valfri kaka");
});

test("sparad mindre belöning öppnas på rätt belöning", async () => {
  sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: "305174", tierAt: 3 });
  const tree = await mount(<RewardSheet visible card={{ ...linnea, stamps: 7, pendingReward: true, pendingTier: 3 }} onClose={() => {}} onRedeemed={() => {}} registerRedeem={() => {}} />);
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  expect(text(tree)).toContain("Kanelbulle");
  expect(text(tree)).not.toContain("En kaffe på huset");
});

// ── Kortet och firandet ──────────────────────────────────────────────
test("kortet: paket i rutorna för mindre belöningar och 'klar'-ruta när en nåtts", async () => {
  const onOpen = jest.fn();
  const tree = await mount(<LoyaltyCard card={{ ...linnea, stamps: 6, pendingReward: false }} onOpenReward={onOpen} />);
  expect(text(tree)).toContain("Valfri kaka klar");
  expect(text(tree)).toContain("Lös in nu eller samla vidare");
  const btn = tree.root.findAll((n) => n.props.accessibilityLabel === "Lös in Valfri kaka" && typeof n.props.onPress === "function")[0];
  await act(async () => { btn.props.onPress(); });
  expect(onOpen).toHaveBeenCalledWith("linnea");
});
test("kortet: sparad mindre belöning visar den valda belöningen", async () => {
  const tree = await mount(<LoyaltyCard card={{ ...linnea, stamps: 7, pendingReward: true, pendingTier: 5 }} onOpenReward={() => {}} />);
  expect(text(tree)).toContain("SPARAD BELÖNING");
  expect(text(tree)).toContain("Valfri kaka");
  expect(text(tree)).not.toContain("En kaffe på huset");
});
test("firandet för en mindre belöning: Lös in nu eller Samla vidare", async () => {
  const onSave = jest.fn(), onClose = jest.fn(), onRedeemNow = jest.fn();
  const tree = await mount(<CelebrationScreen visible card={{ ...linnea, stamps: 5 }} tier={{ at: 5, text: "Valfri kaka" }} onSave={onSave} onClose={onClose} onRedeemNow={onRedeemNow} />);
  await flush();
  const t = text(tree);
  expect(t).toContain("Valfri kaka klar!");
  expect(t).toContain("Eller samla vidare: 5 kvar till gratis kaffe");
  expect(t).toContain("Löser du in börjar kortet om på 0/10.");
  await press(tree, "Samla vidare");
  expect(onClose).toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});
