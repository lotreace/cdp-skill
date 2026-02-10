#!/usr/bin/env node
/**
 * CaptureVerification
 *
 * CLI script that runners call as their last step before writing the trace.
 * Connects to the runner's browser tab via CDP, evaluates the capture
 * expression built from the test's milestones, and prints the snapshot
 * JSON to stdout. The runner embeds this as verificationSnapshot in the trace.
 *
 * Usage:
 *   node CaptureVerification.js --test <test.json> --tab <alias> --port 9222
 *
 * Output:
 *   JSON snapshot to stdout (or "null" on failure)
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';
import { buildCaptureExpression } from './VerificationSnapshot.js';

function loadTabRegistry() {
  const registryPath = path.join(os.tmpdir(), 'cdp-skill-tabs.json');
  try {
    if (fs.existsSync(registryPath)) {
      return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    }
  } catch { /* ignore */ }
  return { tabs: {} };
}

function resolveTabAlias(alias) {
  const registry = loadTabRegistry();
  const entry = registry.tabs[alias];
  if (!entry) return alias;
  return typeof entry === 'string' ? entry : entry.targetId;
}

function findTarget(host, port, targetId) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${host}:${port}/json`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const targets = JSON.parse(data);
          const target = targetId
            ? targets.find(t => t.id === targetId || t.id === targetId.toLowerCase())
            : targets.find(t => t.type === 'page');
          if (!target) { reject(new Error(`No target found for ${targetId || 'any page'}`)); return; }
          resolve(target);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function connectCDP(wsUrl) {
  const WebSocket = globalThis.WebSocket;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    const pending = new Map();
    const timer = setTimeout(() => { ws.close(); reject(new Error('WS timeout')); }, 10000);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++msgId;
            const t = setTimeout(() => { pending.delete(id); rej(new Error(`Timeout: ${method}`)); }, 10000);
            pending.set(id, { resolve: res, reject: rej, timeout: t });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { ws.close(); }
      });
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej, timeout: t } = pending.get(msg.id);
        clearTimeout(t);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };

    ws.onerror = (err) => { clearTimeout(timer); reject(err); };
    ws.onclose = () => {
      clearTimeout(timer);
      for (const { reject: rej, timeout: t } of pending.values()) { clearTimeout(t); rej(new Error('WS closed')); }
      pending.clear();
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--test') flags.test = args[++i];
    else if (args[i] === '--tab') flags.tab = args[++i];
    else if (args[i] === '--port') flags.port = parseInt(args[++i], 10);
    else if (args[i] === '--host') flags.host = args[++i];
  }

  if (!flags.test) {
    console.error('Usage: node CaptureVerification.js --test <test.json> --tab <alias> --port 9222');
    console.log('null');
    process.exit(1);
  }

  const host = flags.host || 'localhost';
  const port = flags.port || 9222;

  try {
    const testDef = JSON.parse(fs.readFileSync(flags.test, 'utf8'));
    const milestones = testDef.milestones || [];

    if (milestones.length === 0) {
      console.log('null');
      process.exit(0);
    }

    const expression = buildCaptureExpression(milestones);
    const targetId = flags.tab ? resolveTabAlias(flags.tab) : null;
    const target = await findTarget(host, port, targetId);
    const session = await connectCDP(target.webSocketDebuggerUrl);

    try {
      const result = await session.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: false
      });

      if (result.exceptionDetails) {
        console.error(`Capture eval error: ${result.exceptionDetails.text}`);
        console.log('null');
        process.exit(0);
      }

      console.log(JSON.stringify(result.result.value));
    } finally {
      session.close();
    }
  } catch (err) {
    console.error(`Capture failed: ${err.message}`);
    console.log('null');
    process.exit(0);
  }
}

main();
