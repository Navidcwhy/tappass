import React from "react";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, flush } from "./helpers";

jest.setTimeout(60000);
const LoyaltyCard = require("../src/components/LoyaltyCard").default;
const StampSheet = require("../src/components/StampSheet").default;
const CelebrationScreen = require("../src/components/CelebrationScreen").default;

const card = { id: "miyabi", slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", reward: "En 5-bitars sushi på huset", rewardShort: "Gratis 5-bitars sushi", ink: "#1B5A66", needed: 6 };
const inDays = (d) => { const x = new Date(); return new Date(x.getFullYear(), x.getMonth(), x.getDate() + d).toISOString(); };

beforeEach(() => jest.useFakeTimers());
afterEach(async () => { await unmountAll(); jest.useRealTimers(); });

test("kort med aktiv dubbelstämpel visar bonusen", async () => {
  const tree = await mount(<LoyaltyCard card={{ ...card, stamps: 5, pendingReward: false, bonusExpiresAt: inDays(3) }} onOpenReward={() => {}} />);
  const t = text(tree);
  expect(t).toContain("Dubbelstämpel aktiv");
  expect(t).toMatch(/Nästa stämpel här ger 2 · t\.o\.m\. (ons|tors|fre|lör|sön|mån|tis) 23\.59/);
  expect(t).toContain("Nästa är gratis!");
  expect(t).toContain("En stämpel kvar till gratis 5-bitars sushi");
});

test("nytt ställe utan stämplar men med bonus", async () => {
  const tree = await mount(<LoyaltyCard card={{ ...card, stamps: 0, pendingReward: false, bonusExpiresAt: inDays(1) }} onOpenReward={() => {}} />);
  const t = text(tree);
  expect(t).toContain("0/6");
  expect(t).toContain("t.o.m. i dag 23.59");
});

test("sparad belöning: ingen bonusruta (stämpling pausad)", async () => {
  const tree = await mount(<LoyaltyCard card={{ ...card, stamps: 0, pendingReward: true, bonusExpiresAt: inDays(2) }} onOpenReward={() => {}} />);
  expect(text(tree)).not.toContain("Dubbelstämpel aktiv");
});

test("kort utan bonus som förut", async () => {
  const tree = await mount(<LoyaltyCard card={{ ...card, stamps: 4, pendingReward: false, bonusExpiresAt: null }} onOpenReward={() => {}} />);
  expect(text(tree)).not.toContain("Dubbelstämpel");
  expect(text(tree)).toContain("2 kvar till");
});

test("stämpelarket visar +2 vid dubbelstämpel och +1 annars", async () => {
  let tree = await mount(<StampSheet card={{ ...card, stamps: 5, added: 2 }} onClose={() => {}} />);
  await flush();
  expect(text(tree)).toContain("+1");                 // första nedslaget
  await act(async () => { jest.advanceTimersByTime(1200); });
  await flush();
  expect(text(tree)).toContain("+2");                 // andra stämpeln har landat
  expect(text(tree)).toContain("Dubbelstämpel hos Miyabi");
  expect(text(tree)).toContain("5 av 6 – nästa är gratis!");
  await unmountAll();
  tree = await mount(<StampSheet card={{ ...card, stamps: 3 }} onClose={() => {}} />);
  await flush();
  expect(text(tree)).toContain("+1");
  expect(text(tree)).toContain("Stämpel hos Miyabi");
});

test("firandet visar överskottet som följer med", async () => {
  let tree = await mount(<CelebrationScreen visible card={{ ...card, stamps: 6 }} carry={1} onSave={() => {}} onRedeemNow={() => {}} onClose={() => {}} />);
  await flush();
  expect(text(tree)).toContain("1 stämpel sparad till nästa kort");
  await unmountAll();
  tree = await mount(<CelebrationScreen visible card={{ ...card, stamps: 6 }} carry={0} onSave={() => {}} onRedeemNow={() => {}} onClose={() => {}} />);
  await flush();
  expect(text(tree)).not.toContain("sparad till nästa kort");
});
