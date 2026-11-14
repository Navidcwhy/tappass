// Regressionstester för buggfixarna 2026-11-11 (komponenter och hjälpfunktioner).
import React, { useState } from "react";
import { mount, unmountAll, text, until, flush, tick } from "./helpers";

jest.setTimeout(60000);
jest.mock("../src/lib/supabase", () => ({ saveReward: jest.fn(), getCurrentSavedCode: jest.fn(), redeemByTap: jest.fn() }));
const sb = require("../src/lib/supabase");
const RewardSheet = require("../src/components/RewardSheet").default;
const LoyaltyCard = require("../src/components/LoyaltyCard").default;
const { isActiveUntil, availableIn } = require("../src/lib/wheel");

const card = { id: "miyabi", slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", reward: "En 5-bitars sushi på huset", rewardShort: "Gratis 5-bitars sushi", ink: "#1B5A66", needed: 6 };

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(async () => { await unmountAll(); jest.useRealTimers(); });

test("Inlöst! visar överskottet som följer med (7/6 → 1/6)", async () => {
  sb.getCurrentSavedCode
    .mockResolvedValueOnce({ ok: true, code: "123456" })
    .mockResolvedValue({ ok: true, code: null });
  function Host() {
    const [c, setC] = useState({ ...card, stamps: 7, pendingReward: true });
    return <RewardSheet visible card={c} onClose={() => {}} onRedeemed={() => setC({ ...card, stamps: 1, pendingReward: false })} />;
  }
  const tree = await mount(<Host />);
  await until(() => sb.getCurrentSavedCode.mock.calls.length >= 2, "pollning");
  await tick(1000);   // koden löses upp i partiklar
  await until(() => text(tree).includes("Inlöst!"), "inlöst");
  await tick(2000);   // stämplarna lyfter och kortet börjar om
  await flush();
  const t = text(tree);
  expect(t).toContain("börjar om med 1 stämpel som följde med");
  expect(t).toContain("1/6");
  expect(t).not.toContain("från noll");
});

test("Inlöst! utan överskott säger från noll som förut", async () => {
  sb.getCurrentSavedCode.mockResolvedValueOnce({ ok: true, code: "123456" }).mockResolvedValue({ ok: true, code: null });
  const tree = await mount(<RewardSheet visible card={{ ...card, stamps: 6, pendingReward: true }} onClose={() => {}} onRedeemed={() => {}} />);
  await until(() => sb.getCurrentSavedCode.mock.calls.length >= 2, "pollning");
  await tick(1000);
  await until(() => text(tree).includes("Inlöst!"), "inlöst");
  expect(text(tree)).toContain("börjar om från noll");
  await tick(2000);
  expect(text(tree)).toContain("0/6");
});

test("låst ark: 'Kortet börjar om på 1/6' när en stämpel följer med", async () => {
  sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: null });
  const tree = await mount(<RewardSheet visible card={{ ...card, stamps: 7, pendingReward: false }} onClose={() => {}} onRedeemed={() => {}} />);
  await until(() => text(tree).includes("Kortet börjar om på"), "låst ark");
  expect(text(tree)).toContain("Kortet börjar om på 1/6 när belöningen är inlöst");
});

test("utgången dubbelstämpel visas inte som aktiv", async () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
  const tree = await mount(<LoyaltyCard card={{ ...card, stamps: 2, pendingReward: false, bonusExpiresAt: twoDaysAgo }} onOpenReward={() => {}} />);
  expect(text(tree)).not.toContain("Dubbelstämpel aktiv");
  expect(isActiveUntil(twoDaysAgo)).toBe(false);
  expect(isActiveUntil(new Date(Date.now() + 60000).toISOString())).toBe(true);
  expect(isActiveUntil(null)).toBe(false);
});

test("availableIn: v7-fältet, äldre server och okänd stad", () => {
  expect(availableIn("stockholm", [{ city: "Stockholm", places: 2, available: 0 }])).toBe(0);
  expect(availableIn("Stockholm", [{ city: "Stockholm", places: 2 }])).toBe(2);
  expect(availableIn("Malmö", [{ city: "Stockholm", places: 2, available: 1 }])).toBe(null);
});
