# Konto (v14) — inställning före start

Kontot är frivilligt. Utan konto är telefonens slumpade id kunden, och stämplarna finns bara i
telefonen. Med konto loggar kunden in med en **kod på e-post** (inget lösenord), och alla
telefoner som loggar in får samma kort. Appdelen är bara JS (inga nya paket) och följer med
nästa OTA. Allt är avstängt tills stegen nedan är klara: appen visar ingen kontoknapp förrän
`auth_methods` säger att e-post är påslaget.

## 1. Kör migrationen

Ordning: v10 → v11 → v12 → v13 → **v14** (`supabase_migration_v14_konto.sql`, kontrollerar att v13
är körd). Kör via Supabase-kopplingen (`apply_migration`) eller i SQL Editor. Ändrar inga
befintliga funktioner eller data — nya tabeller `accounts` och `app_settings` och sju nya
funktioner.

Fingeravtryck efter körning (`md5(prosrc)`, PGlite):

| Funktion | md5 |
|---|---|
| `account_link(text)` | `bb93b5e3…` |
| `account_status(text)` | `9479a92c…` |
| `account_rotate()` | `ce24031f…` |
| `account_delete()` | `4a308435…` |
| `merge_users(uuid,uuid)` | `74de8f93…` |
| `auth_methods()` | `a723834f…` |
| `mask_email(text)` | `86ae602c…` |

Behörigheter: `account_link`, `account_rotate`, `account_delete` bara för `authenticated`;
`auth_methods`, `account_status` för `anon` och `authenticated`; `merge_users`, `mask_email`
stängda. Kör `get_advisors` efteråt.

## 2. E-post i Supabase Auth (Dashboard → Authentication)

1. **Egen SMTP** (Emails → SMTP Settings). Supabases inbyggda e-post skickar bara till
   projektets egna medlemmar och några mejl i timmen — den duger inte för kunder. Välj en
   EU-baserad leverantör, verifiera domänen (SPF/DKIM för tappass.se) och använd t.ex.
   avsändaren `TapPass <inloggning@tappass.se>`.
2. **Mallar** (Emails → Templates): lägg in koden `{{ .Token }}` i **både** "Magic Link" och
   "Confirm signup" (nya kunder kan få den senare). Förslag:
   - Ämne: `Din kod till TapPass`
   - Innehåll:
     ```html
     <h2>Din kod till TapPass</h2>
     <p>Skriv in koden i appen för att logga in:</p>
     <p style="font-size:32px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
     <p>Koden gäller i 15 minuter. Har du inte bett om den kan du strunta i det här mejlet.</p>
     ```
3. **E-post som inloggning** (Sign In / Providers → Email): påslagen, med "Allow new users to
   sign up". Email OTP Length 6 (appen klarar 6–10), Email OTP Expiration 900 sekunder.
4. **Gränser** (Rate Limits): höj "emails sent per hour" (t.ex. 100). En kod per adress och
   minut gäller ändå — appen räknar ned "Skicka ny kod om 42 s".

Ingen Redirect URL behövs — koden skrivs in i appen.

## 3. Integritetspolicy och butikerna

Innan kontot slås på: uppdatera tappass.se/integritetspolicy (Lovable-projektet) med att
- vi sparar e-postadressen och när kontot skapades, kopplat till kundens stämplar, för att
  kunden ska kunna logga in och ha samma kort på flera telefoner (avtal),
- data lagras hos Supabase i EU (eu-north-1, Stockholm) och mejlen skickas via SMTP-leverantören,
- kontot kan raderas i appen när som helst: e-posten och kontot raderas, stämplarna försvinner
  ur appen och finns kvar i butikernas statistik utan koppling till kunden.
- (v15) kunden kan frivilligt ange sin födelsedag — bara dag och månad, inte året — för
  födelsedagspresenten; den raderas med kontot eller när kunden tar bort den.

Uppdatera också App Store Connect (App Privacy: E-postadress, kopplad till användaren, för
appens funktion) och Google Play (Datasäkerhet: e-post samlas in, kan raderas).

## 4. Slå på

```sql
update public.app_settings
   set value = jsonb_set(value, '{email}', 'true'), updated_at = now()
 where key = 'auth_methods';
```

Appen läser inställningen vid start (och när den kommer tillbaka från bakgrunden om läsningen
misslyckades). `false` döljer kontoknappen igen för kunder utan konto; inloggade kunder ser
fortfarande sitt konto.

Testa först med en egen adress: logga in på två telefoner, kontrollera att korten slås ihop,
"Logga ut andra telefoner" och "Radera konto".

## Hur det fungerar

- **Kontonyckeln:** kontot är en rad i `users`. Radens `device_id` är kontots nyckel — alla
  inloggade telefoner får den och använder den i alla vanliga anrop (`tap_token`, `load_wallet`
  …), som därför inte ändrats.
- **Inloggning** (`account_link`): nytt konto → telefonens id blir nyckeln. Befintligt konto →
  det telefonen samlat flyttas in (`merge_users`): korten summeras per ställe, och hamnar den
  senaste inlösen på det ena kortets stämplar läggs de andra till i överskottet (`carry_over`),
  så att inga stämplar försvinner. Krockar: en sparad belöning per kort (telefonens ångras,
  stämplarna finns kvar), ett hjulsnurr per dag (en vinst behålls före en förlust), en aktiv
  dubbelstämpel per ställe.
- **Inloggningen sparas inte** i appen. Sessionen används bara för att koppla, byta nyckel eller
  radera, i en egen klient, och avslutas direkt. Alla andra anrop går som förut.
- **Kräver kod:** koppla, "Logga ut andra telefoner" (`account_rotate`, ny nyckel — tappad
  telefon) och "Radera konto" (`account_delete`). Nyckeln ensam räcker inte, så den som hittar
  en borttappad telefon kan inte ta över eller radera kontot. "Logga ut från den här telefonen"
  sker bara i telefonen (nytt slumpat id).
- **Radera** (App Store 5.1.1(v)): inloggningen (e-posten) och kontot raderas, sparade belöningar
  ångras och oanvända dubbelstämplar tas bort. Kundraden får en oåtkomlig nyckel
  (`raderad_…`), så stämplarna försvinner ur appen på alla telefoner men butikernas statistik
  ändras inte i efterhand.
- **Utloggad från en annan telefon:** appen frågar `account_status` vid start och när kontoarket
  öppnas; svarar servern att telefonen inte längre är kopplad visas det, och kunden kan logga in igen.

## Senare: Apple och Google

`app_settings.auth_methods` har redan `apple` och `google` (av), och `account_link` fungerar med
alla inloggningssätt i Supabase Auth. De kommer med nästa butiksbygge, eftersom de kräver
inbyggda moduler som inte kan skickas med OTA:
- **Apple:** `expo-apple-authentication` (inbyggd "Logga in med Apple" på iPhone) och en Services
  ID/nyckel i Supabase. Apple kräver att appen återkallar Apple-token när kontot raderas
  (Edge Function med Apples REST-API).
- **Google:** `expo-web-browser` (inloggning i webbvy i appen — Apple underkänner inloggning som
  öppnar Safari) och en OAuth-klient i Google Cloud. Erbjuds Google på iPhone måste även Apple
  (eller motsvarande) finnas (riktlinje 4.8).
