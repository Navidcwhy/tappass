# Dynamiska taggar (NTAG 424 DNA) — v17

## Varför

Dagens taggar är statiska: `miyabi-01` som text eller adress. Den som känner token kan stämpla hemifrån via API:t — väntetiden bromsar, men stoppar inte.

En NTAG 424 DNA skriver en ny adress vid varje läsning (Secure Unique NFC, SUN):

```
https://tappass.se/t/miyabi-01?e=<32 hex>&c=<16 hex>
```

- `e` = taggens UID och läsräknare, krypterade med nyckel 1.
- `c` = en kontrollsumma (AES-CMAC) som bara går att räkna fram med nyckel 2.

Servern dekrypterar `e`, kontrollerar `c` och godkänner varje läsräknare en gång. En kopierad länk ger `replay`, en påhittad `sdm_invalid`. Varje fysisk läsning ger alltså högst en stämpel — samma sak som att stå i kassan.

Kostnad: ca 0,8–0,9 € per klistermärke, ca 1,35 € för on-metal-varianten (ShopNFC, november 2026). Klistermärken fungerar inte direkt på metall — välj on-metal där.

## Hur det fungerar

- `tap_token` är en tunn yttre funktion. Den läser `e`/`c` ur token (`"miyabi-01?e=…&c=…"`), kontrollerar dem och anropar `tap_token_core`. Kärnan är v8-versionen, oförändrad (bytt namn och stängd för klienter).
- Äldre appbyggen skickar redan `"miyabi-01?e=…&c=…"` när de läser en adresstagg i appen, så den vägen fungerar även för dem. Länkar (appen stängd) kräver appuppdateringen.
- Taggar utan nycklar fungerar exakt som förut.
- En tagg med nycklar godtar både den gamla statiska stämpeln och SUN, tills `admin_sdm_enforce` körts. Därefter godtas bara SUN (annars `sdm_required`).
- Inlösen (`redeem_by_tap` m.fl.) kontrollerar inte SUN. Den som anropar hemifrån löser bara in sin egen belöning.
- Kontrollen följer NXP AN12196 (krypterad PICC-data, CMAC över tom indata) och testas mot NXP:s och RFC 4493:s testvärden. Migrationen kör samma självtest i databasen innan den går igenom.

## Före första taggen

1. **Kör v17** efter v16 (`apply_migration`). Kontrollera fingeravtrycken i CLAUDE.md.
2. **Publicera appuppdateringen** (OTA). Den skickar med `e`/`c` från länkar och NFC och visar de nya beskeden. Krävs innan någon tagg görs "bara dynamisk".
3. **tappass.se/t/… (Lovable):** "Jag har redan appen" ska skicka med frågesträngen: `tappass://t/<token>?e=…&c=…`. Annars får iPhone-användare beskedet "Håll telefonen mot stämpeln" och måste trycka på Skanna. AASA-filen (Universal Links) gör att iPhone öppnar appen direkt.

## Per tagg

1. **SQL Editor — aldrig via AI/MCP** (nycklarna hamnar annars i chattloggar):
   ```sql
   select * from public.admin_sdm_issue_keys('miyabi-01');
   ```
   Ger tolv rader: adressen, tre nycklar och inställningarna nedan. Nycklarna visas en gång. Kör den **en gång per tagg** — körs den igen för en tagg som redan programmerats skrivs nycklarna över, och taggen kan då varken programmeras om eller återställas.
2. **Programmera taggen** med taggverktyget i TapPass-appen (nästa avsnitt).
3. **Testa:** läs av taggen med TapPass-appen (ger en stämpel), och kontrollera sedan:
   ```sql
   select * from public.admin_sdm_status();
   ```
   `forsta_lasning` ska vara ifylld och `uid_bunden` = true. Den gamla stämpeln fungerar fortfarande.
4. **Sätt upp taggen** i kassan och ta bort den gamla.
5. **Bara dynamisk** (innehåller inga hemligheter, kan köras via Supabase-kopplingen):
   ```sql
   select public.admin_sdm_enforce('miyabi-01');
   ```
   Från och med nu fungerar bara den nya taggen.

## Taggverktyget i TapPass-appen (Android)

Appen kan programmera taggen själv — ren JavaScript (`src/lib/ntag424.js` + `aes.js`), inga nya inbyggda moduler, så verktyget når telefonen med en OTA-uppdatering. iPhone stöds inte: det kräver behörigheten för ISO 7816-kommandon i ett nytt butiksbygge.

1. **Öppna verktyget:** tryck på hjälpknappen (?) under Kort och håll fingret på bilden i tre sekunder — eller öppna länken `tappass://programmera`. Medan verktyget är öppet läser appen inga stämplar.
2. **Hämta nycklarna:** kör `admin_sdm_issue_keys` i SQL Editor, helst i telefonens webbläsare (supabase.com) så att nycklarna inte behöver flyttas mellan enheter — annars via din lösenordshanterare. Aldrig via chatt, mejl eller AI.
3. **Klistra in hela resultatet** (rutnät, CSV, JSON eller Markdown — alla tolv raderna). Verktyget visar taggens namn och nycklarnas fyra sista tecken; texten med nycklarna döljs. Rad 12 jämförs med appens egen mall.
4. **Programmera taggen** och håll en ny NTAG 424 DNA mot mitten av telefonens baksida tills det står *Klart* (några sekunder). Bryts kontakten: tryck *Försök igen* — verktyget fortsätter där det slutade.
5. **Ta bort taggen** från telefonen innan du stänger verktyget (annars stämplar appen med den direkt). Fortsätt sedan med *Testa* ovan.

Vad verktyget gör, i ordning: väljer NDEF-applikationen, läser nyckelversionerna och filinställningarna, skriver NDEF-filen (ISO UPDATE BINARY, bara om den inte redan stämmer), loggar in med nyckel 0 (AuthenticateEV2First), slår på SDM (ChangeFileSettings, bara om inställningarna inte redan stämmer — en ny inställning kan nollställa läsräknaren), byter nyckel 1 och 2 och sist nyckel 0 (ChangeKey, säker kanal). Nycklar som verktyget satt får version **01** (fabrik = 00), så en avbruten programmering vet vad som redan är gjort. Till sist läser verktyget den nya adressen, kontrollerar `e`/`c` med nyckel 1 och 2 på samma sätt som servern och loggar in med den nya huvudnyckeln.

- **Nycklarna** finns bara i appens minne medan verktyget är öppet: de sparas inte, loggas inte och raderas när taggen är klar eller verktyget stängs. Varje tagg får egna nycklar.
- **Programmera i lugn och ro** — inte i kassan med kunder runt omkring. Första inloggningen sker med fabriksnyckeln, så den som avlyssnar NFC-trafiken på nära håll med specialutrustning kan i teorin räkna ut de nya nycklarna.
- **Återställa en tagg** (testtagg, fel tagg): välj *Återställ* och klistra in taggens nuvarande nycklar:
  ```sql
  select x.* from public.tag_sdm s join public.tags t on t.id = s.tag_id,
    lateral (values (1, 'Tagg', t.token), (3, 'Nyckel 0', encode(s.master_key, 'hex')),
                    (4, 'Nyckel 1', encode(s.meta_key, 'hex')), (5, 'Nyckel 2', encode(s.file_key, 'hex')))
      as x(steg, installning, varde)
  where t.token = 'miyabi-01' order by x.steg;
  ```
  Taggen går tillbaka till fabriksläget (nycklar = nollor, version 00, SDM av). Programmera den sedan med nya nycklar: `admin_sdm_issue_keys('…', p_replace => true)`.
- **Felmeddelanden:** *okänd huvudnyckel* = taggen har programmerats av ett annat verktyg (använd en ny tagg); *redan programmerad med andra nycklar* = taggen hör till en annan stämpel eller har fått nya nycklar (klistra in rätt nycklar, eller återställ); *nyckel 1 eller 2 stämmer inte* = taggens nycklar skiljer sig från de inklistrade.
- **Testat** mot NXP AN12196:s exempelvärden (inloggning, sessionsnycklar, krypterade kommandon och svar, ChangeKey), mot en simulerad tagg med avbrott vid vart och ett av kommandona, och hela vägen mot produktionens SQL i PGlite (servern godkänner den programmerade taggen). **Ännu inte mot en fysisk tagg** — prova med 2–3 taggar först.

## Inställningarna (för andra verktyg)

| Inställning | Värde |
|---|---|
| NDEF-fil (fil 02) | en URI-record med adressen från `admin_sdm_issue_keys` (prefixkod 04 = `https://`), platshållarna är nollor |
| SDM | på · UID-spegling på · läsräknare på · ASCII |
| SDMMetaRead | nyckel 1 (krypterar `e`) |
| SDMFileRead | nyckel 2 (räknar `c`) |
| SDMCtrRet | F (ingen åtkomst) |
| PICCDataOffset | rad 8 (första nollan efter `?e=`) |
| SDMMACInputOffset | **samma som SDMMACOffset** (tom MAC-indata) |
| SDMMACOffset | rad 10 (första nollan efter `&c=`) |
| Filens åtkomst | läsa fritt (E) · skriva och ändra inställningar med nyckel 0 |
| Nycklar | byt nyckel 1 och 2 först, nyckel 0 sist |

Rad 12 är hela NDEF-filen i hex (NLEN + record) för verktyg som skriver filen direkt. Offseten förutsätter prefixkod 04; skriver verktyget hela `https://…` som text flyttas de 8 byte.

**Andra verktyg** (om appens verktyg inte fungerar — testa med 2–3 taggar först):
- *NXP TagWriter* kan slå på speglingen men kan enligt LNbits dokumentation inte byta nycklar. Med standardnycklarna (nollor) är taggen inte skyddad, så TagWriter räcker inte ensamt.
- *Bolt Card-programmerarna* (Android och iOS, öppen källkod) använder samma nyckelupplägg: nyckel 1 för krypteringen och nyckel 2 för kontrollsumman. De skriver `p=` i stället för `e=`, och servern godtar båda. De är byggda för `lnurlw://`-adresser, så prova först om de tar en `https://`-adress.
- *NXP TagXplorer* (dator + USB-läsare) stöds inte längre av NXP.

## Felsökning

- **`sdm_invalid` vid varje läsning:** fel nycklar, nyckel 1 och 2 omkastade, fel offset eller MAC-indata som inte är tom. `forsta_lasning` är då tom i `admin_sdm_status`. Kör `admin_sdm_issue_keys` igen (går tills en läsning godkänts) och programmera om.
- **`replay` vid riktiga läsningar:** taggen har programmerats om och räknaren börjat om. Kör `admin_sdm_issue_keys('…', p_replace => true)` och programmera med de nya nycklarna.
- **Nödläge:** `select public.admin_sdm_disable('miyabi-01');` → statisk stämpel igen (nycklarna tas bort, `e`/`c` ignoreras).

## Säkerhet

- Nycklarna får aldrig passera AI, MCP, chatt, repo eller dokument — samma regel som butiks-PIN:er.
- Nycklarna ligger i `tag_sdm` (RLS, ingen klientåtkomst). Behövs de för att återställa eller programmera om en tagg: hämta dem i SQL Editor med frågan under *Återställa en tagg* (samma rader som taggverktyget läser).
- Kvarvarande risk: den som läser av taggen med en annan NFC-app kan spara adressen och stämpla en gång senare. Varje läsning ger högst en stämpel, och väntetiden gäller.
