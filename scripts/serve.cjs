'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const allowed = new Set(['index.html', 'styles.css', 'config.js', 'rules.js', 'rankings.js', 'speech.js',
  'daily.js', 'progress.js', 'game.js', 'favicon.svg', 'cover.png']);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!allowed.has(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', types[path.extname(name)]);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(path.join(root, name)).pipe(res);
}).listen(Number(process.env.PORT || 8767), '127.0.0.1', () => console.log('Echo Grid preview on http://127.0.0.1:' + (process.env.PORT || 8767)));
