const http = require("http"), fs = require("fs"), path = require("path");
const root = process.argv[2];
const types = { ".html": "text/html", ".js": "application/javascript", ".ttf": "font/ttf", ".json": "application/json", ".png": "image/png" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(8099, () => console.log("ok 8099"));
