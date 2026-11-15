# Kedjekort och huvudkonto — v18

## Vad kunden och butikerna får

- **Samma belöning i hela kedjan.** Kunden har ett kort och samlar stämplar på alla ställen.
- **Lös in var som helst.** Koden eller stämpeln fungerar på alla ställen i kedjan.
- **Varje ställe ser bara sina egna siffror** i panelen: stämplar, kunder, stamgäster, insikter, inlösta belöningar.
- **Huvudkontot** ser hela kedjan och en rad per ställe. Med *Visa* öppnar det ett ställes panel, precis som stället ser den (12 timmar).
- **Egen belöning för ett ställe** ordnas av TapPass (`admin_chain_own_card`).
  - Ställets nya stämplar räknas då på ett eget kort.
  - Huvudkontot ser fortfarande stället.

## Hur det fungerar

- **Kedjan** är en rad i `cafes` med `is_chain = true`. Den äger kortet: namn, färg, belöning, mindre belöningar, födelsedagspresent, inbjudningar och hjulet. Den har ingen tagg.
- **Ställena** är vanliga rader med `chain_id` = kedjan. Var och en har egen tagg, inloggning, profil (adress, öppettider, logga), väntetid och lugna timmar.
- **Stämplar:** `stamps.cafe_id` = kortet (kedjan) och `stamps.place_id` = stället.
  - Triggern `stamps_place` sätter platsen från taggen. Bonus- och inbjudningsstämplar får platsen från samma tryck (`tappass.place`).
  - För vanliga ställen är `cafe_id` och `place_id` samma.
- **Var en belöning löstes in** står i `redemptions.place_id`. Motsvarande fält finns för presenter, inbjudningar och vinn tillbaka-bonusar.
- **Panelens funktioner** räknar på platsen (`scope_places`): ett ställe ser sig självt, huvudkontot alla sina ställen.
  - Belöningar och väntande koder hör till kortet (`scope_cards`).
- **Vanliga ställen påverkas inte.** I PGlite-testet gav samma data och samma anrop (panelens och kundernas funktioner, stämpling, inlösen, presenter och inbjudningar) samma svar före och efter v18. Undantagen är tre nya fält i `cafes` och `place` i *Senast inlösta*.

## Före första kedjan

Allt är klart sedan 2026-11-15:

1. **v18 är körd** i produktion (efter v17, i SQL Editor). Vakten krävde v17-läget för de 32 funktioner som skrivs om och jämförde koden utan blanksteg.
2. **Appuppdateringen** (OTA `4ffdc2e1…`) med kedjestöd är ute. Telefoner som inte startat appen sedan dess visar ställena som egna rader under Ställen, med ställets egna belöningstexter.
3. **Panelen** med huvudkontot är publicerad.

## Skapa en kedja

Alla steg utom PIN:erna kan köras via Supabase-kopplingen, eftersom de inte innehåller några hemligheter.

```sql
-- 1. Kedjan (huvudkontot): slug, namn, stad, typ, belöning lång/kort, stämplar, färg, ikon
select public.admin_chain_create('kaffekedjan', 'Kaffekedjan', 'Stockholm', 'Kafé',
  'En kaffe på huset', 'Gratis kaffe', 8, '#6B3A1F', 'coffee');

-- 2. Ställena (nya rader – belöningsfälten krävs av tabellen men används bara med eget kort)
insert into public.cafes (slug, name, type, area, city, symbol, stamps_needed, reward_text, reward_short)
values ('kk-soder', 'Kaffekedjan Södermalm', 'Kafé', 'Södermalm', 'Stockholm', 'coffee', 8, 'En kaffe på huset', 'Gratis kaffe');
select public.admin_chain_add_store('kk-soder', 'kaffekedjan');
```

**3. Inloggningar och taggar.** Kör detta i SQL Editor, aldrig via AI, eftersom PIN:en visas en gång:

```sql
select public.admin_issue_pin('kaffekedjan');   -- huvudkontot (ingen tagg)
select public.admin_issue_pin('kk-soder');      -- stället + taggen kk-soder-01
```

Skriv sedan taggen med NFC Tools som `https://tappass.se/t/kk-soder-01`.

## Göra om ett befintligt ställe till en kedja

Exempel: Miyabi öppnar ett ställe till.

```sql
select public.admin_chain_create('miyabi-kedjan', 'Miyabi', 'Stockholm', 'Sushi-restaurang',
  'En 5-bitars sushi på huset', 'Gratis 5-bitars sushi', 6, '#1B5A66', 'utensils');
select public.admin_chain_add_store('miyabi', 'miyabi-kedjan');
```

- **Kundernas kort flyttas till kedjan.** Det gäller stämplar, sparade och inlösta belöningar, bonusar, presenter och inbjudningar. Platsen behålls och sparade koder fungerar som förut.
- **Använd samma antal stämplar och samma belöning** som stället har i dag. Annars ändras kortets mål för kunderna.
- **Krock:** har någon kund kort både hos stället och hos kedjan avbryts allt (`… kund(er) har kort både hos …`) och inget flyttas.
- **Mindre belöningar och födelsedagspresent** gäller från kedjans rad. Huvudkontot ställer in dem i panelen.

## Egen belöning, ta bort, läget

```sql
-- Egen belöning för ett ställe (ställets rad bestämmer belöning och antal stämplar)
update public.cafes set reward_text = 'En bulle på huset', reward_short = 'Gratis bulle', stamps_needed = 6 where slug = 'kk-ost';
select public.admin_chain_own_card('kk-ost', true);

-- Ta bort ett ställe ur kedjan. Kundernas kort stannar hos kedjan. Stället blir ett vanligt
-- ställe med nya kort, så kontrollera dess belöning och färg efteråt.
select public.admin_chain_remove_store('kk-ost');

select * from public.admin_chain_status();   -- kedjor, ställen, taggar, inloggning
```

Stäng inte av ett eget kort som kunder redan samlar på. Det kortet går då inte att stämpla längre.

## Panelen

| | Ställe i kedjan | Huvudkontot |
|---|---|---|
| Siffror (stämplar, kunder, stamgäster, insikter, månadsrapport, kampanjer, inbjudningar) | bara sina egna | hela kedjan + *Kedjan* med en rad per ställe |
| Lös in kod | koder från hela kedjan | koder från hela kedjan |
| Väntande belöningar | hela kedjans (kan lösas in var som helst) | hela kedjans |
| Senast inlösta | sina egna | alla, med ställets namn |
| Belöningar, födelsedagspresent | läsa (`managed_by_chain`) | ändra |
| Profil | adress, öppettider, beskrivning, logga, webb, Instagram | kedjans namn på kortet, belöningens text, färg, logga |
| Lugna timmar, väntetid | ändra (gäller stället) | via *Visa* på ett ställe |
| Vinn tillbaka | sina stamgäster; bonusen gäller i hela kedjan | hela kedjan |

## Kända begränsningar

- **Väntetiden** räknas från kundens senaste stämpel i hela kedjan, med väntetiden för stället där kunden tappar.
- **Huvudkontots visning** är en vanlig session för stället. Den kan ändra ställets inställningar men inte byta dess PIN. Den försvinner när huvudkontot loggar ut eller byter PIN.
- **Ta inte bort ett ställe vars stämplar ligger på kedjans kort.** Det går inte (FK). Använd `admin_chain_remove_store`.
- **Hjulet** erbjuder kedjan, inte ställena. Kedjans rad behöver `city`, som `admin_chain_create` sätter.
