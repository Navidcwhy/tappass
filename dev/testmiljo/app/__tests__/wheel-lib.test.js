import { targetRotation, segmentAt, restRotation, countdownText, expiryText, pickCity, WIN_SEGMENTS, isWinSegment } from "../src/lib/wheel";

test("snurret landar alltid på serverns fält och går minst sex varv", () => {
  for (let k = 0; k < 2000; k++) {
    const cur = (Math.random() * 2 - 1) * 5000;
    const seg = Math.floor(Math.random() * 10);
    const jitter = Math.random() * 40 - 20;            // även utanför tillåtet spann — klampas
    const t = targetRotation(cur, seg, { jitter });
    expect(segmentAt(t)).toBe(seg);
    expect(t - cur).toBeGreaterThanOrEqual(6 * 360);
    expect(t - cur).toBeLessThan(7 * 360);
  }
});

test("vila visar rätt fält och vinstfälten är 0, 3, 5, 8", () => {
  for (let s = 0; s < 10; s++) expect(segmentAt(restRotation(s))).toBe(s);
  expect(WIN_SEGMENTS).toEqual([0, 3, 5, 8]);
  expect([...Array(10).keys()].filter(isWinSegment).length).toBe(4);
});

test("nedräkning", () => {
  const now = Date.parse("2026-11-04T10:38:00Z");
  expect(countdownText("2026-11-04T23:00:00Z", now)).toBe("12 h 22 min");
  expect(countdownText("2026-11-04T11:00:00Z", now)).toBe("22 min");
  expect(countdownText("2026-11-04T12:38:00Z", now)).toBe("2 h");
  expect(countdownText("2026-11-04T10:38:20Z", now)).toBe("1 min");
  expect(countdownText("2026-11-04T10:00:00Z", now)).toBe("nu");
  expect(countdownText("trasigt", now)).toBe("nu");
});

test("sista giltiga dag visas som i dag / i morgon / veckodag", () => {
  const at = (iso) => Date.parse(iso);
  // Lokal tid i testmiljön: bygg tider relativt "nu" i lokal tidszon.
  const base = new Date(2026, 10, 4, 12, 0);         // ons 4 nov 12.00 lokal tid
  const midnight = (addDays) => new Date(2026, 10, 4 + addDays, 0, 0).toISOString();
  expect(expiryText(midnight(1), base.getTime())).toBe("t.o.m. i dag 23.59");
  expect(expiryText(midnight(2), base.getTime())).toBe("t.o.m. i morgon 23.59");
  expect(expiryText(midnight(3), base.getTime())).toBe("t.o.m. fredag 23.59");
  expect(expiryText(midnight(3), base.getTime(), { short: true })).toBe("t.o.m. fre 23.59");
  expect(expiryText("trasigt", at("2026-11-04T10:00:00Z"))).toBe("");
});

test("stad väljs bara om den finns på servern", () => {
  const cities = [{ city: "Stockholm", places: 2 }, { city: "Göteborg", places: 1 }];
  expect(pickCity("stockholm", cities)).toBe("Stockholm");
  expect(pickCity("Malmö", cities)).toBe(null);
  expect(pickCity(null, cities)).toBe(null);
  expect(pickCity("Stockholm", undefined)).toBe(null);
});
