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
| Lagring | AsyncStorage (anonymt `device_id`, onboarding-flagga, vald stad för Dagens hjul) |
| UI | Design **K · Expressiv** (Material 3 Expressive-inspirerad): egna komponenter, mjuka SVG-former via `react-native-svg`, `lucide-react-native`-ikoner, Roboto Flex (inbäddad i `assets/fonts`), `Animated` (core) + reanimated-plugin i babel. Designkanvas: https://claude.ai/artifact/697PMi2d6zDwCC1asagsqN |
| Bygg | EAS Build (projectId i `app.json`), profiler i `eas.json` |
| OTA | EAS Update (`expo-updates`): JS-ändringar pushas till användare utan App Store-granskning. `runtimeVersion.policy: "appVersion"` — OTA når alla builds med samma `expo.version`. Kanaler: `production`/`preview` (eas.json) |

Ingen TypeScript, ingen linter, inga tester, ingen CI. Ren JavaScript med inline-styles.

## Struktur och nyckelfiler

```
App.js                       # Hela appskalet: state, NFC-loop, deep links, flikar (Kort/Hjul/Ställen), snackbar, stämpelark; medan kodrutan väntar på butikens stämpel skickas lästa stämplar dit (registerRedeem) i stället för att stämpla; huvudlistan är en Animated.ScrollView vars skrollvärde (native) driver kortbunten; säsongsdetaljer (fall/fyrverkeri + hälsning) spelas vid start och när appen kommer fram
app.json                     # Expo-konfig: bundle-id se.tappass.app, NFC-plugin, deep links
eas.json                     # EAS-byggprofiler (development/preview/production)
.eas/workflows/              # Manuella EAS-arbetsflöden: publicera OTA till preview/production (kräver GitHub-koppling i Expo)
supabase_schema.sql          # v1-schema: cafes, tags, users, stamps, redemptions + tap_token m.fl.
supabase_migration_v2.sql    # v2: cafe_pins (bcrypt-PIN), redeem-koder, merchant_*-RPC:er
supabase_migration_v3.sql    # v3: ERSATT av v4 + v5 — kör aldrig
supabase_migration_v4_security.sql # v4: säkerhetsfix — kod kräver fullt kort, redeem_reward stängd, taggar ej listbara
supabase_migration_v5_cooldown_login.sql # v5: väntetid per butik, inloggningsnamn + sessioner + PIN-spärr, admin_issue_pin
supabase_migration_v6_dagens_hjul.sql # v6: Dagens hjul — snurr, dubbelstämplar, överskott vid inlösen, kampanjstatistik (körd 2026-11-04)
supabase_migration_v7_buggfixar.sql # v7: butiksstatistik i svensk tid + dagserie äldst först med nollor; hjulet: available per stad + all_bonused (körd 2026-11-11)
supabase_migration_v8_lugna_timmar.sql # v8: lugna timmar (cafes.quiet_hours, tap_token ger 'quiet'-stämpel, merchant_get/set_quiet_hours) (körd 2026-11-13)
supabase_migration_v9_inlosen_tapp.sql # v9: inlösen med tapp (redeem_by_tap, redemptions.redeemed_via, merchant_recent_redemptions) (körd 2026-11-14)
supabase_migration_v10_fler_beloningar.sql # v10: fler belöningar (cafes.reward_tiers, redemptions.tier_at, save_reward med vald nivå, cancel_saved_reward, merchant_get/set_reward_tiers) + belöningarnas värde i kronor och sparat-räknaren (cafes.reward_value_kr, redemptions.reward_name/value_kr) — INTE körd än
supabase_migration_v11_stamgaster.sql # v11: stamgästnivåer (guest_level, load_wallet + visits_12m/last_visit, merchant_guest_levels) — kräver v10, INTE körd än
supabase_migration_v12_insikter.sql # v12: panelens insikter (merchant_insights, merchant_lapsed, merchant_winback, merchant_month_report, stamp_bonuses.origin) — kräver v11, INTE körd än
supabase_migration_v13_profil.sql # v13: självservice-profil (adress, beskrivning, webbplats, Instagram, öppettider, logga i cafe_logos, merchant_get/set_profile, merchant_set_logo, cafe_logo) — kräver v12, INTE körd än
plugins/
  withLaunchedFromHistoryFix.js # Android (native, kräver bygge): rensar gammal länk vid start från "senaste appar"
src/
  lib/
    nfc.js                   # NFC-läsning: requestTechnology(Ndef) → getTag → dekoda Text/URI
    useNfcStatus.js          # Hook: pollar isSupported/isEnabled varannan sekund
    useReduceMotion.js       # Hook: "Reducera rörelse"/"Ta bort animationer" på → kortbuntens djup, glansens loop och säsongsfallet stängs av
    season.js                # Säsongsdetaljer efter svensk kalender (telefonens datum): snö 1/12–6/1, Lucia, jul, nyår (fyrverkeri), fettisdagen, påsk (skärtorsdag–annandagen), midsommar (afton + dag), kanelbullens dag; påskdagen och midsommarafton räknas ut
    supabase.js              # Supabase-klient + RPC-wrappers (tapToken, saveReward (med vald nivå), redeemByTap, cancelSavedReward, loadWallet, wheelStatus, spinWheel, claimWheelPrize …)
    wheel.js                 # Dagens hjul: fältgeometri (10 × 36°, vinstfält 0/3/5/8), målrotation, tickTimes (när fältgränser passerar pekaren under ett snurr), nedräknings- och giltighetstexter
    theme.js                 # K · Expressiv: tokens (T, RADIUS, FONT), FONT_FILES (inbäddad Roboto Flex) + tone(ink) = palett per butik
    shapes.js                # Genererade SVG-banor (cookie9/12, sunny8, burst12, flower8, clover4) i 100×100-viewBox
    icons.js                 # Lucide-ikonmappning
    prefs.js                 # Lokala UI-inställningar i AsyncStorage (onboarding-flagga, första stämpeln, hjulets stad)
    tiers.js                 # Fler belöningar (v10): cleanTiers, rewardOptions (mindre belöningar + huvudbelöningen, med värde i kr), bestReached, tierReady, crossedTier (nåddes med senaste tappet), carryAfter, krValue
    levels.js                # Stamgästnivåer (v11): LEVELS (Brons 3, Silver 10, Guld 25 besök på 12 mån — samma i SQL och panelen), levelFor, nextLevel, crossedLevel, visitsFields, sthlmDate, afterTap (första stämpeln i dag = nytt besök), progressText
    hours.js                 # Öppettider (v13): openState (öppet nu / öppnar när, även över midnatt), openText ("Öppet nu · stänger 18", "Stängt · öppnar i morgon 7"), hoursLines, siteLabel, instagramUrl
    logos.js                 # Butikens logga (v13): hämtas med cafe_logo när logo_version ändras, sparas i AsyncStorage (tappass.logo.<slug>), useLogo-hook
    savings.js               # Sparat-räknaren (v10): savingsFields (load_wallet-raden), keepSavings (ett tapp behåller siffrorna), walletSavings (summa, per ställe, golv när värden saknas), formatKr ("1 245 kr" med hårda mellanslag)
    quiet.js                 # Lugna timmar: svensk klocka (Intl, Europe/Stockholm, faller tillbaka på telefonens tid), quietNow, schemat i klartext ("mån–fre 14–16")
  components/
    Shape.js                 # En mjuk form i en färg med valfritt innehåll ovanpå (grundbyggstenen i designen)
    StampRow.js              # Stämpelrad: fyllda "cookies" med bock, tomma i dekorton; nya stämplar studsar in i tur och ordning (pops), stämplar lyfter bort när kortet börjar om (exits), sista tomma rutan lyser (present) när en är kvar; rutor med en mindre belöning visar ett paket (marks, v10)
    LoyaltyCard.js           # Stämpelkort med progress, "BELÖNING KLAR"-, "SPARAD BELÖNING"- och "Dubbelstämpel aktiv"-lägen; belöningskort får glans (Shine). Stämplarna krymper (28→18 px) så att 10–12 stämplar ryms på en rad. v10: rutan "Valfri kaka klar – Lös in" när en mindre belöning nåtts; en sparad mindre belöning visar namnet den sparades med (pendingName)
    CafeAvatar.js            # Butikens avatar: loggan urklippt i cookie9-formen (react-native-svg ClipPath + Image), annars initialen i butikens färg
    PlaceSheet.js            # Ställets sida (v13), öppnas från Ställen: logga, öppet nu, beskrivning, belöning (+ mindre belöningar), lugna timmar, öppettider, adress → karta (Apple Kartor på iPhone, Google Maps annars), webbplats, Instagram, kundens kort och nivå
    LevelPill.js             # Stamgästnivån som märke i metallton (Brons/Silver/Guld) — bredvid namnet på kortet
    SavingsBanner.js         # Sparat-räknaren överst under Kort (v10): "Du har fått 7 belöningar" + SPARAT 245 kr (SPARAT MINST när några ställen saknar värde); tryck → per ställe. Ökar summan räknar den upp med "+39 kr" — först när kodrutan stängts (hold), aldrig vid första hämtningen (synced)
    CardStack.js             # Kortbunten på hemskärmen: korten växer fram underifrån och glider in under nästa kort överst när listan skrollas; glansen följer skrollningen. Förutsätter att hemfliken ligger överst i skrollinnehållet
    Shine.js                 # Holografisk glans: ljust band med limekant som sveper över belöningskort (loop 5,2 s, native)
    StampSheet.js            # Stämpelögonblicket: stämpeln slår ner (squash, bläckstänk, våg, vibration i takt med nedslaget); dubbelstämpel = två nedslag → "+2" med ×2; första stämpeln någonsin = välkomst + konfetti; ny stamgästnivå (v11) = "NY NIVÅ – Du är Silvergäst hos …" poppar fram efter nedslaget. Stänger sig själv efter 4,5 s (5,2 s dubbel, 6,5 s första)
    InkSplash.js             # Bläckstänk: partiklar i butikens färg som skjuts ut från mitten (spelas vid montering)
    RadarBadge.js            # Radarvågor som i TapPass-symbolen medan telefonen lyssnar (Android-raden, iOS-knappen under skanning)
    Snackbar.js              # Meddelanden: nätfel (med "Försök igen"), sparad belöning blockerar, okänd stämpel, väntetid, hjulets förlusttext
    RewardSheet.js           # Inlösen: låst ark med "Lös in" (sparar, ger koden som reserv) → "Håll telefonen mot stämpeln" (personalen håller butikens stämpel mot telefonen → redeem_by_tap; fel butiks stämpel → "Fel stämpel – använd X-stämpeln."; iOS: en skanning per tryck) med "Visa sifferkod i stället" → pollar i båda lägena → "Inlöst!" med bock och klockslag (koden löses först upp i partiklar) och "Sparat 39 kr" när butiken angett värdet (v10), stämplarna lyfter och kortet börjar om på överskottet (nätfel ≠ inlöst)
    CelebrationScreen.js     # Fullskärmsfirande vid full stämpelrad: konfetti ur stämpeln + två kanoner från nederhörnen (tung vibration), "Lös in nu" eller "Spara till senare" (+ överskott som följer med); tier (v10) = en mindre belöning nåddes: "Valfri kaka klar!", "Lös in nu" eller "Samla vidare"
    DailyWheel.js            # Fliken Dagens hjul: stadsväljare, snurr (tick-vibration per fält; vinst = lysande fält + strålar i 1,4 s före vinstarket; förlust = hjulet vickar tillbaka), vinstark (välj 1 av 3 ställen), regler, aktiva dubbelstämplar
    WheelGraphic.js          # Själva hjulet (SVG, 10 fält, piggar vid fältgränserna) som roteras med Animated; pekaren knäpper mot piggarna (Animated.modulo av rotationen, native)
    LightRays.js             # Ljusstrålar i lime som växer fram och snurrar bakom hjulet vid vinst
    SeasonFall.js            # Snö, fjädrar, kronblad eller bullar som singlar ner en gång över skärmen (inställningar från season.js)
    Confetti.js              # Konfetti av designens former med fysik (kast, luftmotstånd, fladder, vändningar) uträknad i förväg och spelad på native-tråden; regn uppifrån eller kast från punkter (from)
    AppLinkOnboarding.js     # Välkomstskärm + steg, plattformsgrenad (Android App Links vs iOS Universal Links/skanna)
    BrandMark.js             # TapPass-symbolen (lime-punkt + radarbågar) som vektor
```

## Dataflöde (kärnan)

1. **Stämpel:** NFC-tagg innehåller token (`<slug>-01`, t.ex. `miyabi-01`) som text- eller URL-record (`https://tappass.se/t/<token>`). Deep links tas emot som `https://tappass.se/t/<token>`, `tappass:///t/<token>` och `tappass://t/<token>` (den sista används av "Jag har redan appen" på tappass.se/t/… för iPhone — där blir "t" värdnamn, se `tokenFromUrl`). Appen läser den via `LiveScanner` i `App.js` — som plattformsgrenar: **Android** kör en passiv läsloop (`AndroidScanner`), **iOS** en knapptriggad en-session-per-tryck (`IosScanner`, Core NFC saknar tyst förgrundsläsning). Alternativt tas token emot som deep link (`tokenFromUrl` matchar `/t/<token>`). Alla vägar anropar `tap_token`-RPC:n som atomiskt löser token → café, skapar/hämtar user på `device_id`, blockerar om sparad belöning finns, och returnerar nytt kortläge.
2. **Belöning:** Full rad → `CelebrationScreen` → "Lös in nu" eller "Spara till senare" → `save_reward` sparar belöningen och ger en 6-siffrig kod → `RewardSheet` väntar på butikens stämpel: personalen håller sin TapPass-stämpel mot kundens telefon och appen anropar `redeem_by_tap` (v9), som kontrollerar att stämpeln hör till butiken. Reserv: "Visa sifferkod i stället" → personalen skriver koden i tappass.se/m (`merchant_redeem_by_code`). Appen pollar `current_saved_code` varannan sekund i båda lägena → koden försvinner → "Inlöst!" (med klockslag) och kortet börjar om på eventuellt överskott (annars 0).
3. **Dagens hjul (v6):** `wheel_status` hämtas vid start och på fliken → `spin_wheel(device_id, stad)` avgör utfallet på servern (appen animerar bara fram till serverns fält) → vid vinst väljer kunden ställe och `claim_wheel_prize` skapar en rad i `stamp_bonuses`. Nästa `tap_token` hos stället lägger till en extra stämpel med `source = 'bonus'` och svarar `stamps_added: 2, bonus_applied: true`. Blir kortet överfullt sparar `merchant_redeem_by_code` överskottet i `redemptions.carry_over`, och nästa kort börjar där.
4. **Fler belöningar (v10, valfritt per butik):** butiken lägger till upp till 3 mindre belöningar under huvudbelöningen (`cafes.reward_tiers`, t.ex. kaka vid 5 när kaffe är vid 10). Kunden väljer själv: när ett tapp når en mindre belöning visas firandet med "Lös in nu" eller "Samla vidare"; i kodrutan väljs belöning (`RewardPicker`, den största som nåtts är förvald, större visar "N kvar") och `save_reward(device, slug, tier_at)` sparar valet. Vid inlösen räknas överskottet från vald nivå (7 stämplar, kanelbulle vid 3 → kortet börjar om på 4). En sparad mindre belöning kan ångras (`cancel_saved_reward`, "Ångra – samla vidare"). Appen skickar bara `p_tier_at` till butiker som har mindre belöningar, så den fungerar även mot en server före v10.
5. **Sparat-räknaren (v10):** butiken anger i panelen vad belöningarna är värda i kronor (`cafes.reward_value_kr`, `value_kr` per mindre belöning; valfritt). `save_reward` sparar belöningens namn och värde i raden (`redemptions.reward_name`/`value_kr`), så att personalen och kunden ser samma belöning även om butiken ändrar sina belöningar efteråt; saknas värdet sätts det vid inlösen. `load_wallet` ger per kort `rewards_redeemed`, `saved_kr` och `rewards_unvalued` (äldre inlösen räknas med butikens värde nu) → `SavingsBanner` överst under Kort och "Sparat 39 kr" på Inlöst!-skärmen. Saknas fälten (server före v10) visas ingen banner.
6. **Stamgästnivåer (v11):** besök = svenskt dygn med minst en riktig stämpling (`source = 'tap'`) hos stället; nivå efter besök senaste 12 månaderna (365 dygn inkl. i dag): Brons 3, Silver 10, Guld 25 (`guest_level` i SQL, `LEVELS` i `levels.js` och panelen — ändra alla tre). `load_wallet` ger `visits_12m` och `last_visit`; efter ett tapp räknar appen själv upp ett besök om `last_visit` inte är i dag (svensk tid) och visar "Ny nivå" i stämpelarket (inte i firandet vid fullt kort). Märket syns bredvid namnet på kortet, framsteget under Ställen ("Silvergäst · 13 besök till Guld"). Panelen: `merchant_guest_levels` (kunder per nivå). Utan fälten (server före v11) visas inga nivåer.
7. **Självservice-profil (v13):** TapPass skapar butiken (namn, slug, stad, antal stämplar, tagg och inloggning); butiken ändrar resten i panelens "Profil": typ, område, belöningens text, färg (soft/deep räknas fram för äldre appbyggen), logga, adress, beskrivning, webbplats, Instagram och öppettider. Appen läser fälten ur `cafes` (som förut), visar loggan via `CafeAvatar`, "Öppet nu · stänger 18" under Ställen och hela profilen i `PlaceSheet`. Loggan ligger i `cafe_logos` (bytea, högst 200 kB) och hämtas med `cafe_logo(slug)` bara när `logo_version` ändras.
8. **Identitet:** Inget konto. Slumpat `device_id` i AsyncStorage = användaren. Ominstallation ⇒ nytt id ⇒ stämplarna "försvinner" för användaren (raderna finns kvar i Supabase men går inte att koppla).

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

Nya butiker läggs in direkt i Supabase — inte i koden: `insert into cafes …` (sätt `city`, t.ex. `'Stockholm'` — annars kommer butiken inte med i Dagens hjul), sedan `select public.admin_issue_pin('<slug>');` som skapar tagg, inloggning och slumpad PIN. Se README-v5.md.

**Testbygge från en Claude-session (molnet):** Expo-projektet saknar GitHub-koppling, så `build_run` i Expo-kopplingen ger "No repository found", och GitHub Actions-API:t är blockerat från sessionen. Fungerande väg: skapa en EAS-sandlåda (`sandbox_create`, Linux) → `git clone` repot (publikt) → `npm ci` → `npx eas-cli@latest build -p android --profile preview --non-interactive --no-wait` (sandlådan var inloggad som `tappass-org` t.o.m. 2026-11-04 — se nästa stycke) → stoppa sandlådan. Fungerar bara när Expos kö är kort: sandlådans tidsgräns räknas från skapandet, och vid ~45 min kö (kvällar svensk tid) stängs den direkt när den startar. Preview-bygget blir en APK på kanalen `preview` (första 2026-11-04) och kan inte installeras ovanpå Play-versionen (annan signering). **Bara JS-ändringar?** Hoppa över bygget: kör i samma sandlåda `npx eas-cli@latest update --channel preview --platform android --message "…" --non-interactive` (tar ~1 min, ingen kö) — preview-APK:n hämtar uppdateringen vid kallstart och visar den vid starten efter (gjort första gången 2026-11-04 för Dagens hjul). Samma kommando med `--channel production` når alla Play-användare och körs bara efter Navids uttryckliga godkännande.

**Publicera OTA (läge 2026-11-12):** sandlådan är inte längre inloggad (`eas whoami` → "Not logged in", ingen `EXPO_TOKEN` i miljön), så varken bygge eller `eas update` går därifrån. Två vägar där ingen nyckel passerar chatten: (1) **GitHub-koppling** — koppla repot till Expo-projektet (expo.dev → Project settings → GitHub) och kör sedan `.eas/workflows/publicera-ota-preview.yml` eller `publicera-ota-production.yml` med Expo-kopplingens `workflow_run` (körs på Expos servrar; startas bara manuellt, ingen automatisk trigger); (2) **från en inloggad dator** — `npx eas-cli@latest update --channel production --message "…"` i repo-roten. Be aldrig om `EXPO_TOKEN` i chatten. OTA på `production` når både Play-bygget och iOS-bygget 6 (båda runtime 1.0.0, commit `6948a00`, 2026-10-05). Förkontroll innan publicering: inga nya paket i `package.json` sedan butiksbyggena (kontrollerat 2026-11-12: oförändrad). Ändringarna i `app.json` (länkfiltret `/t/`) och `plugins/withLaunchedFromHistoryFix.js` gjordes efter butiksbyggena och kräver nytt butiksbygge — JS-koden beror inte på dem.

## Kodkonventioner

- Svenska i all användartext och i kommentarer/README; engelska identifierare.
- Inline-styles med tokens från `theme.js` (`T`, `RADIUS`, `FONT`) — ingen StyleSheet/styled-components.
- **Typsnitt:** varje vikt i Roboto Flex är en egen familj (`FONT.regular/medium/semibold/bold/title/display`). Sätt **aldrig** `fontWeight` på text med dessa — Android byter då till systemfont. Tecknet `→` saknas i delmängden; använd ikonen `arrow`.
- **Butiksfärg:** `tone(card.ink)` ger butikens palett (`primary`, `container`, `deco`, `light`, `onContainer`, `muted`). Hårdkoda inte butiksfärger i komponenter.
- **Former:** använd `<Shape kind="cookie9" …>` (formerna i `shapes.js`) i stället för egna cirklar/rutor för dekor, avatarer och stämplar.
- Animationer med core `Animated` + `useNativeDriver: true`; haptik via `expo-haptics` vid varje viktig interaktion.
- All backendlogik i Postgres-RPC:er (`SECURITY DEFINER`); klienten är tunn och litar aldrig på lokalt state.
- Fel sväljs ofta tyst (`catch {}`) och UI:t faller tillbaka till tomt läge — var försiktig med att anta att anrop lyckats.

## Säkerhetsmodell

- Publishable-nyckeln i `src/lib/supabase.js` är avsedd att vara publik; alla skrivningar går genom RPC:er som validerar (PIN:er bcrypt-hashade i `cafe_pins`).
- `service_role`-nyckeln får ALDRIG hamna i appen eller i Lovable.
- Butiks-PIN:er får ALDRIG committas (inte i SQL, README eller kommentarer). Sätt dem manuellt i SQL Editor.
- **Produktion är facit, inte repots SQL.** Live-databasen har ändrats manuellt och skiljer sig från v1/v2-filerna (t.ex. har `cafe_pins` RLS i produktion men inte i v2-filen). Hämta `pg_get_functiondef` innan en funktion skrivs om.
- **v4 (`supabase_migration_v4_security.sql`):** `save_reward` kräver fullt kort; `redeem_reward` är stängd för klientroller — bara personalen löser in (`merchant_redeem_by_code`); `tags` är inte läsbar för klienter (publik butiksinfo per token via `tag_public_info`, används av tappass.se/t/…); `search_path` låst på alla RPC:er. Appen anropar inte längre `redeem_reward` (borttaget i appen 2026-11-03; äldre byggen får behörighetsfel som ignoreras).
- **Kodrutans pollning:** `getCurrentSavedCode` returnerar `{ ok, code }` — bara `ok: true, code: null` betyder inlöst. Nätfel (`ok: false`) får aldrig stänga rutan.
- **Android App Links:** `autoVerify`-filtret i `app.json` innehåller bara `https://tappass.se/t/` (snedstreck sist — annars matchar även `/terms`). `tappass://` har ett eget filter via `scheme`. `public/.well-known/assetlinks.json` på tappass.se (Lovable) måste innehålla Google Plays **appsigneringsnyckel** (SHA-256) — byggena laddas upp som AAB och signeras om av Play.
- **Väntetid per butik (v5):** `cafes.stamp_cooldown_seconds` (10 s–24 h, standard 60 s) som butiken ändrar i tappass.se/m. `tap_token` svarar `error: "cooldown"` + `retry_after_seconds`/`retry_after_minutes`, och appen visar det som info. Appen ignorerar dessutom samma token inom 5 s (dubbelläsning). Token är statiska och gissningsbara (`<slug>-01`): väntetiden bromsar fusk men stoppar inte den som anropar API:t hemifrån. Långsiktigt krävs dynamiska taggar (t.ex. NTAG 424 DNA).
- **Butiksinloggning (v5):** inloggningsnamn (`cafe_pins.login_name`, standard = slug, butiken kan byta) + 6-siffrig PIN ger en sessionsnyckel (30 dagar, hashad i `merchant_sessions`). Panelen sparar nyckeln, aldrig PIN:en. 10 fel PIN låser ny inloggning i 15 min; inloggade sessioner fungerar under spärren. PIN-byte loggar ut övriga enheter.
- **Dagens hjul (v6, `supabase_migration_v6_dagens_hjul.sql`, körd i produktion 2026-11-04 via `apply_migration`):** utfall, snurrgräns (ett per enhet och svenskt dygn via `sthlm_today()`/`sthlm_midnight()`) och erbjudna ställen avgörs i `spin_wheel`; `claim_wheel_prize` godtar bara erbjudna ställen och högst en aktiv bonus per ställe. `wheel_spins` och `stamp_bonuses` har RLS utan klientåtkomst. Transaktionslås per enhet (`pg_advisory_xact_lock` på `tappass:tap:`/`tappass:wheel:` + device_id) stoppar dubbelsnurr och dubbla bonusar vid samtidiga anrop. Staden skickas med vid snurr men lagras aldrig. `stamps.source` är `'tap'` eller `'bonus'`: `merchant_stats`/`merchant_daily` räknar bara `'tap'`, bonusar redovisas i panelens sektion "Kampanjstämplar" (`merchant_campaign_stats`). Kortets antal = `carry_over` från senaste inlösen + stämplar efter den (`stamps_since_last_redeem`). `cafes.wheel_enabled = false` tar bort en butik ur hjulet.
- **v8 (`supabase_migration_v8_lugna_timmar.sql`, körd i produktion 2026-11-13 via `apply_migration`, version `20261113213356`):** butiken väljer dagar och tider (svensk tid) då varje stämpling ger 2 stämplar. `cafes.quiet_hours` = `[{days:[1..7], from:"HH:MM", to:"HH:MM"}]` (högst 7, from < to, "24:00" tillåtet), rensas av `quiet_hours_clean` och kontrolleras av `quiet_hours_active(hours, at)` (båda stängda för klienter). `tap_token` lägger till en stämpel med `source = 'quiet'` och svarar `quiet_applied`; hjulets dubbelstämpel används inte samtidigt (sparas till nästa besök), så ett tapp ger högst 2. En trasig inställning stoppar aldrig en stämpling. Panelen: `merchant_get_quiet_hours` (tider, active_now, besök 30 d/totalt) och `merchant_set_quiet_hours`. `merchant_stats`/`merchant_daily` räknar fortfarande bara `'tap'`. Före körningen var produktionens `tap_token` identisk med v6-versionen (md5 på `prosrc`); efteråt stämmer alla fem funktionerna med PGlite-testet och data var orörd. Alla butiker har `quiet_hours = []` tills de väljer tider i panelen (inga tider = inget visas i appen). Panelens sektion "Lugna timmar" finns i ett Lovable-utkast som inte är publicerat (se "Butikspanelen (Lovable)").
- **v9 (`supabase_migration_v9_inlosen_tapp.sql`, körd i produktion 2026-11-14 via `apply_migration`, version `20261114000254`):** `redeem_by_tap(device, slug, token)` löser in kundens sparade belöning när butikens stämpel hålls mot telefonen; token från en annan butik ger `wrong_tag` med `expected`/`got` (butiksnamnen), en okänd tagg `unknown_tag`. Fullt kort utan sparad kod löses in direkt; om koden nyss lösts in av personalen (inom 2 min) svarar den `already`. Samma transaktionslås som `tap_token`. `redemptions.redeemed_via` = `'tap'` (null = koden; `merchant_redeem_by_code` är oförändrad). `merchant_recent_redemptions` ger panelens lista "Senast inlösta" (24 h, högst 10, samma kundetikett som väntande-listan). Säkerhet som stämplingen: statiska taggar gör att den som anropar API:t hemifrån kan lösa in sin egen belöning — men vinner inget; bekräftelsen i appen visar klockslaget så att personalen ser att den är live, och panelens lista visar inlösen. Testad i PGlite (36 kontroller) mot produktionens funktioner; verifierad efteråt (fingeravtryck, behörigheter, data orörd, `get_advisors`).
- **v10 (`supabase_migration_v10_fler_beloningar.sql`, INTE körd — bekräftelsen avbröts automatiskt 2026-11-14 ca 01.40; därefter utökad med belöningarnas värde (sparat-räknaren); testad i PGlite, 86 kontroller):** `cafes.reward_tiers` (`[{at, text, value_kr?}]`, högst 3, `at` < `stamps_needed`, värde 1–10 000 kr valfritt, rensas av `reward_tiers_clean`), `cafes.reward_value_kr` (huvudbelöningens värde, valfritt) och `redemptions.tier_at` (null = hela kortet). `save_reward` blir `save_reward(device, slug, p_tier_at int default null)` — den gamla 2-argumentsversionen tas bort i samma körning; äldre appar anropar utan nivå och får hela kortet. En sparad belöning kan byta nivå (samma kod) om stämplarna räcker; `p_tier_at` null behåller den sparade. `redemptions.reward_name`/`value_kr` sätts när belöningen sparas (och vid nivåbyte); vid inlösen fylls de i om de saknas (sparade före v10 eller innan butiken angav ett värde). Alla listor och svar visar `coalesce(reward_name, reward_label(…))`, så en borttagen eller omdöpt nivå visas rätt för personalen. `current_saved_code` (`reward`), `merchant_redeem_by_code`, `redeem_by_tap`, `load_wallet` (`pending_tier`, `pending_reward`, `rewards_redeemed`, `saved_kr`, `rewards_unvalued`), `merchant_pending_list` och `merchant_recent_redemptions` (`reward`) skrivs om utifrån produktionens versioner (jämförda 2026-11-14) — överskottet räknas från vald nivå. `redeem_by_tap` utan sparad belöning löser bara in ett fullt kort; har kunden nått en mindre belöning svarar den `choose_reward`. Nya: `cancel_saved_reward`, `merchant_get_reward_tiers` (`reward_value_kr`), `merchant_set_reward_tiers(p_token, p_tiers, p_reward_value_kr)` (tre argument, alltid alla; `invalid_tiers`/`invalid_value`), `reward_label` och `reward_value` (båda stängda för klienter). **Före körning:** jämför `md5(prosrc)` för de omskrivna funktionerna i produktion mot läget efter v9 (save_reward `1fdf07bb…`, current_saved_code `23c0e48d…`, merchant_redeem_by_code `4afc1b7b…`, merchant_pending_list `9420dfe8…`, load_wallet `0e516313…`, redeem_by_tap `5d27bc16…`, merchant_recent_redemptions `184bc605…`; kontrollerat oförändrat 2026-11-14 02.00). **Efter körning** ska fingeravtrycken vara (PGlite): save_reward `3ffac2b0…`, current_saved_code `b861e638…`, cancel_saved_reward `9da1c5e5…`, merchant_redeem_by_code `82149d26…`, redeem_by_tap `45aa1dd6…`, load_wallet `4dae280b…`, merchant_pending_list `3c00f77e…`, merchant_recent_redemptions `e343cd8a…`, merchant_get_reward_tiers `efc2dedd…`, merchant_set_reward_tiers `11136efc…`, reward_tiers_clean `778f06b9…`, reward_label `49736ab6…`, reward_value `a627b831…`. **Panelens sektion "Belöningar" får inte publiceras före v10.**
- **v13 (`supabase_migration_v13_profil.sql`, INTE körd — körs efter v12, som den kontrollerar; testad i PGlite, 66 kontroller):** nya kolumner i `cafes` (`address`, `description`, `website`, `instagram`, `opening_hours`, `logo_version`, `profile_updated_at`, gemensam check) och tabellen `cafe_logos` (RLS, ingen klientåtkomst). `merchant_set_profile(p_token, p_profile)` ändrar bara fälten som skickas och validerar varje (`invalid_field` + `field`): texter trimmas och får inte innehålla styrtecken, webbplats måste vara http(s) med punkt i värdnamnet, Instagram utan @, öppettider via `opening_hours_clean` (högst 14 perioder, from < to). Färgen sätter även `soft_color`/`deep_color` (`color_variants`) — äldre appbyggen (6948a00) använder dem. `merchant_set_logo` kontrollerar typ (PNG/JPEG/WebP), filens magiska byte och storlek (högst 200 kB) och räknar upp `logo_version`; null tar bort loggan. `cafe_logo(slug)` är öppen för appen (loggan är lika publik som namnet). Namn, slug, stad och `stamps_needed` ändras bara av TapPass. Fingeravtryck efter körning: merchant_get_profile `2e124bf7…`, merchant_set_profile `bfc98518…`, merchant_set_logo `0e0e6a63…`, cafe_logo `1bdcc705…`, color_variants `86a156ac…`, hsl_hex `21c005eb…`, opening_hours_clean `c4f268b5…`, profile_text `a980084a…`.
- **v12 (`supabase_migration_v12_insikter.sql`, INTE körd — körs efter v11, som den kontrollerar; testad i PGlite, 55 kontroller):** bara för panelen. Besök = svenskt dygn med riktig stämpling (som v11). `merchant_insights` (återkomst 90 dagar, median tid mellan besök senaste året (null under 5 par), stämplingar per veckodag × timme 90 dagar, `busiest`, tips som nycklar + tal — `lapsed`, `unclaimed`, `return_low`, `quiet_day`, `no_value`, högst 4; texten skrivs i panelen). `merchant_lapsed` = stamgäster (minst 3 besök på 12 mån) vars senaste besök ligger längre bort än max(30 dygn, 2 × deras median); högst 20 i listan, anonyma etiketter. `merchant_winback` ger dem som kan få det en dubbelstämpel i `stamp_bonuses` (`origin = 'winback'`, 14 dagar t.o.m. 23.59) — högst 50 per tryck, aldrig om kunden har en aktiv bonus hos stället (hjulets regel: högst en åt gången) och högst en gång per 60 dagar; lås per butik (`tappass:winback:` + cafe_id). Appen visar den redan som "Dubbelstämpel aktiv" och `tap_token` använder den som en hjulbonus. Panelens "Kampanjstämplar" (`merchant_campaign_stats`) räknar dem också (stämplarna har `source = 'bonus'`). `merchant_month_report(p_token, 'YYYY-MM')` = månadens siffror + föregående månad (`cafe_month_stats`), valbara månader (högst 12). Hjälpfunktionerna `cafe_visit_days`, `lapsed_customers`, `winback_eligible`, `cafe_month_stats` är stängda för klienter. Fingeravtryck efter körning: merchant_insights `83a630ed…`, merchant_lapsed `6cb8384f…`, merchant_winback `30b01241…`, merchant_month_report `54381511…`, cafe_month_stats `ebb3ec14…`, cafe_visit_days `188f4ded…`, lapsed_customers `694fd591…`, winback_eligible `b5b31f54…`. Prestanda: `merchant_insights` räknar `stamps_since_last_redeem` per kund som någonsin stämplat hos butiken (tipset `unclaimed`) — gör om till en mängdfråga om butikerna får tusentals kunder.
- **v11 (`supabase_migration_v11_stamgaster.sql`, INTE körd — körs efter v10, som den kontrollerar; testad i PGlite, 27 kontroller):** `guest_level(visits)` (stängd för klienter), `load_wallet` = v10-versionen + `visits_12m`/`last_visit` (räknas med `stamps_user_cafe_idx`), `merchant_guest_levels(p_token)` (kunder per nivå senaste 12 månaderna, `customers` = kunder med minst ett besök). Fingeravtryck efter körning: load_wallet `44c6fb02…`, guest_level `5455d544…`, merchant_guest_levels `8f70e11a…`. Ändrar inga data.
- **v7 (`supabase_migration_v7_buggfixar.sql`, körd 2026-11-11):** databasens tidszon är UTC, så allt som räknar dygn måste gå via `sthlm_today()`/`sthlm_midnight()` — `merchant_stats` (idag/vecka/månad) och `merchant_daily` gör det nu. `merchant_daily` returnerar alltid de 30 senaste svenska dygnen äldst först med 0 för tomma dagar (tom lista om butiken saknar stämplar), vilket panelens `daily.slice(-7/-30)` förutsätter. `wheel_status.cities[]` har `available` (ställen där kunden saknar aktiv dubbelstämpel) och `spin_wheel` svarar `all_bonused` när den är 0.
- **Ny butik / glömd PIN:** `insert into cafes …` (med `city`) och sedan `select public.admin_issue_pin('<slug>');` i SQL Editor. Ger inloggningsnamn, slumpad PIN (visas en gång) och tagg. Kör den **aldrig** via AI/MCP — då hamnar PIN:en i chattloggar.
- **Supabase free plan** pausar projektet efter 7 dagar utan trafik → app och butikspanel slutar svara tills det återstartas.
- `.env` är gitignorad men används inte i dag — Supabase-URL/nyckel är hårdkodade.

## Köra SQL i produktion

1. **Testa först** mot en kopia av live-schemat (hämta `pg_get_functiondef` från produktion; PGlite i Node fungerar) — skriv aldrig om en funktion utifrån repots SQL.
2. **Kör via Supabase-kopplingen** (`apply_migration`) så att Navid kan godkänna i bekräftelserutan — det är förstahandsvalet.
3. **Om bekräftelsen avbryts automatiskt:** Navid kör filen i Supabase SQL Editor på dator. På mobil klipps långa inklistringar (v5 klipptes efter ~2,5 kB) — använd då en kort snutt som hämtar filen från GitHub låst till commit-SHA + md5 och kör den med `execute` (`http`-tillägget skapas och tas bort i samma körning). Mall: PR #11 / körningen 2026-11-03.
4. **Verifiera alltid efteråt** med läsfrågor (behörigheter, funktionsinnehåll, data orörd) och `get_advisors`.

## Butikspanelen (Lovable)

Projekt `291764fb-25d9-4dbc-9667-de7b172ded18` ("TapPass: The Smart Stamp"); panelen är `src/routes/m.tsx` och texterna (sv + en) `merchantPage` i `src/lib/i18n.tsx`. Panelen anropar produktionens Supabase via `src/lib/merchant-supabase.ts` (publishable-nyckeln) — Lovable ska aldrig skapa migrationer eller slå på Lovable Cloud.

- **Ändra i ett utkast:** `create_draft` och sedan `send_message` med `draft_id`, så att den publicerade sajten inte påverkas. `accept_draft` och `deploy_project` görs bara efter Navids uttryckliga godkännande.
- **Testa lokalt:** sandlådan når inte lovable.app eller tappass.se (proxyn svarar 403). Hämta källkoden med `get_diff` (`sha` = utkastets commit, `base_sha` = `4b825dc642cb6eb9a060e54bf8d69288fbee4904`, git:s tomma träd) — svaret blir för stort och sparas som fil — och plocka ut filerna med `extract-lovable.py`. Testmiljön ligger på grenen `verktyg/testmiljo` under `dev/testmiljo/panel`: Vite kör den riktiga `m.tsx` och Playwright svarar på RPC-anropen (`mock.cjs`), så ingen trafik når produktion. `check.cjs` är funktionstestet och `rec-panel.cjs` spelar in video.
- **Utkastet "Butikspanelen: lugna timmar, inlösen med tapp, fler belöningar"** (`drft_01m7bkcnaxf5qaydwx7nxyyy50`, senaste commit `10fd8bd`, 2026-11-14), testat lokalt (179 kontroller), **inte publicerat — och får inte publiceras förrän v10–v13 är körda** (sektionen "Belöningar" anropar `merchant_get_reward_tiers` och `merchant_set_reward_tiers` med tre argument). Publiceras tillsammans med appuppdateringen så att panelen och appen beskriver samma flöde. Innehåll:
  - Sektionen "Lugna timmar" (dagar/tider, status just nu, besök 30 d/totalt) via `merchant_get/set_quiet_hours`.
  - Listan "Senast inlösta" (24 h, Stämpeln/Kod, klockslag i svensk tid, "igår") via `merchant_recent_redemptions`, uppdateras var 15:e sekund.
  - Ny hjälptext vid koden: kunden löser oftast in med stämpeln, koden är reserv.
  - Sektionen "Belöningar" (v10): huvudbelöningen visas (ändras av TapPass), butiken lägger till/tar bort upp till 3 mindre belöningar (antal stämplar under huvudbelöningen + text), inlösta per belöning 30 d. Väntande- och inlöst-listorna visar vald belöning, och bekräftelsen efter inlöst kod säger "Lämna ut: {belöning}".
  - Värde i kronor (v10, sparat-räknaren): fältet "Värde i kronor" under huvudbelöningen och "Värde (kr)" per mindre belöning (valfria, heltal 1–10 000, tomt = null). "Spara belöningar" skickar nivåerna och huvudbelöningens värde i ett anrop (`p_tiers` med `value_kr`, `p_reward_value_kr`) och laddar sedan om; `invalid_value` visas vid huvudvärdet.
  - Sektionen "Stamgäster" (v11, direkt efter Belöningar, bara läsning): kunder per nivå (Guld, Silver, Brons — högst först) och antal kunder med besök senaste 12 månaderna via `merchant_guest_levels`, uppdateras var 60:e sekund; tomt läge och felläge ("Kunde inte hämta stamgästerna just nu.") utan att resten av panelen påverkas.
  - Sektionerna "Insikter", "Vinn tillbaka" och "Månadsrapport" (v12, efter Stamgäster): återkommande kunder, typisk tid mellan besök, besök 90 d, värmekarta veckodag × timme ("Mest besök: lördagar kl. 10–11") och tips i klartext (nycklarna från `merchant_insights`); listan över stamgäster som slutat komma med knappen "Ge N kunder en dubbelstämpel" (bekräftas i rutan, inga webbläsardialoger) och utfallet senaste 60 dagarna; månadsrapport med månadsväljare, jämförelse mot föregående månad och "Skriv ut / spara som PDF" (utskriften visar bara rapporten, `@media print` i `src/styles.css`). Panelen använder nu `lucide-react` (ikonen Lightbulb) — finns redan i Lovable-projektets beroenden.
  - Sektionen "Profil" (v13, sist): typ, område, belöning (lång + kort text), färg (12 rutor + hexfält, förhandsvisning av kortet med samma `tone()` som appen), logga (laddas upp direkt: skalas i webbläsaren till högst 256×256, WebP/PNG/JPEG ≤ 200 kB → `merchant_set_logo`; "Ta bort logga"), adress, beskrivning (räknare /160), webbplats, Instagram och öppettider (som lugna timmar, upp till 14 rader). "Spara profil" skickar alla fält till `merchant_set_profile`; `invalid_field` visas vid fältet. Belöningar hänvisar nu till Profil för belöningens text (antalet stämplar ändras fortfarande av TapPass).
  - Lovable höjde själv `@lovable.dev/vite-tanstack-config` 2.26.5 → 2.27.1 och lade till en regel i `AGENTS.md` (panelfunktioner i `m.tsx` + `i18n.tsx`, inga migrationer).

## Dagens hjul (byggt 2026-11-04)

Gratis dagligt lyckohjul som ger dubbelstämplar. Design: kanvasens rad "Dagens hjul" (`K-Hjul-*`). Officiella regler: användarvillkoren på tappass.se (§ 5–7), butikernas åtagande i köpvillkoren (§ 5), datahantering i integritetspolicyn — alla uppdaterade 2026-11-04.

**Status:** servern (v6) och butikspanelens "Kampanjstämplar" är live sedan 2026-11-04. Appdelen är bara JS (inga nya native-beroenden) och når användare via ett nytt preview-bygge för test och sedan `eas update --channel production` — det senare bara efter Navids uttryckliga godkännande. Produktion är inte publicerad per 2026-11-12 (godkänd av Navid, men sandlådan saknar inloggning — se "Publicera OTA" ovan). Äldre appversioner fungerar som förut (`tap_token` svarar med extra fält som de ignorerar).

- **Servern avgör allt:** utfall (10 fält, vinst på fält 0/3/5/8 = 40 %), ett snurr per enhet och dygn från 00.00 svensk tid, nästa snurrtid. Telefonens klocka används aldrig; hjulanimationen visar bara serverns resultat och vinsten avslöjas först när hjulet stannat. Förlust: kort text i 3 s med tid kvar till nästa snurr.
- **Stad:** väljs före första snurret, sparas bara i AsyncStorage och skickas med vid snurr; kan bytas i rutan ovanför hjulet. Lagras inte på servern (utlovat i integritetspolicyn). Ingen platsbehörighet. Städerna kommer från `cafes.city` (aktiva butiker med `wheel_enabled`). En stad utan ställen ger `no_places` och förbrukar inget snurr.
- **Vinst:** kunden väljer 1 av 3 slumpade anslutna ställen i staden (minst ett där kunden saknar stämplar, om det finns). Ställen där kunden redan har en aktiv bonus visas inte. Vinsten kan hämtas senare från fliken, men giltigheten räknas från vinstdagen.
- **Bonus hos alla ställen i staden (v7):** då finns inget att vinna — `spin_wheel` svarar `all_bonused` och förbrukar inget snurr. Appen läser `available` för vald stad, visar "Använd en dubbelstämpel först" och ingen prick på Hjul-fliken. Snurret går igen när en bonus använts eller gått ut.
- **Appens avstämning:** hjulets läge hämtas med löpnummer (`loadWheel` i `App.js`) så att ett sent svar aldrig skriver över ett nyare; läget hämtas igen efter varje snurr (även om fliken stängts), vid nätfel, när vinstarket stängs, när appen kommer tillbaka från bakgrunden och efter midnatt. `already_claimed` behandlas som hämtad vinst.
- **Dubbelstämpel:** nästa stämpling hos stället ger 2 (vanlig väntetid gäller). Gäller vinstdagen + 2 dagar t.o.m. 23.59 (`expires_at = sthlm_midnight(spin_date + 3)`). Överskott följer med till nästa kort via `redemptions.carry_over`.
- **Butikspanelen:** sektionen "Kampanjstämplar" på tappass.se/m (`merchant_campaign_stats`) visar bonusstämplar (30 dagar och totalt), aktiva dubbelstämplar, nya kunder via hjulet och överförda stämplar, med länk till köpvillkoren § 5.
- **Appen:** fliken "Hjul" (`DailyWheel.js`, prick när ett snurr väntar). Reglerna nås via "Regler" och hjälpknappen (Apple 5.3: Folde.AI AB är sponsor; Apple och Google är inte inblandade). En aktiv bonus syns på kortet ("Dubbelstämpel aktiv") och som ×2 under Ställen.
- **Fusk:** `device_id` utan konto gör att snurr kan "farmas" med nya id, men bonusen kräver ändå en riktig stämpling på plats.

## Kända begränsningar

- **iOS:** bygge 6 (2026-10-05, kanal `production`, runtime 1.0.0) skickades till App Store 2026-10-06 via `submit-ios.yaml` — OTA på `production` når alltså även iPhone. Kvar för full iOS-funktion: AASA-fil på tappass.se (Universal Links) och URL-records i taggarna (bakgrundsläsning).
- Typsnitt (Roboto Flex, 6 statiska instanser) är inbäddade i `assets/fonts` och laddas via `expo-font` vid start. Splash och adaptiv ikon-bakgrund i `app.json` är fortfarande `#F7F4EE` (native — ändras först vid nästa bygge).
- `device_id`-identiteten överlever inte ominstallation. (`getDeviceId` är single-flight sedan 2026-11-11 — samtidiga anrop vid första start får samma id.)
- `expiryText` i `wheel.js` använder telefonens tidszon: en telefon inställd på annan tidszon än svensk kan visa fel veckodag för "t.o.m. … 23.59". Medvetet kvar (låg påverkan); rätta genom att formatera i Europe/Stockholm om det behövs.
- Ingen felrapportering från appen i fält: Expo Observe kräver betald EAS-plan och Play-kraschdata kräver en Google-tjänstekontonyckel i Expo.
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
7. ✅ **`AppLinkOnboarding.js` plattformsgrenad** — välkomstskärm följd av plattformssteg: iOS får Universal Links/skanna-innehåll i stället för Androids "öppna som standard". Visas bara vid första start (AsyncStorage-flagga via `prefs.js`) och kan öppnas igen via hjälpknappen i sidhuvudet.

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
