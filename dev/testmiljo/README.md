# Testmiljö (bara för utveckling — ingår inte i appen)

Sparad 2026-11-13 så att en ny Claude-session kan fortsätta utan att bygga om allt.
Används i en **kopia** av repot, aldrig i själva appen (filerna här byggs inte in).

## Innehåll
- `app/__tests__/` — Jest-tester (jest-expo, react-test-renderer). 106 tester, android + ios (ett bara iOS).
- `app/jest.*.config.js`, `app/jest.setup.js` — konfiguration och mockar (haptik, svg, ikoner, AsyncStorage).
- `app/src/lib/*.web.js` — webbmockar: demoscenarier (`?s=full|redeem|tap|tiers|sparat|niva|profil|stack|win|quiet|home …`,
  `&d=<ms>` innan tappet svarar), NFC och NFC-status för webbförhandsvisningen.
  `window.__tappassTag("miyabi-01")` simulerar att en stämpel hålls mot telefonen (`?s=tap`: Bryggan = fel stämpel).
- `rec3.js` — spelar in klipp i 780×1688 (390×844 @2x) via Chromes screencast, med klick
  (`click:`/`clicklast:`), skroll, JavaScript (`eval:__tappassTag('miyabi-01')`) och flyttad klocka (`&now=2026-12-13T09:00`). `serve.js` — statisk server på 8099.
- `pgtest/` — PGlite-tester för SQL. `base.sql` = schema hämtat från produktion 2026-11-04;
  lägg på v6, v7 (och v8) från repo-roten. Produktion är facit — hämta alltid
  `pg_get_functiondef` innan en funktion skrivs om.

## Återställ i en ny session
```bash
cp -r . /tmp/tp && cd /tmp/tp            # kopia av repot
cp -r dev/testmiljo/app/. .              # tester, jest-konfig, webbmockar
npm ci
npm i --no-save jest@29.7.0 jest-expo@54.0.18 react-test-renderer@19.1.0 \
  react-native-web@0.21.4 react-dom@19.1.0 @expo/metro-runtime@6.1.2
npx jest -c jest.android.config.js && npx jest -c jest.ios.config.js
npx expo export --platform web --output-dir webdist
node dev/testmiljo/serve.js "$PWD/webdist" &     # http://localhost:8099
node dev/testmiljo/rec3.js vid 'a=/t/miyabi-01?s=quiet&d=2600&now=2026-11-16T14:20@8'
cd dev/testmiljo/pgtest && npm i @electric-sql/pglite@0.3.16 && node test-v8-quiet.mjs && node test-v9-tap.mjs && node test-v10-tiers.mjs && node test-v11-levels.mjs && node test-v12-insights.mjs && node test-v13-profile.mjs
```

## Butikspanelen (tappass.se/m, Lovable) — `panel/`
Sandlådan når inte lovable.app eller tappass.se, så panelens riktiga kod körs lokalt i Vite
och Playwright svarar på alla RPC-anrop (`mock.cjs`) — ingen trafik når produktion.
- `extract-lovable.py` — plockar ut `m.tsx`, `i18n.tsx`, `styles.css` och `merchant-supabase.ts`
  ur en Lovable-diff mot git:s tomma träd (svaret från `get_diff` sparas som fil eftersom det är stort).
- `shim/router.js` — ersätter TanStack Router (`Route.component` = sidan).
- `check.cjs` — funktionstest av "Lugna timmar" och "Senast inlösta" (54 kontroller: spara, validering, polling med
  falsk klocka, bad_session, läsfel, engelska, 360 px). `rec-panel.cjs` — video (768×1024 @2x).

```bash
cd dev/testmiljo/panel && npm ci
# get_diff(project_id, sha=<commit>, base_sha="4b825dc642cb6eb9a060e54bf8d69288fbee4904") → sparad fil
python3 extract-lovable.py <sparad-diff-fil> .
# + read_file src/assets/brand/tappass-wordmark.svg → src/assets/brand/tappass-wordmark.svg
npx vite --port 5174 --strictPort --host 127.0.0.1 &
node check.cjs && node rec-panel.cjs vid
```
