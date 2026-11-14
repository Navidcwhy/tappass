// Födelsedagspresent (v15) — rena hjälpfunktioner. Butiken väljer om den erbjuder en
// present; kunden anger dag och månad (aldrig året) på sitt konto. Presenten gäller på
// födelsedagen och sex dagar till, hos ställen där kunden stämplat senaste året.

export const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
export const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

// 29 februari går att välja (firas 28 februari andra år)
export const daysIn = (month) => (month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31);
export const validBirthday = (m, d) => Number.isInteger(m) && Number.isInteger(d) && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(m);

// { month: 5, day: 12 } → "12 maj"
export const birthdayText = (b) => (b && validBirthday(Number(b.month), Number(b.day)) ? Number(b.day) + " " + MONTHS[Number(b.month) - 1] : "");

// "2027-05-12" → "12 maj 2027" (year: false → "12 maj")
export function dateText(iso, { year = true } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + (year ? " " + m[1] : "");
}

// Veckans presenter som inte lösts in än
export const giftsLeft = (status) => (status && status.window && Array.isArray(status.gifts) ? status.gifts.filter((g) => g && g.status !== "redeemed") : []);

// "hos Café Linnea", "hos Café Linnea och Miyabi", "hos 3 ställen"
export function placesText(gifts) {
  const names = (gifts || []).map((g) => g.cafe_name).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return "hos " + names[0];
  if (names.length === 2) return "hos " + names[0] + " och " + names[1];
  return "hos " + names.length + " ställen";
}

// Rutan överst under Kort medan veckan pågår. null = ingen present kvar.
export function bannerText(status) {
  const left = giftsLeft(status);
  if (!left.length) return null;
  const count = left.length === 1 ? "En present " : left.length + " presenter ";
  return { title: "Grattis på födelsedagen!", text: count + placesText(left) + " · t.o.m. " + dateText(status.window.to, { year: false }) };
}

// Raden på kontot: "12 maj · nästa present 12 maj 2027"
export function birthdayRowText(status) {
  const b = status && status.birthday;
  if (!b) return "Lägg till – få en present där det erbjuds";
  const next = status.next_gift ? " · nästa present " + dateText(status.next_gift) : "";
  return birthdayText(b) + next;
}
