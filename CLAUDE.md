# CLAUDE.md — TapPass

Kontext för AI-assistenter och nya utvecklare. Hålls uppdaterad vid större förändringar.

## Vad är detta repo?

**TapPass** är ett digitalt stämpelkort på NFC: kunden tappar telefonen mot en fysisk NFC-stämpel i kassan och får en stämpel; fullt kort ger en belöning som personalen löser in med en 6-siffrig kod. Bolag: **Folde.AI AB**.

**Detta repo innehåller ENDAST mobilappen (React Native / Expo).**
Webben ligger *inte* här:

- `tappass.se` (marknadssajt) och `tappass.se/m` (butiks-/merchant-dashboard) är byggda i **Lovable** och versionshanteras separat.
- Backend är **Supabase** (Postgres + RPC-funktioner). SQL-filerna i repo-roten dokumenterar schemat men är inte exakt facit (produktion har ändrats manuellt — se Säkerhetsmodell). De körs manuellt i Supabase SQL Editor — det finns ingen migrations-pipeline.

## Stack

| Del | Val |
|---|---|
| App | Expo SDK 54 (managed), React Native 0.81.5, React 19.1 (`newArchEnabled: false` — legacy arch, krävs av nfc-manager v3) |
| NFC | `react-native-nfc-manager` 3.14.x (kräver dev client — Expo Go stöder inte NFC) |
| Backend | Supabase via `@supabase/supabase-js` — all skrivlogik i `SECURITY DEFINER`-RPC:er |
| Lagring | AsyncStorage (endast anonymt `device_id`) |
| UI | Egna komponenter, `lucide-react-native`-ikoner, `Animated` (core) + reanimated-plugin i babel |
| Bygg | EAS Build (projectId i `app.json`), profiler i `eas.json` |
| OTA | EAS Update (`expo-updates`): JS-ändringar pushas till användare utan App Store-granskning. `runtimeVersion.policy: "appVersion"` — OTA når alla builds med samma `expo.version`. Kanaler: `production`/`preview` (eas.json) |

Ingen TypeScript, ingen linter, inga tester, ingen CI. Ren JavaScript med inline-styles.

## Struktur och nyckelfiler

```
App.js                       # Hela appskalet: state, NFC-loop, deep links, flikar, toast
app.json                     # Expo-konfig: bundle-id se.tappass.app, NFC-plugin, deep links
eas.json                     # EAS-byggprofiler (development/preview/production)
supabase_schema.sql          # v1-schema: cafes, tags, users, stamps, redemptions + tap_token m.fl.
supabase_migration_v2.sql    # v2: cafe_pins (bcrypt-PIN), redeem-koder, merchant_*-RPC:er
supabase_migration_v3.sql    # v3: ERSATT av v4 + v5 — kör aldrig
supabase_migration_v4_security.sql # v4: säkerhetsfix — kod kräver fullt kort, redeem_reward stängd, taggar ej listbara
supabase_migration_v5_cooldown_login.sql # v5: väntetid per butik, inloggningsnamn + sessioner + PIN-spärr, admin_issue_pin
src/
  lib/
    nfc.js                   # NFC-läsning: requestTechnology(Ndef) → getTag → dekoda Text/URI
    useNfcStatus.js          # Hook: pollar isSupported/isEnabled varannan sekund
    supabase.js              # Supabase-klient + RPC-wrappers (tapToken, saveReward, loadWallet …)
    theme.js                 # Designtokens ("Aesop meets Stripe") + fontURL:er (Google Fonts)
    icons.js                 # Lucide-ikonmappning
    prefs.js                 # Lokala UI-inställningar i AsyncStorage (onboarding-flagga)
  components/
    LoyaltyCard.js           # Stämpelkort med progress, "BELÖNING KLAR"- och "SPARAD"-lägen
    RewardSheet.js           # Inlösen: dra-för-att-öppna → 6-siffrig kod → pollar tills personal bekräftar
    CelebrationScreen.js     # Fullskärmsfirande vid full stämpelrad
    Confetti.js              # Konfettianimation
    AppLinkOnboarding.js     # Onboarding, plattformsgrenad (Android App Links vs iOS Universal Links/skanna)
```

## Dataflöde (kärnan)

1. **Stämpel:** NFC-tagg innehåller token (`<slug>-01`, t.ex. `miyabi-01`) som text- eller URL-record (`https://tappass.se/t/<token>`). Appen läser den via `LiveScanner` i `App.js` — som plattformsgrenar: **Android** kör en passiv läsloop (`AndroidScanner`), **iOS** en knapptriggad en-session-per-tryck (`IosScanner`, Core NFC saknar tyst förgrundsläsning). Alternativt tas token emot som deep link (`tokenFromUrl` matchar `/t/<token>`). Alla vägar anropar `tap_token`-RPC:n som atomiskt löser token → café, skapar/hämtar user på `device_id`, blockerar om sparad belöning finns, och returnerar nytt kortläge.
2. **Belöning:** Full rad → `CelebrationScreen` → `save_reward` genererar 6-siffrig kod → `RewardSheet` visar koden och pollar `current_saved_code` varannan sekund. Personalen skriver koden i tappass.se/m (`merchant_redeem_by_code`) → koden försvinner → appen märker det och nollställer kortet.
3. **Identitet:** Inget konto. Slumpat `device_id` i AsyncStorage = användaren. Ominstallation ⇒ nytt id ⇒ stämplarna "försvinner" för användaren (raderna finns kvar i Supabase men går inte att koppla).

## Bygga och köra lokalt

Expo Go fungerar **inte** (NFC kräver native-modul). Du behöver en dev client:

```bash
npm install
npm install -g eas-cli   # EAS CLI heter eas-cli på npm — `npx eas` fungerar INTE

# Android – lokalt (kräver Android Studio + Java 17 + USB-debug):
npx expo run:android
# …eller i molnet:
eas build --profile development --platform android

# iOS – dev client (kräver Apple-konto kopplat till EAS; se iOS-sektionen):
eas build --profile development --platform ios

# Starta utvecklingsservern (hot reload i dev clienten):
npm start
```

Utan fysisk NFC-tagg: appens "Simulera en disk"-knappar (endast i dev-builds, `__DEV__`) skickar samma `tap_token`-anrop som en riktig tagg. De renderas aldrig i produktion.

Nya butiker läggs in direkt i Supabase — inte i koden: `insert into cafes …`, sedan `select public.admin_issue_pin('<slug>');` som skapar tagg, inloggning och slumpad PIN. Se README-v5.md.

## Kodkonventioner

- Svenska i all användartext och i kommentarer/README; engelska identifierare.
- Inline-styles med tokens från `theme.js` (`T`, `RADIUS`, `FONT`) — ingen StyleSheet/styled-components.
- Animationer med core `Animated` + `useNativeDriver: true`; haptik via `expo-haptics` vid varje viktig interaktion.
- All backendlogik i Postgres-RPC:er (`SECURITY DEFINER`); klienten är tunn och litar aldrig på lokalt state.
- Fel sväljs ofta tyst (`catch {}`) och UI:t faller tillbaka till tomt läge — var försiktig med att anta att anrop lyckats.

## Säkerhetsmodell

- Publishable-nyckeln i `src/lib/supabase.js` är avsedd att vara publik; alla skrivningar går genom RPC:er som validerar (PIN:er bcrypt-hashade i `cafe_pins`).
- `service_role`-nyckeln får ALDRIG hamna i appen eller i Lovable.
- Butiks-PIN:er får ALDRIG committas (inte i SQL, README eller kommentarer). Sätt dem manuellt i SQL Editor.
- **Produktion är facit, inte repots SQL.** Live-databasen har ändrats manuellt och skiljer sig från v1/v2-filerna (t.ex. har `cafe_pins` RLS i produktion men inte i v2-filen). Hämta `pg_get_functiondef` innan en funktion skrivs om.
- **v4 (`supabase_migration_v4_security.sql`):** `save_reward` kräver fullt kort; `redeem_reward` är stängd för klientroller — bara personalen löser in (`merchant_redeem_by_code`); `tags` är inte läsbar för klienter (publik butiksinfo per token via `tag_public_info`, används av tappass.se/t/…); `search_path` låst på alla RPC:er. Appens anrop till `redeem_reward` i `onRedeemed` får behörighetsfel som ignoreras — bör tas bort i appen.
- **Väntetid per butik (v5):** `cafes.stamp_cooldown_seconds` (10 s–24 h, standard 60 s) som butiken ändrar i tappass.se/m. `tap_token` svarar `error: "cooldown"` + `retry_after_seconds`/`retry_after_minutes`, och appen visar det som info. Appen ignorerar dessutom samma token inom 5 s (dubbelläsning). Token är statiska och gissningsbara (`<slug>-01`): väntetiden bromsar fusk men stoppar inte den som anropar API:t hemifrån. Långsiktigt krävs dynamiska taggar (t.ex. NTAG 424 DNA).
- **Butiksinloggning (v5):** inloggningsnamn (`cafe_pins.login_name`, standard = slug, butiken kan byta) + 6-siffrig PIN ger en sessionsnyckel (30 dagar, hashad i `merchant_sessions`). Panelen sparar nyckeln, aldrig PIN:en. 10 fel PIN låser ny inloggning i 15 min; inloggade sessioner fungerar under spärren. PIN-byte loggar ut övriga enheter.
- **Ny butik / glömd PIN:** `insert into cafes …` och sedan `select public.admin_issue_pin('<slug>');` i SQL Editor. Ger inloggningsnamn, slumpad PIN (visas en gång) och tagg. Kör den **aldrig** via AI/MCP — då hamnar PIN:en i chattloggar.
- **Supabase free plan** pausar projektet efter 7 dagar utan trafik → app och butikspanel slutar svara tills det återstartas.
- `.env` är gitignorad men används inte i dag — Supabase-URL/nyckel är hårdkodade.

## Köra SQL i produktion

1. **Testa först** mot en kopia av live-schemat (hämta `pg_get_functiondef` från produktion; PGlite i Node fungerar) — skriv aldrig om en funktion utifrån repots SQL.
2. **Kör via Supabase-kopplingen** (`apply_migration`) så att Navid kan godkänna i bekräftelserutan — det är förstahandsvalet.
3. **Om bekräftelsen avbryts automatiskt:** Navid kör filen i Supabase SQL Editor på dator. På mobil klipps långa inklistringar (v5 klipptes efter ~2,5 kB) — använd då en kort snutt som hämtar filen från GitHub låst till commit-SHA + md5 och kör den med `execute` (`http`-tillägget skapas och tas bort i samma körning). Mall: PR #11 / körningen 2026-11-03.
4. **Verifiera alltid efteråt** med läsfrågor (behörigheter, funktionsinnehåll, data orörd) och `get_advisors`.

## Kända begränsningar

- **Ingen iOS-release publicerad ännu** — men koden är iOS-förberedd (se iOS-sektionen): SDK 54, plattformsgrenad NFC, ikon incheckad. Återstår: AASA-fil på tappass.se, EAS-bygge med Apple-credentials.
- Typsnitt laddas i runtime från fonts.gstatic.com (`theme.js`) — första start utan nät ger systemfont.
- `device_id`-identiteten överlever inte ominstallation.
- Ingen test-/lint-infrastruktur; verifiering sker manuellt på fysisk enhet med NFC (JS-nivå kan sanity-checkas med babel-transform).

## iOS-release

> Status 2026-07: appen är Android-testad och nu iOS-förberedd i kod, med ikon incheckad. App Store Connect-metadata, screenshots och previews finns redan (sv + en). Kvar innan inskickning: AASA-fil på tappass.se samt EAS-bygge (kräver Apple-credentials + nätåtkomst till Expo — kan inte göras från denna sandbox).

### Fasta identiteter

- **Bundle-ID:** `se.tappass.app` (samma som Android-paketnamnet; redan i `app.json`)
- **EAS-projekt:** `57aff16d-689b-4bed-aa1b-cd166bfc0f83`
- **Versionering:** `expo.version` i `app.json` är marknadsversionen; `buildNumber` hanteras av EAS (`appVersionSource: "remote"` + `autoIncrement: true` i production-profilen) — sätt inte manuellt.

### Blockerare — status

1. ✅ **SDK-uppgradering klar.** Expo SDK 51→54, RN 0.74.5→0.81.5, React 18→19. `newArchEnabled: false` behålls (SDK 54 är sista med legacy arch; nfc-manager v3 stödjer inte New Architecture). Bakgrund: Apple kräver Xcode 26/iOS 26 SDK för alla uppladdningar sedan 28 april 2026.
2. ✅ **App-ikon incheckad** på `assets/icon.png` (1024×1024 PNG, RGB utan alfakanal) och refererad i `app.json`. Byts filen ut måste exakt samma format behållas — annars ITMS-90022/90717. Se `assets/README.md`.
3. ✅ **NFC plattformsgrenad** (se nästa avsnitt).

### NFC på iOS (implementerat)

iOS Core NFC skiljer sig fundamentalt från Android. Läsningen sker i `src/lib/nfc.js`, `src/lib/useNfcStatus.js` och `App.js` (`LiveScanner` → `AndroidScanner`/`IosScanner`).

1. ✅ **Ingen tyst förgrundsläsning.** `LiveScanner` grenar på `Platform.OS`: **Android** behåller den passiva loopen (`AndroidScanner`), **iOS** använder `IosScanner` — en knapptriggad skanning per tryck (`requestTechnology` med `alertMessage` på systemarket). Utan grenen skulle iOS-arket poppa upp i oändlighet från appstart.
2. ⏳ **Bakgrundsläsning** (app stängd, skärm på) finns bara på iPhone XS/XR+ och triggas **endast av NDEF URI-records**. Dagens fysiska taggar är textrecords (`miyabi-01`) → gör inget på iOS. Måste skrivas om till `https://tappass.se/t/<token>` (operativt, utanför repo). Skanna-knappen fungerar oavsett.
3. ✅ **`isEnabled()` hårdkodad `true` på iOS** (nfc-manager 3.17.2) — `useNfcStatus` pollar inte på iOS, och "Slå på NFC"-UI:t visas bara på Android.
4. **Entitlement:** `com.apple.developer.nfc.readersession.formats` läggs till av config-pluginet vid prebuild. Med EAS-hanterade credentials synkas capability "NFC Tag Reading" automatiskt till app-ID:t vid `eas build`/`eas credentials`. `includeNdefEntitlement: false` är satt i `app.json` — Apple avvisar `NDEF`-värdet för appar byggda med iOS 26 SDK (fel 90778 vid processning).
5. ✅ **Info.plist:** `NFCReaderUsageDescription` + `ITSAppUsesNonExemptEncryption: false` finns i `app.json` (`ios.infoPlist`).
6. ⏳ **Universal Links:** `associatedDomains` (`applinks:tappass.se`) finns, men kräver att tappass.se (Lovable) serverar `/.well-known/apple-app-site-association` med rätt Team-ID + bundle-ID. Åtgärdas i Lovable-projektet.
7. ✅ **`AppLinkOnboarding.js` plattformsgrenad** — iOS får Universal Links/skanna-innehåll i stället för Androids "öppna som standard". Visas nu bara vid första start (AsyncStorage-flagga via `prefs.js`).

### Byggkommandon

```bash
npm install -g eas-cli   # engångs; `npx eas` fungerar INTE (fel paket på npm)
eas login                # Expo-konto med åtkomst till projektet (se nedan)

# Produktion (.ipa för App Store):
eas build --platform ios --profile production

# Ladda upp till App Store Connect:
eas submit --platform ios --latest

# OTA-uppdatering (endast JS/asset-ändringar — native-/beroendeändringar kräver nytt bygge):
eas update --channel production --message "kort beskrivning"
```

**OTA-regler:** `eas update` når alla installerade appar med samma `expo.version` (runtimeVersion-policy `appVersion`). Höjs `expo.version`, eller ändras native-kod/beroenden/plugins, krävs nytt EAS-bygge + App Store-inskickning. Appen hämtar uppdateringen vid nästa kallstart (default: två starter innan den syns).

**Projektåtkomst:** EAS-projektet (`57aff16d…`, slug `tappass`) måste ägas av/delas med det Expo-konto som bygger — kontot måste vara medlem i ägar-organisationen (t.ex. `tappass-org`). Verifiera med `eas project:info` i repo-roten; "You don't have access" ⇒ be ägaren flytta projektet (Project settings → Transfer project) eller bjuda in dig.

Första iOS-bygget frågar efter Apple-inloggning (eller App Store Connect API-nyckel) för att skapa distributionscertifikat + provisioning profile — det steget kan bara kontoägaren göra.

### Manuell Apple-checklista (kan inte göras av AI-assistent)

- [ ] Apple Developer Program-medlemskap aktivt för Folde.AI AB (organisation)
- [ ] Vid första `eas build`/`eas credentials`: logga in med Apple-kontot eller lägg upp en App Store Connect API-nyckel i EAS
- [ ] Verifiera att app-ID:t `se.tappass.app` fått capabilities: NFC Tag Reading + Associated Domains (automatiskt om EAS hanterar credentials)
- [ ] App-post i App Store Connect kopplad till `se.tappass.app` (metadata finns redan)
- [ ] Efter `eas submit`: välj builden under versionen i App Store Connect, besvara exportkryptering (eller sätt `ITSAppUsesNonExemptEncryption: false` i `app.json` i förväg)
- [ ] Se till att tappass.se serverar AASA-filen på `/.well-known/apple-app-site-association` (görs i Lovable-projektet, inte i detta repo)
- [ ] Skriv om fysiska NFC-taggar till URL-records (`https://tappass.se/t/<token>`) — krävs för att iOS bakgrundsläsning ska fungera alls
- [x] App-ikon incheckad på `assets/icon.png` (1024×1024 PNG, ingen alfakanal)
