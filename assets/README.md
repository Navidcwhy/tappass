# assets/

## icon.png (KRÄVS för iOS/App Store)

`app.json` pekar på `./assets/icon.png`. Lägg din app-ikon här **innan**
du kör `eas build`.

Krav (annars avvisas uppladdningen — ITMS-90022 / ITMS-90717):

- **1024 × 1024 px**, kvadratisk
- **PNG**
- **Ingen alfakanal / ingen transparens** — fyll bakgrunden med en solid
  färg (t.ex. vit `#FFFFFF` eller lime `#B8D635`). Apple lägger själv till
  rundade hörn; lämna motivet med lite marginal.
- Ingen skugga/glans behövs.

Nuvarande TapPass-symbol (lime cirkel + två svarta radarbågar) fungerar bra
— exportera den bara på solid bakgrund i 1024×1024 utan transparens.

> Filen är avsiktligt inte incheckad ännu; leverera den och committa så är
> ikon-steget klart.
