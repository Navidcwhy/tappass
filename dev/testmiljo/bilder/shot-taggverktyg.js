// Taggverktyget (v17) i webbförhandsvisningen: dold väg i hjälpen → klistra in → programmera
// en simulerad NTAG 424 DNA → klart; sedan samma tagg med andra nycklar (fel).
const { chromium } = require("playwright");
const crypto = require("crypto");
const rows = (token) => {
  const k = [0, 1, 2].map(() => crypto.randomBytes(16).toString("hex"));
  const uri = "tappass.se/t/" + token + "?e=" + "0".repeat(32) + "&c=" + "0".repeat(16);
  const prefix = "tappass.se/t/" + token + "?e=", picc = 7 + prefix.length, mac = picc + 35;
  const ndef = (5 + uri.length).toString(16).padStart(4, "0") + "d101" + (1 + uri.length).toString(16).padStart(2, "0") + "5504" + Buffer.from(uri).toString("hex");
  return "steg\tinstallning\tvarde\n" + [
    [1, "Tagg", token], [2, "Adress (URI-record, prefix https://)", "https://" + uri],
    [3, "Nyckel 0 – huvudnyckel (AppMasterKey)", k[0]], [4, "Nyckel 1 – SDMMetaRead (krypterar e)", k[1]], [5, "Nyckel 2 – SDMFileRead (räknar c)", k[2]],
    [6, "SDM", "på · UID-spegling på · läsräknare på · ASCII"], [7, "SDM-åtkomst MetaRead / FileRead / CtrRet", "1 / 2 / F"],
    [8, "PICCDataOffset", picc + " (0x" + picc.toString(16).padStart(6, "0") + ")"],
    [9, "SDMMACInputOffset", mac + " (0x" + mac.toString(16).padStart(6, "0") + ") – samma som SDMMACOffset"],
    [10, "SDMMACOffset", mac + " (0x" + mac.toString(16).padStart(6, "0") + ")"],
    [11, "NDEF-filens åtkomst", "läsa fritt (E) · skriva och ändra inställningar med nyckel 0"], [12, "NDEF-filens innehåll (hex)", ndef],
  ].map((r) => r.join("\t")).join("\n");
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    for (const k of ["tappass.onboarded", "tappass.firstStamp", "tappass.accountHint", "tappass.inviteHint"]) localStorage.setItem(k, "1");
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/vibrate/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await p.goto("http://localhost:8099/?d=250");
  await p.getByText("Dina kort").waitFor({ timeout: 15000 });
  await p.waitForTimeout(800);

  // Dold väg: hjälpen → håll på bilden i tre sekunder
  await p.getByLabel("Hjälp och introduktion").click();
  await p.getByText("Stämpelkortet som bor i telefonen").waitFor({ timeout: 8000 });
  await p.waitForTimeout(600);
  await p.mouse.move(195, 190);
  await p.mouse.down();
  await p.waitForTimeout(3300);
  await p.mouse.up();
  await p.getByText("Programmera stämpel").waitFor({ timeout: 8000 });
  await p.waitForTimeout(700);
  await p.screenshot({ path: "shots/tag-0-tom.png" });

  // Klistra in resultatet
  await p.getByLabel("Resultatet från admin_sdm_issue_keys").fill(rows("miyabi-01"));
  await p.getByText("Nyckel 0 ••••").first().waitFor({ timeout: 5000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: "shots/tag-1-nycklar.png" });

  // Programmera: väntar på taggen → håll fram → stegen → klart
  await p.getByText("Programmera taggen", { exact: true }).last().click();
  await p.getByText("Håll taggen mot mitten av telefonens baksida.").waitFor({ timeout: 5000 });
  await p.waitForTimeout(900);
  await p.screenshot({ path: "shots/tag-2-vantar.png" });
  await p.evaluate(() => window.__tappassIsoTag({ delay: 380, fresh: true }));
  await p.locator('[aria-label="Byter nycklarna, pågår"]').waitFor({ timeout: 15000 });
  await p.waitForTimeout(250);
  await p.screenshot({ path: "shots/tag-3-programmerar.png" });
  await p.getByText("Klart – stämpeln är dynamisk").waitFor({ timeout: 20000 });
  await p.waitForTimeout(700);
  await p.screenshot({ path: "shots/tag-4-klart.png" });

  // Samma tagg med en annan taggs nycklar → tydligt fel
  await p.getByText("Programmera nästa tagg").click();
  await p.getByLabel("Resultatet från admin_sdm_issue_keys").fill(rows("kafe-bryggan-01"));
  await p.getByText("Nyckel 0 ••••").first().waitFor({ timeout: 5000 });
  await p.getByText("Programmera taggen", { exact: true }).last().click();
  await p.getByText("Håll taggen mot mitten av telefonens baksida.").waitFor({ timeout: 5000 });
  await p.evaluate(() => window.__tappassIsoTag({ delay: 60 }));
  await p.getByText("redan programmerad med andra nycklar", { exact: false }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(600);
  await p.evaluate(() => { const s = [...document.querySelectorAll("div")].filter((d) => d.scrollHeight > d.clientHeight + 40 && getComputedStyle(d).overflowY !== "visible"); s.forEach((d) => d.scrollTo(0, d.scrollHeight)); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: "shots/tag-5-fel.png" });

  const body = await p.evaluate(() => document.body.innerText);
  console.log("hela nycklar i texten:", /[0-9a-f]{32}/.test(body.replace(/0{32}/g, "")) ? "JA (fel)" : "nej");
  console.log(errs.length ? errs.join("\n") : "inga sidfel");
  await b.close();
})();
