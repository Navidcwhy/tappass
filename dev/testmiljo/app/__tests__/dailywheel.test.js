import React from "react";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, press, findPressable, until, tick, flush } from "./helpers";

jest.setTimeout(60000);
jest.mock("../src/lib/supabase", () => ({ spinWheel: jest.fn(), claimWheelPrize: jest.fn() }));
jest.mock("../src/lib/prefs", () => ({ getWheelCity: jest.fn(), setWheelCity: jest.fn() }));

const { spinWheel, claimWheelPrize } = require("../src/lib/supabase");
const { getWheelCity, setWheelCity } = require("../src/lib/prefs");
const DailyWheel = require("../src/components/DailyWheel").default;

const cafe = (slug, name, extra = {}) => ({ slug, name, type: "Kafé", area: "Vasastan", ink_color: "#1B6371", stamps_needed: 6, ...extra });
const OFFERS = [
  { cafe: cafe("miyabi", "Miyabi"), stamps: 5, is_new: false },
  { cafe: cafe("bryggan", "Bryggans Bageri", { stamps_needed: 8 }), stamps: 2, is_new: false },
  { cafe: cafe("linnea", "Café Linnea"), stamps: 0, is_new: true },
];
const future = (h) => new Date(Date.now() + h * 3600000).toISOString();
const STATUS = (over = {}) => ({ ok: true, can_spin: true, next_spin_at: future(13.4), today: null, prize: null, bonuses: [], cities: [{ city: "Stockholm", places: 3 }, { city: "Göteborg", places: 1 }], ...over });

function setup(status, props = {}) {
  const onToast = jest.fn(), onClaimed = jest.fn(), onReload = jest.fn();
  return { onToast, onClaimed, onReload, el: <DailyWheel status={status} onReload={onReload} onToast={onToast} onClaimed={onClaimed} onOpenRules={() => {}} onCloseRules={() => {}} {...props} /> };
}

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); getWheelCity.mockResolvedValue("Stockholm"); });
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

test("första besöket: stadsväljaren visas och valet sparas bara på telefonen", async () => {
  getWheelCity.mockResolvedValue(null);
  const { el, onReload } = setup(STATUS());
  const tree = await mount(el);
  await until(() => text(tree).includes("Var är du?"), "stadsväljaren");
  expect(onReload).toHaveBeenCalled();
  expect(text(tree)).toContain("Vi använder inte telefonens plats");
  expect(text(tree)).toContain("3 ställen");
  await press(tree, "Göteborg");
  await press(tree, "Fortsätt");
  expect(setWheelCity).toHaveBeenCalledWith("Göteborg");
  await flush();
  expect(text(tree)).not.toContain("Var är du?");
  expect(text(tree)).toContain("Göteborg");
});

test("vinst: snurrar till serverns fält, visar tre ställen och hämtar vald vinst", async () => {
  spinWheel.mockResolvedValue({ ok: true, won: true, segment: 3, spin_id: "spin-1", offers: OFFERS, claim_until: future(60), next_spin_at: future(13) });
  claimWheelPrize.mockResolvedValue({ ok: true, cafe: OFFERS[2].cafe, expires_at: future(60), stamps: 0 });
  const { el, onClaimed, onToast } = setup(STATUS());
  const tree = await mount(el);
  await flush();
  expect(text(tree)).toContain("Stockholm");
  await press(tree, "Snurra");
  expect(spinWheel).toHaveBeenCalledWith("Stockholm");
  await flush();
  expect(text(tree)).toContain("Snurrar …");
  expect(text(tree)).not.toContain("Grattis");          // inget avslöjas förrän hjulet stannat
  await tick(4500);
  await until(() => text(tree).includes("Grattis! Dubbelstämpel"), "vinstarket");
  expect(text(tree)).toContain("Miyabi");
  expect(text(tree)).toContain("5/6");
  expect(text(tree)).toContain("Nytt för dig");
  expect(text(tree)).toContain("Använd hos Miyabi");    // första stället förvalt
  await press(tree, "Café Linnea");
  await press(tree, "Använd hos Café Linnea");
  expect(claimWheelPrize).toHaveBeenCalledWith("spin-1", "linnea");
  await until(() => onClaimed.mock.calls.length === 1, "onClaimed");
  expect(onClaimed.mock.calls[0][0].slug).toBe("linnea");
  expect(onToast).not.toHaveBeenCalled();
});

test("ingen vinst: kort text i 3 sekunder med tid till nästa snurr", async () => {
  spinWheel.mockResolvedValue({ ok: true, won: false, segment: 1, spin_id: "spin-2", offers: [], claim_until: null, next_spin_at: future(13.4) });
  const { el, onToast, onReload } = setup(STATUS());
  const tree = await mount(el);
  await flush();
  await press(tree, "Snurra");
  await flush();
  expect(onToast).not.toHaveBeenCalled();
  await tick(4500);
  await until(() => onToast.mock.calls.length === 1, "förlusttext");
  const [t, ms] = onToast.mock.calls[0];
  expect(t.type).toBe("wheel-miss");
  expect(t.text).toMatch(/^Tyvärr ingen vinst\. Försök igen om 13 h \d+ min\.$/);
  expect(ms).toBe(3000);
  expect(onReload).toHaveBeenCalledTimes(2);            // vid start + efter snurret
  expect(text(tree)).not.toContain("Grattis");
});

test("nätfel vid snurr: inget snurr, nätmeddelande, knappen tillbaka", async () => {
  spinWheel.mockResolvedValue({ ok: false, error: "network" });
  const { el, onToast } = setup(STATUS());
  const tree = await mount(el);
  await flush();
  await press(tree, "Snurra");
  await until(() => onToast.mock.calls.length === 1, "nätfel");
  expect(onToast.mock.calls[0][0].type).toBe("network");
  expect(text(tree)).toContain("Snurra");
  expect(text(tree)).not.toContain("Snurrar …");
});

test("stad utan ställen förbrukar inget snurr och säger varför", async () => {
  spinWheel.mockResolvedValue({ ok: false, error: "no_places" });
  const { el, onToast } = setup(STATUS());
  const tree = await mount(el);
  await flush();
  await press(tree, "Snurra");
  await until(() => onToast.mock.calls.length === 1, "no_places");
  expect(onToast.mock.calls[0][0].title).toBe("Inga ställen i Stockholm än");
});

test("redan snurrat i dag: knappen visar nedräkningen och går inte att trycka", async () => {
  const { el } = setup(STATUS({ can_spin: false, today: { spin_id: "s", won: false, segment: 2 } }));
  const tree = await mount(el);
  await flush();
  expect(text(tree)).toMatch(/Nästa snurr om 13 h \d+ min/);
  expect(text(tree)).toContain("Nytt snurr varje dag kl. 00.00");
  expect(findPressable(tree, "Snurra")).toBeUndefined();
});

test("oupphämtad vinst kan hämtas senare från fliken", async () => {
  const { el } = setup(STATUS({ can_spin: false, prize: { spin_id: "spin-9", claim_until: future(40), offers: OFFERS.slice(0, 2) } }));
  const tree = await mount(el);
  await flush();
  expect(text(tree)).toContain("Du har en dubbelstämpel att hämta");
  await press(tree, "Välj ställe");
  await until(() => text(tree).includes("Grattis! Dubbelstämpel"), "vinstarket");
  expect(text(tree)).toContain("Bryggans Bageri");
  expect(text(tree)).not.toContain("Café Linnea");
});

test("bonus finns redan hos stället: felrad, ingen hämtning", async () => {
  claimWheelPrize.mockResolvedValue({ ok: false, error: "bonus_exists" });
  const { el, onClaimed } = setup(STATUS({ prize: { spin_id: "spin-9", claim_until: future(40), offers: OFFERS } }));
  const tree = await mount(el);
  await flush();
  await press(tree, "Välj ställe");
  await press(tree, "Använd hos Miyabi");
  await until(() => text(tree).includes("Du har redan en dubbelstämpel hos Miyabi"), "felrad");
  expect(onClaimed).not.toHaveBeenCalled();
});

test("regler i appen (Apple 5.3) och aktiva bonusar", async () => {
  const { el } = setup(STATUS({ bonuses: [{ cafe: cafe("miyabi", "Miyabi"), expires_at: future(30) }] }), { rulesVisible: true });
  const tree = await mount(el);
  await flush();
  const t = text(tree);
  expect(t).toContain("Regler för Dagens hjul");
  expect(t).toContain("Apple och Google är inte sponsorer");
  expect(t).toContain("Fyra ger vinst – 40 % chans");
  expect(t).toContain("DINA DUBBELSTÄMPLAR");
  expect(t).toMatch(/Nästa stämpel ger 2 · t\.o\.m\. /);
});

test("hjulet nås inte: tydligt fel med försök igen", async () => {
  const { el, onReload } = setup({ ok: false, error: "network" });
  const tree = await mount(el);
  await flush();
  expect(text(tree)).toContain("Hjulet går inte att nå just nu");
  await press(tree, "Försök igen");
  expect(onReload).toHaveBeenCalledTimes(2);
});
