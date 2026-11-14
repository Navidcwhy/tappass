// Fullt kort, Inlöst! och kortbunten (2026-11-13).
import React from "react";
import { Animated } from "react-native";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, until, tick, flush, press } from "./helpers";

jest.setTimeout(60000);
jest.mock("../src/lib/supabase", () => ({ saveReward: jest.fn(), getCurrentSavedCode: jest.fn(), redeemByTap: jest.fn() }));
const Haptics = require("expo-haptics");
const sb = require("../src/lib/supabase");
const RewardSheet = require("../src/components/RewardSheet").default;
const CelebrationScreen = require("../src/components/CelebrationScreen").default;
const CardStack = require("../src/components/CardStack").default;
const LoyaltyCard = require("../src/components/LoyaltyCard").default;
const Confetti = require("../src/components/Confetti").default;
const StampRow = require("../src/components/StampRow").default;
const Shine = require("../src/components/Shine").default;

const card = { id: "miyabi", slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", reward: "En 5-bitars sushi på huset", rewardShort: "Gratis 5-bitars sushi", ink: "#1B5A66", needed: 6 };
const bryggan = { ...card, id: "bryggan", slug: "bryggan", name: "Bryggans Bageri", ink: "#56642B", needed: 8 };

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

const layout = (node, l) => act(async () => { node.props.onLayout({ nativeEvent: { layout: { x: 0, width: 358, ...l } } }); });
const pieces = (tree) => tree.root.findAll((n) => n.type === "View" && n.props.style && Array.isArray(n.props.style.transform) && n.props.style.transform.some((t) => t.scaleX !== undefined)).length;

test("inlösen med koden: koden löses upp först, sedan Inlöst! med fullt kort som börjar om", async () => {
  sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: "305174" });
  const tree = await mount(<RewardSheet visible card={{ ...card, stamps: 7, pendingReward: true }} onClose={() => {}} onRedeemed={() => {}} />);
  await until(() => text(tree).includes("Visa sifferkod i stället"), "stämpelskärmen");
  await press(tree, "Visa sifferkod i stället");
  await until(() => text(tree).includes("DIN KOD"), "koden");
  sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: null });   // personalen skriver in koden
  const before = sb.getCurrentSavedCode.mock.calls.length;
  await tick(2000);
  await until(() => sb.getCurrentSavedCode.mock.calls.length > before, "pollning");
  await flush();
  // Upplösningen: koden syns fortfarande, bekräftelsen har inte kommit än
  expect(text(tree)).toContain("DIN KOD");
  expect(text(tree)).not.toContain("Inlöst!");
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  await tick(950);
  expect(text(tree)).toContain("Inlöst!");
  expect(text(tree)).not.toContain("DIN KOD");
  expect(text(tree)).toContain("6/6");            // kortet är fullt tills stämplarna lyft
  await tick(2000);
  expect(text(tree)).toContain("1/6");            // överskottet blir kvar
  expect(Haptics.selectionAsync).toHaveBeenCalled();
});

test("koden visas siffra för siffra med hela koden som skärmläsartext", async () => {
  sb.getCurrentSavedCode.mockResolvedValue({ ok: true, code: "305174" });
  const tree = await mount(<RewardSheet visible card={{ ...card, stamps: 6, pendingReward: true }} onClose={() => {}} onRedeemed={() => {}} />);
  await until(() => text(tree).includes("Visa sifferkod i stället"), "stämpelskärmen");
  await press(tree, "Visa sifferkod i stället");
  await until(() => text(tree).includes("DIN KOD"), "kod");
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Kod 3 0 5 1 7 4").length).toBeGreaterThan(0);
  const t = text(tree);
  ["3", "0", "5", "1", "7", "4"].forEach((d) => expect(t).toContain(d));
});

test("firandet: konfettikanoner direkt, kast ur stämpeln när den har mätts", async () => {
  const tree = await mount(<CelebrationScreen visible card={{ ...card, stamps: 6 }} carry={0} onSave={() => {}} onRedeemNow={() => {}} onClose={() => {}} />);
  await flush();
  expect(pieces(tree)).toBe(40);                   // två kanoner à 20
  const mid = tree.root.findAll((n) => n.props.onLayout && n.props.style && n.props.style.flex === 1)[0];
  const badge = tree.root.findAll((n) => n.props.onLayout && n.props.style && n.props.style.width === 260)[0];
  await layout(mid, { y: 64, height: 520 });
  await layout(badge, { x: 49, y: 40, width: 260, height: 260 });
  expect(pieces(tree)).toBe(76);                   // + 36 ur stämpeln
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  await tick(460);
  expect(Haptics.impactAsync).toHaveBeenCalledWith("heavy");
});

test("konfettins fysik: banan går upp och sedan ner, och varje bit tar slut", async () => {
  const tree = await mount(<Confetti colors={["#000"]} from={[{ x: 200, y: 400, count: 12, angle: -90, spread: 10, speed: [1400, 1500] }]} />);
  const views = tree.root.findAllByType(Animated.View);
  expect(views.length).toBe(12);
  // Första bitens y-bana: stiger först (y minskar), faller sedan förbi startpunkten
  const ty = views[0].props.style.transform.find((t) => t.translateY).translateY;
  const ys = ty._config.outputRange;
  const apex = Math.min(...ys);
  expect(apex).toBeLessThan(400 - 150);
  expect(ys[ys.length - 1]).toBeGreaterThan(400);
  expect(ys.indexOf(apex)).toBeGreaterThan(0);
});

test("regnet: alla bitar startar ovanför skärmen", async () => {
  const tree = await mount(<Confetti count={20} colors={["#000", "#fff"]} />);
  const views = tree.root.findAllByType(Animated.View);
  expect(views.length).toBe(20);
  views.forEach((v) => expect(v.props.style.transform.find((t) => t.translateY).translateY._config.outputRange[0]).toBeLessThan(0));
});

test("stämplar som lyfter: fyllda först, tomma rutor kvar efteråt", async () => {
  const exits = [{ index: 5, delay: 0 }, { index: 4, delay: 70 }];
  const tree = await mount(<StampRow total={6} filled={6} tone={{ primary: "#111", deco: "#ccc", container: "#eee" }} exits={exits} />);
  // Varje lyftande stämpel har både den tomma rutan och den fyllda ovanpå
  const animated = tree.root.findAll((n) => n.type === "View" && n.props.style && Array.isArray(n.props.style.transform) && n.props.style.transform.some((t) => t.rotate !== undefined) && n.props.style.opacity !== undefined);
  expect(animated.length).toBe(2);
});

test("kortbunten: djup och glans kopplas till skrollningen när korten mätts", async () => {
  const scrollY = new Animated.Value(0);
  const cards = [{ ...card, stamps: 6, pendingReward: false }, { ...bryggan, stamps: 2, pendingReward: false }];
  const tree = await mount(<CardStack cards={cards} onOpenReward={() => {}} scrollY={scrollY} viewH={640} />);
  await flush();
  expect(text(tree)).toContain("BELÖNING KLAR");
  const list = tree.root.findAll((n) => n.type === "View" && n.props.onLayout && n.props.style && n.props.style.gap === 12)[0];
  const rows = tree.root.findAllByType(Animated.View).filter((n) => typeof n.props.onLayout === "function");
  expect(rows.length).toBe(2);
  expect(rows[0].props.style).toBeNull();          // inget djup innan korten mätts
  await layout(list, { y: 62, height: 600 });
  await layout(rows[0], { y: 0, height: 260 });
  await layout(rows[1], { y: 272, height: 200 });
  await flush();
  const [a, b] = tree.root.findAllByType(Animated.View).filter((n) => typeof n.props.onLayout === "function");
  const scaleOf = (n) => n.props.style.transform.find((t) => t.scale).scale._config;
  // Första kortet: in underifrån [62-640, +150], ut överst [62, 62+260]
  expect(scaleOf(a).inputRange).toEqual([62 - 640, 62 - 640 + 150, 62, 62 + 260]);
  expect(scaleOf(a).outputRange).toEqual([0.92, 1, 1, 0.86]);
  expect(scaleOf(b).inputRange).toEqual([334 - 640, 334 - 640 + 150, 334, 334 + 200]);
  // Glansen följer skrollningen bara på kortet med belöning
  const shines = tree.root.findAllByType(Shine);
  expect(shines.length).toBe(1);
  expect(shines[0].props.offset._config.inputRange).toEqual([62 - 640, 62 + 260]);
});

test("kortbunten med kort vid listans topp och låg lista ger giltiga intervall", async () => {
  const scrollY = new Animated.Value(0);
  const tree = await mount(<CardStack cards={[{ ...card, stamps: 2 }]} onOpenReward={() => {}} scrollY={scrollY} viewH={120} />);
  const list = tree.root.findAll((n) => n.type === "View" && n.props.onLayout && n.props.style && n.props.style.gap === 12)[0];
  await layout(list, { y: 0, height: 0 });
  await layout(tree.root.findAllByType(Animated.View).filter((n) => typeof n.props.onLayout === "function")[0], { y: 0, height: 0 });
  await flush();
  const row = tree.root.findAllByType(Animated.View).filter((n) => typeof n.props.onLayout === "function")[0];
  const r = row.props.style.transform.find((t) => t.scale).scale._config.inputRange;
  for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThanOrEqual(r[i - 1]);
});

test("glans bara på kort med belöning", async () => {
  let tree = await mount(<LoyaltyCard card={{ ...card, stamps: 6, pendingReward: false }} onOpenReward={() => {}} />);
  expect(tree.root.findAllByType(Shine).length).toBe(1);
  await unmountAll();
  tree = await mount(<LoyaltyCard card={{ ...card, stamps: 0, pendingReward: true }} onOpenReward={() => {}} />);
  expect(tree.root.findAllByType(Shine).length).toBe(1);
  await unmountAll();
  tree = await mount(<LoyaltyCard card={{ ...card, stamps: 3, pendingReward: false }} onOpenReward={() => {}} />);
  expect(tree.root.findAllByType(Shine).length).toBe(0);
});
