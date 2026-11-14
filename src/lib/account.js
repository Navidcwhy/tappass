// Konto (v14) — rena hjälpfunktioner för inloggningen med kod på e-post.
// Nätanropen (sendLoginCode, verifyLoginCode, linkAccount …) ligger i supabase.js.
//
// Utan konto är telefonens slumpade id kunden: stämplarna finns bara i telefonen.
// Med konto får alla inloggade telefoner kontots nyckel och samma kort.

export const PRIVACY_URL = "https://tappass.se/integritetspolicy";
export const RESEND_SECONDS = 60;   // Supabase skickar högst en kod i minuten per adress

export const cleanEmail = (s) => String(s || "").trim().toLowerCase();
export const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail(s));
// Koden är 6 siffror som standard (6–10 kan ställas in i Supabase)
export const cleanCode = (s) => String(s || "").replace(/\D/g, "").slice(0, 10);
export const codeReady = (s) => cleanCode(s).length >= 6;

// "n***@gmail.com" — samma som mask_email i SQL
export function maskEmail(email) {
  const e = String(email || "");
  const at = e.indexOf("@");
  return at < 1 ? "" : e[0] + "***" + e.slice(at);
}

// Sekunder kvar innan en ny kod kan skickas
export function resendIn(sentAt, now = Date.now()) {
  if (!sentAt) return 0;
  return Math.max(0, Math.ceil((sentAt + RESEND_SECONDS * 1000 - now) / 1000));
}

// Felkoder från supabase.js ({ ok: false, error, retryAfter? }) → text till kunden
export function accountErrorText(err) {
  const code = err && typeof err === "object" ? err.error : err;
  switch (code) {
    case "invalid_email": return "Kontrollera e-postadressen.";
    case "rate_limit":
      return err && err.retryAfter
        ? "Vänta " + err.retryAfter + " sekunder och försök igen."
        : "För många försök just nu. Vänta en stund och försök igen.";
    case "not_found": return "Det finns inget konto med den e-postadressen.";
    case "bad_code": return "Koden stämmer inte eller är för gammal. Kontrollera den eller skicka en ny.";
    case "other_account": return "Den här telefonen hör redan till ett annat konto. Logga ut från det först.";
    case "not_linked": return "Kontot hittades inte. Logga in igen.";
    case "not_signed_in": return "Inloggningen hann gå ut. Skicka en ny kod.";
    case "disabled": return "Inloggningen är inte påslagen just nu. Försök igen senare.";
    default: return "Ingen kontakt med servern. Kontrollera nätet och försök igen.";
  }
}

// Vad som hände när telefonen kopplades (svaret från account_link)
export function linkResultText(r) {
  const n = Number(r && r.moved_stamps) || 0;
  if (r && r.created) {
    return { title: "Klart – kontot är skapat", body: "Dina stämplar sparas nu på kontot. Logga in med samma e-post på en ny telefon så följer de med." };
  }
  if (r && r.already) {
    return { title: "Redan inloggad", body: "Den här telefonen är redan kopplad till kontot." };
  }
  if (r && r.merged && n > 0) {
    return {
      title: "Inloggad",
      body: (n === 1 ? "1 stämpel" : n + " stämplar") + " från den här telefonen ligger nu på kontot, tillsammans med det du samlat på dina andra telefoner.",
    };
  }
  return { title: "Välkommen tillbaka", body: "Stämplarna från ditt konto finns nu på den här telefonen." };
}
