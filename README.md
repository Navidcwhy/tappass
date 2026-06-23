# Stämpla — Expo (Android, äkta NFC)

Mobil-version av Stämpla med riktig NFC-läsning via `react-native-nfc-manager`.
Eftersom Expo Go från Play Store inte stöder NFC behövs en **Expo Dev Client** — en egen Expo Go-app som vi bygger åt dig en gång.

## 0. Det här behöver du på datorn
- **Node.js 18+** ✓ (du har det)
- **Java 17** — krävs för att bygga Android-paketet. Installera om du saknar:
  - macOS: `brew install --cask temurin@17`
  - Windows: ladda Eclipse Temurin 17 (`adoptium.net`)
- **Android Studio** (för Android SDK + ADB).
  Öppna en gång, godkänn licenser, låt det installera SDK. Du kör inte emulator — bara SDK behövs.
- **USB-kabel + en Android-telefon med NFC**, USB-debug påslaget (Inställningar → Om telefonen → tryck "Build number" 7 ggr → Utvecklaralternativ → USB-felsökning).

## 1. Installera Expo CLI och beroenden
```bash
cd stampla-mobile
npm install
npm install -g eas-cli       # för molnbygge (alternativ längre ner)
```

## 2. Bygg en Dev Client till din telefon
Två vägar — välj A om du har Android Studio + Java, välj B om du vill undvika lokal setup.

### A) Lokalt (snabbast om du redan har Android Studio)
Med telefonen i USB-kabel och USB-debug på:
```bash
npx expo run:android
```
Första körningen tar ~10 min (bygger native paketet och installerar på telefonen).

### B) Via EAS Build (i molnet, du behöver inte Android Studio)
```bash
npx eas login
npx eas build --profile development --platform android
```
När bygget är klart får du en .apk-länk. Ladda ner på telefonen och installera.

## 3. Starta utvecklingsservern
```bash
npm start
```
Öppna **din Dev Client-app** på telefonen → den hittar servern automatiskt på samma wifi → laddar appen. När du sparar filer hot-reloadar den.

## 4. Slå på NFC
Sätt på NFC på telefonen (Inställningar → Anslutningar → NFC).
I appen: tryck **★** → **Skanna fysisk tagg** → håll mot tagg → ✓ stämplat.

## Felsök
- **"NFC ej tillgängligt"**: kör du Expo Go från Play Store? Det funkar inte — Dev Client krävs.
- **Appen kraschar vid start**: kontrollera att `App.js` finns och att `npm install` gick igenom utan fel.
- **Hot reload streckar inte igenom**: skaka telefonen → Reload.
- **Bygget misslyckas på Java-version**: säkerställ Java 17 (`java -version`).

## Lägg till fler taggar/caféer
Öppna `src/lib/registry.js`. Lägg till ett nytt objekt med ett `id`. Skriv exakt det id:t som **text** på en NFC-tagg via NFC Tools-appen. Klart.

## Vad som finns
- Kund-app: Mina kort + Ställen
- Skanner med äkta NFC + simulering
- Stämpel-animation, haptik, konfetti
- Vänd kortet → historik + håll-för-att-lösa-in

Admin-vyn är webb-only (för datorn) och ligger inte i mobilversionen.
