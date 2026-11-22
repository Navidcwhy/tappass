const { openApp, stopServer, sleep } = require("./lib.cjs");
(async () => {
  for (const os of ["ios", "android"]) {
    const size = os === "ios" ? { width: 393, height: 764 } : { width: 412, height: 860 };
    const { browser, page, calls, errors } = await openApp({ os, size, scale: 2 });
    await sleep(6000);
    await page.screenshot({ path: `out/raw/smoke-${os}.png` });
    console.log(os, "calls:", [...new Set(calls)].join(","));
    console.log(os, "errors:", errors.slice(0, 8).join("\n  "));
    await browser.close();
  }
  stopServer();
})().catch((e) => { console.error(e); process.exit(1); });
