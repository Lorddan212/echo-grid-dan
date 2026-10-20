// Local checks only: this command never publishes or contacts start.ng.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));

function checkPackage() {
  const required = ['index.html', 'styles.css', 'daily.js', 'progress.js', 'game.js', 'startng.json', 'cover.png', 'favicon.svg', 'README.md'];
  for (const name of required) assert.ok(read(name).length, name + ' must not be empty');

  const html = read('index.html').toString();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const idSet = new Set(ids);
  assert.equal(ids.length, idSet.size, 'HTML IDs must be unique');
  for (const match of html.matchAll(/\b(?:aria-labelledby|aria-describedby|for)="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/)) assert.ok(idSet.has(id), 'Missing label/description target: ' + id);
  }
  for (const match of html.matchAll(/\b(?:src|href)="(\.\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
    const target = path.resolve(root, match[1]);
    assert.ok(target.startsWith(root + path.sep), 'Asset path must remain in the project: ' + match[1]);
    assert.ok(fs.statSync(target).isFile(), 'Missing asset: ' + match[1]);
  }
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(match => match[1]);
  assert.deepEqual(scripts.map(tag => tag.match(/src="([^"]+)"/)?.[1]), ['./config.js', './rules.js', './rankings.js', './speech.js', './daily.js', './progress.js', './game.js'],
    'Load the Daily generator and progress store before the game');
  assert.ok(scripts.every(tag => /\bdefer\b/.test(tag)), 'Game scripts must wait for the HTML');

  const config = JSON.parse(read('startng.json').toString());
  assert.deepEqual(config.leaderboard?.stats?.map(stat => stat.key), ['score', 'rounds', 'streak'],
    'Preserve the existing leaderboard fields and tie-break order');
  assert.ok(config.leaderboard.stats.every(stat => stat.order === 'highest' && typeof stat.label === 'string' && stat.label.trim()),
    'Leaderboard fields need labels and highest-first sorting');
  const cover = read('cover.png');
  assert.ok(cover.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'cover.png must be a PNG');
  assert.ok(cover.length >= 24 && cover.toString('ascii', 12, 16) === 'IHDR' && cover.readUInt32BE(16) > 0 && cover.readUInt32BE(20) > 0,
    'Cover image must declare nonzero dimensions');
  console.log('PASS: required files, local asset references, labels, script order, leaderboard fields, and cover header.');
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Failed: node ' + args.join(' '));
}

try {
  checkPackage();
  runNode(['--check', 'daily.js']);
  runNode(['--check', 'progress.js']);
  runNode(['--check', 'game.js']);
  for (const file of ['config.js', 'rules.js', 'rankings.js', 'speech.js', 'server/server.cjs']) runNode(['--check', file]);
  runNode(['--test', ...fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.cjs')).map(name => 'tests/' + name)]);
  console.log('PASS: local release checks. Browser, device, and live-service checks remain separate.');
} catch (error) {
  console.error('FAIL: ' + error.message);
  process.exitCode = 1;
}
