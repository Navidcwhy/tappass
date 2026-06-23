# TapPass v5 — Merchant + redeem codes

PIN-baserad inlösen, merchant-dashboard på tappass.se/m.

## Miyabis PIN: 482917

Skriv ner denna. Skicka till Miyabi via SMS när dashboarden är live på tappass.se/m.
(Bryggans test-PIN är 111111.)

## Gör i exakt denna ordning

### Steg 1: Kör SQL-migrationen

I Supabase SQL Editor:
1. Öppna `supabase_migration_v2.sql`
2. Klistra in HELA innehållet
3. Tryck Run

Det här lägger till:
- `redeem_code`-kolumn på redemptions
- `cafe_pins`-tabell med Miyabis hashade PIN
- 7 nya RPC-funktioner för merchant-flödet

Verifiera:
- Table Editor → `cafe_pins` → ska finnas 2 rader (miyabi + bryggan)
- Database → Functions → ska se nya funktioner som `merchant_login`, `merchant_redeem_by_code` osv.

### Steg 2: Backup, packa upp v5

```
cd C:\Users\Navid\Desktop
ren stampla-mobile stampla-mobile-v4-backup
```

Packa upp `stampla-mobile-v5.zip`, döp om till `stampla-mobile`.

### Steg 3: Installera + bygg

```
cd C:\Users\Navid\Desktop\stampla-mobile
npm install
npx eas build --profile development --platform android --clear-cache
```

- Keystore → **N**
- Emulator → **n**
- Vid prompt om EAS project: använd projectId i app.json (redan korrekt)

### Steg 4: Avinstallera gamla, installera nya

Som vanligt. Vid omstart av appen ska gamla stämplar finnas kvar (de ligger i Supabase).

### Steg 5: Bygg merchant-dashboard på Lovable

1. Öppna `LOVABLE_MERCHANT_PROMPT.md`
2. Klistra in HELA innehållet i Lovable-chatten
3. Vänta tills Lovable byggt
4. Verifiera att tappass.se/m finns och funkar

## Vad som ändrats i appen

**Nytt flöde för inlösen (helt annorlunda från v4):**

1. Kund får sin sista stämpel → Celebration → "Spara belöning till senare" 
2. Backend genererar en 6-siffrig kod (ex: `482917`)
3. Kortet visas i appen med "SPARAD BELÖNING" + en stor "Lös in"-knapp
4. När kunden trycker "Lös in" → ser presentkortet med koden
5. Kunden visar koden till personalen
6. Personalen skriver in koden i tappass.se/m → trycker bekräfta
7. **Appen pollar Supabase var 3:e sekund** medan koden är synlig
8. Så fort backend markerar koden som inlöst → appen ser det → "Tack!"-skärm + kortet nollställs

**Ingen 3-sekunders håll längre.** Det var en bra idé för pen-and-paper, men nu när personalen har sin egen dashboard är PIN-baserad verifiering både snabbare och säkrare. Personal rör aldrig kundens telefon.

## Hela end-to-end-testet

Gör detta för att verifiera att kedjan fungerar:

1. **På telefonen:** Tappa Miyabi 6 ggr → Celebration → "Spara belöning"
2. **På telefonen:** Tryck på det sparade kortet → koden visas (ex 482917)
3. **På datorn:** Gå till tappass.se/m → logga in med `miyabi` + `482917`
4. **På datorn:** Skriv in 6-siffriga koden från telefonen → "Bekräfta inlösen"
5. **På datorn:** Success-popup
6. **Inom 3 sek på telefonen:** Belöningssidan stängs automatiskt, kortet nollställs

Om det INTE fungerar — säg vad som händer:
- Funkar login på datorn?
- Får appen koden från backend?
- Säger merchant-vyn "Inlöst!"?
- Reagerar appen?

Vi felsöker.

## Säkerhet — viktigt

- Anon-key i appen och Lovable är OK eftersom alla skrivningar går via SECURITY DEFINER-funktioner som kräver giltig PIN/data
- Den hemliga (`service_role`) nyckeln får ALDRIG hamna i Lovable. Den är admin-access. Endast `sb_publishable_...` ska användas av Lovable.
- PIN-koden är hashad med bcrypt (pgcrypto) i databasen, lagras aldrig i klartext

## Vad backenden kan göra nu (utöver appen)

Du kan direkt i SQL Editor:
- Lägga till ett nytt café (insert into cafes + insert into tags + insert into cafe_pins)
- Se all aktivitet (select från stamps, redemptions)
- Ändra Miyabis pin: `update cafe_pins set pin_hash = crypt('ny_pin', gen_salt('bf')) where cafe_id = (select id from cafes where slug = 'miyabi');`

## Nästa steg efter detta funkar

1. **Visa upp för Miyabi.** Demo: tappa 6 ggr, spara, visa koden, gå till tappass.se/m på din egen telefon, skriv in koden, "Inlöst!". 60-sekunders pitch.
2. **Café nummer 2.** Lägg till via SQL Editor på 30 sekunder.
3. **Riktiga NFC-stämplar att skicka till caféer.** Vi har testat på en lapp — dags att beställa ~10 stämplar.
4. **iPhone-support** (kommer kräva mer jobb pga Apple's NFC-restriktioner).
