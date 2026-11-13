# Testmiljö (bara för utveckling — ingår inte i appen)

Sparad 2026-11-13 så att en ny Claude-session kan fortsätta utan att bygga om allt.
Används i en **kopia** av repot, aldrig i själva appen (filerna här byggs inte in).

## Innehåll
- `app/__tests__/` — Jest-tester (jest-expo, react-test-renderer). 81 tester, android + ios.
- `app/jest.*.config.js`, `app/jest.setup.js` — konfiguration och mockar (haptik, svg, ikoner, AsyncStorage).
- `app/src/lib/*.web.js` — webbmockar: demoscenarier (`?s=full|redeem|stack|win|quiet|home …`,
  `&d=<ms>` innan tappet svarar), NFC och NFC-status för webbförhandsvisningen.
- `rec3.js` — spelar in klipp i 780×1688 (390×844 @2x) via Chromes screencast, med klick,
  skroll och flyttad klocka (`&now=2026-12-13T09:00`). `serve.js` — statisk server på 8099.
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
cd dev/testmiljo/pgtest && npm i @electric-sql/pglite@0.3.16 && node test-v8-quiet.mjs
```
