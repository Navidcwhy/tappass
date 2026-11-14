// Inlösen med tapp (v9): "Lös in" → personalen håller butikens stämpel mot telefonen →
// Inlöst!. Fel butiks stämpel ger ett tydligt besked. Sifferkoden finns kvar som reserv.
import React from "react";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, until, tick, flush, press } from "./helpers";

jest.setTimeout(60000);
jest.mock("../src/lib/supabase", () => ({ saveReward: jest.fn(), getCurrentSavedCode: jest.fn(), redeemByTap: jest.fn() }));
jest.mock("../src/lib/nfc", () => ({
  IS_IOS: require("react-native").Platform.OS === "ios",
  readToken: jest.fn(() => new Promise(() => {})),
  cancelNfc: jest.fn(() => Promise.resolve()),
  setIosAlert: jest.fn(() => Promise.resolve()),
  isCancelOrTimeout: jest.fn(() => true),
}));
const { Platform } = require("react-native");
const Haptics = require("expo-haptics");
const sb = require("../src/lib/supabase");
const nfc = require("../src/lib/nfc");
const RewardSheet = require("../src/components/RewardSheet").default;
const { tapErrorText } = require("../src/components/RewardSheet");
const IOS = Platform.OS === "ios";
const iosOnly = IOS ? test : test.skip;

const card = { id: "miyabi", slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", reward: "En 5-bitars sushi på huset", rewardShort: "Gratis 5-bitars sushi", ink: "#1B5A66", needed: 6 };
const WAIT = "TapPass-stämpel mot din telefon";

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

async function open({ saved = true, stamps = 7, ...props } = {}) {
  sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: saved ? "305174" : null });
  const box = { handler: null };
  const registerRedeem = jest.fn((h) => { box.handler = h; });
  const onRedeemed = jest.fn();
  const tree = await mount(<RewardSheet visible card={{ ...card, stamps, pendingReward: saved }} onClose={() => {}} onRedeemed={onRedeemed} registerRedeem={registerRedeem} {...props} />);
  const tag = async (token) => { await act(async () => { await box.handler(token); }); await flush(); };
  return { tree, registerRedeem, onRedeemed, tag, box };
}

test("sparad belöning: rutan väntar på stämpeln och tar emot appens läsningar", async () => {
  const { tree, registerRedeem } = await open();
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  expect(text(tree)).toContain("Personalen håller Miyabis TapPass-stämpel mot din telefon.");
  expect(registerRedeem).toHaveBeenCalledWith(expect.any(Function));
  if (IOS) expect(text(tree)).toContain("Skanna stämpeln");
  else expect(text(tree)).toContain("Redo — håll telefonen mot stämpeln");
  expect(nfc.readToken).not.toHaveBeenCalled();   // öppnad igen: iOS-arket startar inte av sig självt
});

test("fel butiks stämpel: 'Fel stämpel – använd Miyabi-stämpeln', ingen inlösen", async () => {
  sb.redeemByTap.mockResolvedValue({ ok: false, error: "wrong_tag", expected: "Miyabi", got: "Bryggans Bageri" });
  const { tree, tag, onRedeemed } = await open();
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  await tag("bryggan-01");
  expect(sb.redeemByTap).toHaveBeenCalledWith("miyabi", "bryggan-01");
  expect(text(tree)).toContain("Fel stämpel");
  expect(text(tree)).toContain("Använd Miyabi-stämpeln.");
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("error");
  expect(onRedeemed).not.toHaveBeenCalled();
  expect(text(tree)).not.toContain("Inlöst!");
});

test("rätt stämpel: Inlöst! med stämpeln och klockslag, kortet börjar om på överskottet", async () => {
  sb.redeemByTap.mockResolvedValue({ ok: true, carry_over: 1, stamps: 1 });
  const { tree, tag, onRedeemed, registerRedeem } = await open();
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  await tag("miyabi-01");
  expect(text(tree)).toContain("Inlöst!");
  expect(text(tree)).toMatch(/Inlöst med stämpeln kl\. \d\d\.\d\d\.\d\d/);
  expect(onRedeemed).toHaveBeenCalledWith("miyabi");
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  expect(registerRedeem).toHaveBeenLastCalledWith(null);   // appen stämplar som vanligt igen
  await tick(2500);
  expect(text(tree)).toContain("1/6");
});

test("en andra läsning medan inlösen pågår ignoreras", async () => {
  let resolve;
  sb.redeemByTap.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const { tree, box } = await open();
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  await act(async () => { box.handler("miyabi-01"); box.handler("miyabi-01"); });
  expect(sb.redeemByTap).toHaveBeenCalledTimes(1);
  expect(text(tree)).toContain("Löser in…");
  await act(async () => { resolve({ ok: true, carry_over: 0, stamps: 0 }); });
  await flush();
  expect(text(tree)).toContain("Inlöst!");
});

test("stämpeln innan kunden tryckt Lös in: löses in direkt från det låsta arket", async () => {
  sb.redeemByTap.mockResolvedValueOnce({ ok: false, error: "wrong_tag", expected: "Miyabi", got: "Bryggans Bageri" })
    .mockResolvedValueOnce({ ok: true, carry_over: 0, stamps: 0 });
  const { tree, tag, registerRedeem } = await open({ saved: false, stamps: 6 });
  await until(() => text(tree).includes("Belöningen kan bara lösas in en gång."), "låst ark");
  expect(registerRedeem).toHaveBeenCalledWith(expect.any(Function));
  await tag("bryggan-01");
  expect(text(tree)).toContain("Fel stämpel – Använd Miyabi-stämpeln.");
  expect(sb.saveReward).not.toHaveBeenCalled();
  await tag("miyabi-01");
  expect(text(tree)).toMatch(/Inlöst med stämpeln kl\./);
});

test("Lös in: sparar belöningen och väntar sedan på stämpeln", async () => {
  sb.saveReward.mockImplementation(async () => {
    sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: "305174" });   // servern har nu en sparad kod
    return { ok: true, code: "305174" };
  });
  const { tree } = await open({ saved: false, stamps: 6 });
  await until(() => text(tree).includes("Lös in"), "låst ark");
  expect(text(tree)).toContain("Personalen håller butikens stämpel mot telefonen");
  await press(tree, "Lös in");
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  expect(sb.saveReward).toHaveBeenCalledWith("miyabi");
  if (IOS) expect(nfc.readToken).toHaveBeenCalledWith({ alertMessage: "Håll iPhonen mot Miyabis stämpel" });
  else expect(nfc.readToken).not.toHaveBeenCalled();
});

test("Lös in utan nät: felet syns och kunden kan försöka igen", async () => {
  sb.saveReward.mockResolvedValue({ ok: false, error: "network" });
  const { tree } = await open({ saved: false, stamps: 6 });
  await until(() => text(tree).includes("Lös in"), "låst ark");
  await press(tree, "Lös in");
  await until(() => text(tree).includes("Det gick inte att lösa in"), "fel");
  expect(text(tree)).not.toContain(WAIT);
});

test("från firandet (Lös in nu): sparar direkt utan ett andra tryck", async () => {
  sb.saveReward.mockImplementation(async () => {
    sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: "305174" });   // servern har nu en sparad kod
    return { ok: true, code: "305174" };
  });
  const { tree } = await open({ saved: false, stamps: 6, autoRedeem: true });
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  expect(sb.saveReward).toHaveBeenCalledTimes(1);
});

test("sifferkoden som reserv, och tillbaka till stämpeln", async () => {
  const { tree, registerRedeem } = await open();
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  await press(tree, "Visa sifferkod i stället");
  await until(() => text(tree).includes("DIN KOD"), "koden");
  expect(text(tree)).toContain("Lös in med stämpeln i stället");
  expect(registerRedeem).toHaveBeenLastCalledWith(expect.any(Function));   // stämpeln fungerar även här
  await press(tree, "Lös in med stämpeln i stället");
  await until(() => text(tree).includes(WAIT), "stämpelskärmen igen");
});

test("personalen skrev in koden medan rutan väntar på stämpeln", async () => {
  const { tree, onRedeemed } = await open();
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: null });
  await tick(2000);
  await until(() => text(tree).includes("Inlöst!"), "inlöst");
  expect(text(tree)).toMatch(/Inlöst med koden kl\. \d\d\.\d\d\.\d\d/);
  expect(onRedeemed).toHaveBeenCalledWith("miyabi");
});

test("nyss inlöst med koden (already) räknas som inlöst", async () => {
  sb.redeemByTap.mockResolvedValue({ ok: true, already: true, carry_over: 1, stamps: 1 });
  const { tree, tag } = await open();
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  await tag("miyabi-01");
  expect(text(tree)).toMatch(/Inlöst med koden kl\./);
});

test("servern saknar inlösen med stämpel (v9 inte körd): hänvisar till koden", async () => {
  sb.redeemByTap.mockResolvedValue({ ok: false, error: "unavailable" });
  const { tree, tag } = await open();
  await until(() => text(tree).includes(WAIT), "stämpelskärmen");
  await tag("miyabi-01");
  expect(text(tree)).toContain("Fungerar inte just nu");
  expect(text(tree)).toContain("Visa sifferkoden för personalen i stället.");
});

iosOnly("iOS: Skanna stämpeln läser och löser in", async () => {
  nfc.readToken.mockResolvedValueOnce("miyabi-01");
  sb.redeemByTap.mockResolvedValue({ ok: true, carry_over: 0, stamps: 0 });
  const { tree } = await open();
  await until(() => text(tree).includes("Skanna stämpeln"), "knappen");
  await press(tree, "Skanna stämpeln");
  await until(() => text(tree).includes("Inlöst!"), "inlöst");
  expect(nfc.setIosAlert).toHaveBeenCalledWith("Stämpel läst");
  expect(sb.redeemByTap).toHaveBeenCalledWith("miyabi", "miyabi-01");
});

test("felbesked i klartext", () => {
  expect(tapErrorText({ kind: "wrong_tag", expected: "Miyabi" }, "X")).toEqual({ title: "Fel stämpel", text: "Använd Miyabi-stämpeln." });
  expect(tapErrorText({ kind: "unknown_tag" }, "Miyabi").text).toBe("Håll telefonen mot Miyabi-stämpeln.");
  expect(tapErrorText({ kind: "network" }, "Miyabi").title).toBe("Ingen anslutning");
});
