// Gör om bildrutorna till en färdig video med jämn bildtakt (30 bilder/s, H.264, tyst ljudspår).
// node assemble.cjs ios   → out/video/TapPass-forhandsvisning-iphone-886x1920.mp4
// node assemble.cjs android → out/video/TapPass-video-android-1080x1920.mp4
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const OS = process.argv[2] || "ios";
const DIR = path.join(__dirname, "out/video");
const { start, end, frames } = JSON.parse(fs.readFileSync(path.join(DIR, `${OS}-marks.json`), "utf8"));
const W = OS === "ios" ? 886 : 1080;
const H = 1920;
const out = path.join(DIR, OS === "ios" ? "TapPass-forhandsvisning-iphone-886x1920.mp4" : "TapPass-video-android-1080x1920.mp4");

// Senaste bildrutan före start blir första bilden; varje bild visas tills nästa kommer.
let i0 = frames.findIndex((f) => f.t >= start);
if (i0 > 0) i0 -= 1;
const sel = frames.slice(i0).filter((f) => f.t <= end);
const lines = [];
for (let i = 0; i < sel.length; i++) {
  const t = Math.max(sel[i].t, start);
  const next = i + 1 < sel.length ? sel[i + 1].t : end;
  const d = Math.max(0.001, next - t);
  lines.push(`file '${sel[i].f}'`, `duration ${d.toFixed(4)}`);
}
lines.push(`file '${sel[sel.length - 1].f}'`);
const list = path.join(DIR, `${OS}-concat.txt`);
fs.writeFileSync(list, lines.join("\n"));
const total = end - start;

execFileSync("ffmpeg", [
  "-v", "error", "-y",
  "-f", "concat", "-safe", "0", "-i", list,
  "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
  "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,format=yuv420p`,
  "-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-preset", "slow", "-crf", "17",
  "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2",
  "-t", total.toFixed(3), "-movflags", "+faststart", "-shortest",
  out,
], { stdio: "inherit" });
console.log(path.basename(out), total.toFixed(1) + " s");
