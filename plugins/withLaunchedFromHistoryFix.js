// Expo config plugin (Android).
//
// Problem: kunden öppnar appen via en tagg/länk (https://tappass.se/t/<token>).
// Om Android senare avslutar processen och kunden öppnar TapPass från "senaste
// appar" levererar Android om den URSPRUNGLIGA länken. Linking.getInitialURL()
// returnerar den då igen och appen ger en ny stämpel utan att kunden tappat.
//
// Lösning: rensa länken i MainActivity.onCreate när aktiviteten startas från
// historiken (Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY). Nya tryck och länkar
// påverkas inte — de startar aldrig med den flaggan.
//
// Native ändring: kräver nytt EAS-bygge (når inte ut via OTA).

const MARKER = "FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY";

function addLaunchedFromHistoryFix(contents, language) {
  if (contents.includes(MARKER)) return contents; // redan tillagd
  if (language !== "kt") {
    throw new Error(`withLaunchedFromHistoryFix: väntade MainActivity.kt (Kotlin), fick "${language}".`);
  }
  const onCreate = /override fun onCreate\(savedInstanceState: Bundle\?\)\s*\{/;
  if (!onCreate.test(contents)) {
    // Hellre ett misslyckat bygge än en app som tyst saknar skyddet.
    throw new Error("withLaunchedFromHistoryFix: hittade inte onCreate i MainActivity.kt.");
  }
  let out = contents.replace(
    onCreate,
    (m) => `${m}
    // TapPass: startad från "senaste appar" → Android levererar om den gamla
    // länken. Rensa den så att den inte ger en ny stämpel.
    if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
      intent.data = null
    }`
  );
  if (!/^import android\.content\.Intent$/m.test(out)) {
    out = out.replace(/^(package [^\n]+\n)/, "$1\nimport android.content.Intent\n");
  }
  return out;
}

function withLaunchedFromHistoryFix(config) {
  const { withMainActivity } = require("expo/config-plugins");
  return withMainActivity(config, (cfg) => {
    cfg.modResults.contents = addLaunchedFromHistoryFix(cfg.modResults.contents, cfg.modResults.language);
    return cfg;
  });
}

module.exports = withLaunchedFromHistoryFix;
module.exports.addLaunchedFromHistoryFix = addLaunchedFromHistoryFix;
