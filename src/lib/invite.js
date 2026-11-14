// Bjud in en vän (v16) — rena hjälpfunktioner. Varje kund har en kod (6 tecken utan
// 0/O/1/I/L). En ny kund anger en väns kod inom 7 dagar från att appen började användas;
// när den nya kunden stämplar på riktigt inom de 7 dagarna får båda 2 stämplar var hos
// det stället. Inbjudan i sig ger inget.
import { MONTHS } from "./birthday";

export const INVITE_STAMPS = 2;
export const INVITE_DAYS = 7;
// Reglerna (användarvillkoren § 7, uppdaterade 2026-11-14)
export const TERMS_URL = "https://tappass.se/anvandarvillkor";

export const cleanInviteCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
export const validInviteCode = (s) => /^[2-9A-HJKMNP-Z]{6}$/.test(cleanInviteCode(s));
// "K7M3QF" → "K7M 3QF"
export const formatInviteCode = (code) => { const c = cleanInviteCode(code); return c.length > 3 ? c.slice(0, 3) + " " + c.slice(3) : c; };

export function shareText(code) {
  return "Jag samlar stämplar med TapPass. Ladda ner appen och ange min kod " + formatInviteCode(code) +
    " under Bjud in en vän – när du stämplar första gången (inom " + INVITE_DAYS + " dagar) får vi " + INVITE_STAMPS + " stämplar var. https://tappass.se";
}

// Tidpunkt → "21 november" (telefonens tid)
export function dayText(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return d.getDate() + " " + MONTHS[d.getMonth()];
}

export function inviteErrorText(err) {
  switch (err && typeof err === "object" ? err.error : err) {
    case "unknown_code": return "Koden finns inte. Kontrollera den och försök igen.";
    case "own_code": return "Det där är din egen kod – dela den med en vän i stället.";
    case "already_used": return "Du har redan använt en väns kod.";
    case "too_late": return "Koder kan bara anges de första " + INVITE_DAYS + " dagarna med appen.";
    case "mutual": return "Ni kan inte ange varandras koder – det räcker att en av er gör det.";
    default: return "Ingen kontakt med servern. Kontrollera nätet och försök igen.";
  }
}

// Läget för koden kunden själv angett (status.entered)
export function enteredText(entered) {
  if (!entered) return null;
  if (entered.status === "rewarded") return "Ni fick " + INVITE_STAMPS + " stämplar var" + (entered.cafe_name ? " hos " + entered.cafe_name : "") + ".";
  if (entered.status === "expired") return "Koden gällde i " + INVITE_DAYS + " dagar – den här gången blev det ingen bonus.";
  return "Stämpla hos ett TapPass-ställe senast " + dayText(entered.window_until) + " så får ni " + INVITE_STAMPS + " stämplar var.";
}

// Inbjudaren: vänner som stämplat sedan sist (status.unseen)
export function unseenText(unseen) {
  const list = Array.isArray(unseen) ? unseen : [];
  if (!list.length) return null;
  if (list.length === 1) return { title: "Din vän har stämplat!", subtitle: "Du fick " + INVITE_STAMPS + " stämplar hos " + list[0].cafe_name + "." };
  return { title: list.length + " vänner har stämplat!", subtitle: "Du fick " + INVITE_STAMPS + " stämplar för var och en." };
}

// "1 vän har stämplat · 1 väntar"
export function friendsText(status) {
  if (!status) return "";
  const done = Number(status.rewarded) || 0;
  const waiting = Math.max(0, (Number(status.friends) || 0) - done);
  const parts = [];
  if (done) parts.push(done === 1 ? "1 vän har stämplat" : done + " vänner har stämplat");
  if (waiting) parts.push(waiting + " väntar");
  return parts.join(" · ");
}
