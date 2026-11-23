# Butiksbilder (App Store och Google Play)

Verktyget tar skärmbilder och förhandsvideor till butikerna från den riktiga appen. Appen byggs för webben (react-native-web) och visas i Chromium via Playwright.

Datan är påhittad. Alla anrop till Supabase besvaras av `harness/demo.cjs`, så ingen trafik når produktion. Klockan står still på tisdag 24 november 2026 kl. 9.41. Då visas inga säsongsdetaljer.

Bilderna gjordes första gången 2026-11-22 från `eea3af8` (version 1.0.1).

## Resultat (i `harness/out/`)

| Fil | Till | Format |
|---|---|---|
| `appstore/{sv,en}/01–06.png` | App Store, "iPhone with Dynamic Island (large display)" (6,5", 6,7" och 6,9") | 1320×2868, PNG utan alfakanal |
| `appstore-63/{sv,en}/01–06.png` | App Store, "iPhone with Dynamic Island (medium display)" (6,1" och 6,3") | 1206×2622 |
| `appstore-65/{sv,en}/01–06.png` | App Store, "iPhone with Face ID (large display)" (6,5") | 1284×2778 |
| `play/{sv,en}/01–06.png` | Google Play, telefon | 1080×1920, PNG utan alfakanal |
| `video/TapPass-forhandsvisning-iphone-886x1920.mp4` | App Store, förhandsvisning | 886×1920, 30 bilder/s, H.264 High, tyst AAC-spår, cirka 25 s |
| `video/TapPass-video-android-1080x1920.mp4` | YouTube-länken i Google Play | 1080×1920, 30 bilder/s, cirka 25 s |

Appen är bara på svenska. De engelska bilderna har därför engelska rubriker men svensk app.

Appen stöder inte iPad (`supportsTablet: false`), så det behövs bara iPhone-bilder.

## Köra

Verktyget kräver Node 20 eller senare, ffmpeg och ImageMagick (`convert`).

```bash
git switch verktyg/butiksbilder
dev/butiksbilder/setup-app.sh origin/main    # bygger appen för webben i ../tappass-butiksbilder-app
cd dev/butiksbilder/harness
npm ci && npx playwright install chromium
npm run smoke     # snabbkoll: appen startar och anropen besvaras, utan fel
npm run bilder    # skärmbilderna, cirka 2 min
npm run video     # videorna
```

`setup-app.sh` gör alla ändringar i en egen kopia (git worktree), aldrig i main. Ändringarna i kopian:
- Attrapper för NFC och safe area. Testskripten "tappar" en stämpel med `window.__nfcTap(url)`.
- Platform-kontrollerna läser `global.__SHOT_OS__`, så att `?os=ios|android` i adressen väljer plattform. `Platform.select` täcks inte. Lägg till det i skriptet om appen börjar använda det.
- Paketen `react-native-web`, `react-dom` och `@expo/metro-runtime` installeras, och appen byggs med `expo export --platform web`.

Ta bort kopian efteråt med `git worktree remove --force ../tappass-butiksbilder-app`. Ligger kopian på en annan plats: sätt `APP_DIR` för `setup-app.sh` och `APP_DIST` för skripten.

## Ändra

- **Texterna:** `SLIDES` i `compose.cjs`, på sv och en med egna varianter för iOS och Android.
  - Lova bara sådant appen gör. Appen använder till exempel inte platsen, så "nära dig" ska inte stå där.
  - Hjulet ger en chans att vinna, så "vinn varje dag" ska inte heller stå där.
- **Scenerna:** `shoot.cjs` sparar råbilder i `out/raw`. `SLIDES` i `compose.cjs` väljer vilken råbild varje bild använder.
  - Konfettin slumpas vid varje körning. Titta igenom rutorna och välj en där ingen text täcks.
- **Datan:** `demo.cjs`. Använd bara påhittade ställen.
  - Sök på nya namn på webben innan de används, så att de inte liknar riktiga ställen. 2026-11-22 byttes "Café Linnea" och "Bageri Sol" ut av det skälet: de liknade Linnea's i Tyresö och SOL Bageri i Göteborg.
  - Skriv inga husnummer i adresserna och lägg inte in något Instagram-konto.
  - `Café Blåklint` har ett hårt mellanslag, så att raden i stämpelarket bryts före namnet.
- **Videon:** manuset finns i `video.cjs`. `assemble.cjs` gör om bildrutorna till en video med jämn bildtakt (ffmpeg).

## Ladda upp

**App Store:** bilder och videor kan bara bytas i en version som går att redigera. Utan nytt bygge används Product Page Optimization:
1. Create Test.
2. Öppna behandlingens Media Manager och fyll alla tre iPhone-platserna med bilder och video, för sv och en.
   - Den gamla sidan hade bara "iPhone with Face ID (large display)". Behandlingen får en kopia av den, så töm den först med Remove All.
   - En tom plats står som "Using Existing Assets" och kan visa de gamla bilderna. Fyll därför alla tre.
   - Videon (886×1920) går in på alla tre platserna.
3. Start Test → Add for Review → Submit for Review. Granskningen tar upp till 48 timmar.
4. När Apple har godkänt testet: Apply Treatment to Current Product Page och välj versionen.

Bara bilder och videor följer med, inte ikonen. En behandling per test, och steget kan inte ångras.

Den inbyggda webbläsaren i Claude-appen kan inte välja filer. Filerna hämtades därför i sidan från raw.githubusercontent.com och lades i filfältet med `DataTransfer`. Rätt plats och ordning syns på filnamnen i `aria-label` på varje bild i Media Manager.

**Google Play:**
1. Butiksnärvaro → Huvudsaklig butiksinformation.
2. Byt telefonbilderna per språk.
3. Ladda upp Android-videon olistad på YouTube och klistra in länken i fältet för video.
4. Spara och skicka ändringarna för granskning.
