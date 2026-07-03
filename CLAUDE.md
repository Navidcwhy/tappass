# CLAUDE.md — TapPass

Kontext för AI-assistenter och nya utvecklare. Hålls uppdaterad vid större förändringar.

## Vad är detta repo?

**TapPass** är ett digitalt stämpelkort på NFC: kunden tappar telefonen mot en fysisk NFC-stämpel i kassan och får en stämpel; fullt kort ger en belöning som personalen löser in med en 6-siffrig kod. Bolag: **Folde.AI AB**.

**Detta repo innehåller ENDAST mobilappen (React Native / Expo).**
Webben ligger *inte* här:

- `tappass.se` (marknadssajt) och `tappass.se/m` (butiks-/merchant-dashboard) är byggda i **Lovable** och versionshanteras separat.
- Backend är **Supabase** (Postgres + RPC-funktioner). SQL-filerna i repo-roten är källan till schemat men körs manuellt i Supabase SQL Editor — det finns ingen migrations-pipeline.

## Stack

| Del | Val |
|---|---|
| App | Expo SDK 51 (managed), React Native 0.74.5, React 18.2 |
| NFC | `react-native-nfc-manager` 3.14.x (kräver dev client — Expo Go stöder inte NFC) |
| Backend | Supabase via `@supabase/supabase-js` — all skrivlogik i `SECURITY DEFINER`-RPC:er |
| Lagring | AsyncStorage (endast anonymt `device_id`) |
| UI | Egna komponenter, `lucide-react-native`-ikoner, `Animated` (core) + reanimated-plugin i babel |
| Bygg | EAS Build (projectId i `app.json`), profiler i `eas.json` |

Ingen TypeScript, ingen linter, inga tester, ingen CI. Ren JavaScript med inline-styles.

## Struktur och nyckelfiler

```
App.js                       # Hela appskalet: state, NFC-loop, deep links, flikar, toast
app.json                     # Expo-konfig: bundle-id se.tappass.app, NFC-plugin, deep links
eas.json                     # EAS-byggprofiler (development/preview/production)
supabase_schema.sql          # v1-schema: cafes, tags, users, stamps, redemptions + tap_token m.fl.
supabase_migration_v2.sql    # v2: cafe_pins (bcrypt-PIN), redeem-koder, merchant_*-RPC:er
src/
  lib/
    nfc.js                   # NFC-läsning: requestTechnology(Ndef) → getTag → dekoda Text/URI
    useNfcStatus.js          # Hook: pollar isSupported/isEnabled varannan sekund
    supabase.js              # Supabase-klient + RPC-wrappers (tapToken, saveReward, loadWallet …)
    theme.js                 # Designtokens ("Aesop meets Stripe") + fontURL:er (Google Fonts)
    icons.js                 # Lucide-ikonmappning
    registry.js              # ⚠️ DÖD KOD (v4) — hårdkodade demo-caféer, importeras bara av ScanSheet
  components/
    LoyaltyCard.js           # Stämpelkort med progress, "BELÖNING KLAR"- och "SPARAD"-lägen
    RewardSheet.js           # Inlösen: dra-för-att-öppna → 6-siffrig kod → pollar tills personal bekräftar
    CelebrationScreen.js     # Fullskärmsfirande vid full stämpelrad
    Confetti.js              # Konfettianimation
    AppLinkOnboarding.js     # ⚠️ 100 % Android-specifik onboarding (App Links-inställningar)
    ScanSheet.js             # ⚠️ DÖD KOD (v4) — gammal skannervy, importeras inte av App.js
```

## Dataflöde (kärnan)

1. **Stämpel:** NFC-tagg innehåller token (`<slug>-01`, t.ex. `miyabi-01`) som text- eller URL-record (`https://tappass.se/t/<token>`). Appen läser den via NFC-loopen i `App.js` (`LiveScanner`) **eller** tar emot den som deep link (`tokenFromUrl` matchar `/t/<token>`). Båda vägarna anropar `tap_token`-RPC:n som atomiskt löser token → café, skapar/hämtar user på `device_id`, blockerar om sparad belöning finns, och returnerar nytt kortläge.
2. **Belöning:** Full rad → `CelebrationScreen` → `save_reward` genererar 6-siffrig kod → `RewardSheet` visar koden och pollar `current_saved_code` varannan sekund. Personalen skriver koden i tappass.se/m (`merchant_redeem_by_code`) → koden försvinner → appen märker det och nollställer kortet.
3. **Identitet:** Inget konto. Slumpat `device_id` i AsyncStorage = användaren. Ominstallation ⇒ nytt id ⇒ stämplarna "försvinner" för användaren (raderna finns kvar i Supabase men går inte att koppla).

## Bygga och köra lokalt

Expo Go fungerar **inte** (NFC kräver native-modul). Du behöver en dev client:

```bash
npm install

# Android – lokalt (kräver Android Studio + Java 17 + USB-debug):
npx expo run:android
# …eller i molnet:
npx eas build --profile development --platform android

# iOS – dev client (kräver Apple-konto kopplat till EAS; se iOS-sektionen):
npx eas build --profile development --platform ios

# Starta utvecklingsservern (hot reload i dev clienten):
npm start
```

Utan fysisk NFC-tagg: appens "Simulera en disk"-knappar skickar samma `tap_token`-anrop som en riktig tagg.

Nya caféer/taggar läggs in direkt i Supabase (insert i `cafes` + `tags` + `cafe_pins`) — inte i koden. Se README-v5.md.

## Kodkonventioner

- Svenska i all användartext och i kommentarer/README; engelska identifierare.
- Inline-styles med tokens från `theme.js` (`T`, `RADIUS`, `FONT`) — ingen StyleSheet/styled-components.
- Animationer med core `Animated` + `useNativeDriver: true`; haptik via `expo-haptics` vid varje viktig interaktion.
- All backendlogik i Postgres-RPC:er (`SECURITY DEFINER`); klienten är tunn och litar aldrig på lokalt state.
- Fel sväljs ofta tyst (`catch {}`) och UI:t faller tillbaka till tomt läge — var försiktig med att anta att anrop lyckats.

## Säkerhetsmodell

- Publishable-nyckeln i `src/lib/supabase.js` är avsedd att vara publik; alla skrivningar går genom RPC:er som validerar (PIN:er bcrypt-hashade i `cafe_pins`).
- `service_role`-nyckeln får ALDRIG hamna i appen eller i Lovable.
- `.env` är gitignorad men används inte i dag — Supabase-URL/nyckel är hårdkodade.

## Kända begränsningar

- **Ingen iOS-release ännu** — se iOS-sektionen nedan; NFC-flödet är byggt runt Androids tysta förgrundsläsning.
- `registry.js` + `ScanSheet.js` är kvarglömd v4-kod och används inte.
- Typsnitt laddas i runtime från fonts.gstatic.com (`theme.js`) — första start utan nät ger systemfont.
- Ingen ikon/splash konfigurerad i `app.json` (duger för dev client, inte för butiksbygge).
- `device_id`-identiteten överlever inte ominstallation.
- READMEs nämner caféet "miyabi" som inte finns i `registry.js` — registret i databasen är sanningen.
- Ingen test-/lint-infrastruktur; verifiering sker manuellt på fysisk enhet med NFC.

## iOS-release

> Status 2026-07: appen är Android-testad; iOS-bygge kräver stegen nedan. App Store Connect-metadata, screenshots och previews finns redan (sv + en). **Går inte att bygga/skicka in ännu** — se blockerare nedan.

### Fasta identiteter

- **Bundle-ID:** `se.tappass.app` (samma som Android-paketnamnet; redan i `app.json`)
- **EAS-projekt:** `57aff16d-689b-4bed-aa1b-cd166bfc0f83`
- **Versionering:** `expo.version` i `app.json` är marknadsversionen; `buildNumber` hanteras av EAS (`appVersionSource: "remote"` + `autoIncrement: true` i production-profilen) — sätt inte manuellt.

### Blockerare — måste åtgärdas innan ett bygge går att skicka in

1. **Expo SDK 51 / RN 0.74.5 kan inte längre laddas upp till App Store.** Apple kräver Xcode 26 / iOS 26 SDK för alla uppladdningar sedan 28 april 2026 (developer.apple.com/news/upcoming-requirements/?id=02032026a). Expo SDK 51 bygger med en för gammal Xcode-image. Måste uppgraderas till minst **SDK 54** (sista SDK:n som stödjer legacy architecture, dvs `newArchEnabled: false` kan behållas). SDK 55+ tvingar New Architecture, vilket `react-native-nfc-manager` v3 officiellt inte stödjer.
2. **Ingen app-ikon konfigurerad.** `app.json` saknar helt `icon`-nyckeln och det finns ingen `assets/`-mapp i repot. Utan ikon avvisas uppladdningen (ITMS-90022) redan innan App Review.
3. **NFC-loopen i `App.js` är byggd för Android och fungerar inte på iOS** — se nästa avsnitt.

### NFC-krav på iOS (kritiskt)

iOS Core NFC skiljer sig fundamentalt från Android. Läsningen sker i `src/lib/nfc.js` (`readToken`/`initNfc`/`isNfcEnabled`), `src/lib/useNfcStatus.js` (pollning) och `App.js` (`LiveScanner`, rad 287–326).

1. **Ingen tyst förgrundsläsning [L].** `LiveScanner` kör en oändlig loop som anropar `NfcManager.requestTechnology(NfcTech.Ndef)` var 400:e–1500:e ms. På iOS visar varje anrop systemets fullskärms-"Ready to Scan"-ark — loopen blir ett skanningsark som poppar upp om och om igen direkt vid appstart. Måste plattformsgrenas: på iOS ersätts loopen av en knapp som startar **en** skanningssession per tryck. Ingen `Platform.OS`-förgrening finns någonstans i koden idag (bekräftat med grep).
2. **Bakgrundsläsning** (app stängd, skärm på) finns bara på iPhone XS/XR och senare och triggas **endast av NDEF URI-records** — dagens fysiska taggar är textrecords (t.ex. `miyabi-01`) och gör ingenting på iOS, varken i förgrund eller bakgrund [M]. Taggarna måste skrivas om till `https://tappass.se/t/<token>` som URI-record, och domänen måste servera en giltig AASA-fil (se nästa punkt).
3. **`isEnabled()` är hårdkodad `true` på iOS** i `react-native-nfc-manager` (bekräftat i den låsta versionen 3.17.2) — "Slå på NFC"/"NFC är avstängt"-texterna och statusprickens logik i `App.js` är meningslösa på iOS och måste grenas bort [S].
4. **Entitlement:** `com.apple.developer.nfc.readersession.formats` läggs till av config-pluginet `react-native-nfc-manager` vid prebuild. Låter man EAS hantera credentials synkas motsvarande capability ("Near Field Communication Tag Reading") automatiskt till app-ID:t i Apple Developer-portalen vid `eas build`/`eas credentials`; annars måste den bockas i manuellt under Identifiers → se.tappass.app. Kontrollera efter prebuild att pluginet satt värdet `TAG` och inte det föråldrade `NDEF` [S, verifiera].
5. **Info.plist:** `NFCReaderUsageDescription` finns redan i `app.json` (`ios.infoPlist`) — ingen ändring behövs.
6. **Universal Links:** `associatedDomains` (`applinks:tappass.se`) finns i `app.json`, men kräver att tappass.se (Lovable-hostad) serverar `/.well-known/apple-app-site-association` med rätt Team-ID + bundle-ID. Ingen sådan fil är verifierad att finnas idag — utan den öppnas länkar/bakgrundsläsning i Safari i stället för i appen. Detta åtgärdas i Lovable-projektet, inte i detta repo.
7. **`AppLinkOnboarding.js` är 100 % Android-instruktioner** ("öppna som standard", `Linking.openSettings()`) och visas för alla användare 1,5 s efter start — måste plattformsgrenas eller ersättas med en iOS-lämplig förklaring av Universal Links [M].

### Byggkommandon

```bash
# Produktion (.ipa för App Store):
npx eas build --platform ios --profile production

# Ladda upp till App Store Connect:
npx eas submit --platform ios --latest
```

Första iOS-bygget frågar efter Apple-inloggning (eller App Store Connect API-nyckel) för att skapa distributionscertifikat + provisioning profile — det steget kan bara kontoägaren göra.

### Manuell Apple-checklista (kan inte göras av AI-assistent)

- [ ] Apple Developer Program-medlemskap aktivt för Folde.AI AB (organisation)
- [ ] Vid första `eas build`/`eas credentials`: logga in med Apple-kontot eller lägg upp en App Store Connect API-nyckel i EAS
- [ ] Verifiera att app-ID:t `se.tappass.app` fått capabilities: NFC Tag Reading + Associated Domains (automatiskt om EAS hanterar credentials)
- [ ] App-post i App Store Connect kopplad till `se.tappass.app` (metadata finns redan)
- [ ] Efter `eas submit`: välj builden under versionen i App Store Connect, besvara exportkryptering (eller sätt `ITSAppUsesNonExemptEncryption: false` i `app.json` i förväg)
- [ ] Se till att tappass.se serverar AASA-filen på `/.well-known/apple-app-site-association` (görs i Lovable-projektet, inte i detta repo)
- [ ] Skriv om fysiska NFC-taggar till URL-records (`https://tappass.se/t/<token>`) — krävs för att iOS bakgrundsläsning ska fungera alls
- [ ] Leverera en app-ikon (1024×1024 PNG, ingen alfakanal) till `assets/icon.png` och peka `app.json` dit
