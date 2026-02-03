/**
 * Dynamic Step Executors
 * Agent-generated JS execution, polling, pipelines, and site manifest management
 *
 * EXPORTS:
 * - executePageFunction(pageController, params) → Promise<Object>
 * - executePoll(pageController, params) → Promise<Object>
 * - executePipeline(pageController, params) → Promise<Object>
 * - compilePipeline(steps) → string
 * - executeWriteSiteManifest(params) → Promise<Object>
 * - loadSiteManifest(domain) → Promise<string|null>
 * - runLightAutoFit(pageController, url) → Promise<Object|null>
 * - LIGHT_FIT_SCRIPT → string
 * - generateLightManifest(domain, detection) → string
 *
 * DEPENDENCIES:
 * - ../capture/eval-serializer.js: createEvalSerializer
 * - ../utils.js: sleep
 */

import { createEvalSerializer } from '../capture/index.js';
import { sleep } from '../utils.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SITES_DIR = path.join(os.homedir(), '.cdp-skill', 'sites');

function getSerializationWrapper() {
  const serializer = createEvalSerializer();
  return serializer.getSerializationFunction();
}

function processSerializedResult(raw) {
  if (raw && typeof raw === 'object' && raw.type) {
    const serializer = createEvalSerializer();
    return serializer.processResult(raw);
  }
  return { type: typeof raw, value: raw };
}

// ---------------------------------------------------------------------------
// pageFunction
// ---------------------------------------------------------------------------

/**
 * Execute agent-generated JavaScript in the browser.
 *
 * @param {Object} pageController - page controller with evaluateInFrame
 * @param {string|Object} params - function string or {fn, refs, timeout}
 * @returns {Promise<Object>} serialized return value
 */
export async function executePageFunction(pageController, params) {
  const fn = typeof params === 'string' ? params : params.fn;
  const useRefs = typeof params === 'object' && params.refs === true;
  const timeout = typeof params === 'object' && typeof params.timeout === 'number'
    ? params.timeout : null;

  if (!fn || typeof fn !== 'string') {
    throw new Error('pageFunction requires a non-empty function string');
  }

  const arg = useRefs ? 'window.__ariaRefs' : '';
  const serializerFn = getSerializationWrapper();

  // Wrap the agent function so its return value is serialized
  const wrapped = `(function() {
  const __fn = ${fn};
  const __serialize = ${serializerFn};
  const __result = __fn(${arg});
  return __serialize(__result);
})()`;

  const evalPromise = pageController.evaluateInFrame(wrapped, {
    returnByValue: true,
    awaitPromise: false
  });

  let result;
  if (timeout !== null && timeout > 0) {
    let tid;
    const tp = new Promise((_, reject) => {
      tid = setTimeout(() => reject(new Error(`pageFunction timed out after ${timeout}ms`)), timeout);
    });
    result = await Promise.race([evalPromise, tp]);
    clearTimeout(tid);
  } else {
    result = await evalPromise;
  }

  if (result.exceptionDetails) {
    const errorText = result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text || 'Unknown error';
    throw new Error(`pageFunction error: ${errorText}\nSource: ${fn.substring(0, 200)}`);
  }

  return processSerializedResult(result.result.value);
}

// ---------------------------------------------------------------------------
// poll
// ---------------------------------------------------------------------------

/**
 * Poll a predicate function in the browser until truthy or timeout.
 *
 * @param {Object} pageController
 * @param {string|Object} params - predicate string or {fn, interval, timeout}
 * @returns {Promise<Object>} {resolved, value, elapsed} or {resolved:false, elapsed, lastValue}
 */
export async function executePoll(pageController, params) {
  const fn = typeof params === 'string' ? params : params.fn;
  const interval = (typeof params === 'object' && typeof params.interval === 'number')
    ? params.interval : 100;
  const timeout = (typeof params === 'object' && typeof params.timeout === 'number')
    ? params.timeout : 30000;

  if (!fn || typeof fn !== 'string') {
    throw new Error('poll requires a non-empty function string');
  }

  const serializerFn = getSerializationWrapper();
  const expression = `(function() {
  const __fn = ${fn};
  const __serialize = ${serializerFn};
  return __serialize(__fn());
})()`;

  const start = Date.now();
  let lastValue = null;

  while (true) {
    const result = await pageController.evaluateInFrame(expression, {
      returnByValue: true,
      awaitPromise: false
    });

    if (result.exceptionDetails) {
      const errorText = result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text || 'Unknown error';
      throw new Error(`poll error: ${errorText}\nSource: ${fn.substring(0, 200)}`);
    }

    const processed = processSerializedResult(result.result.value);
    lastValue = processed;

    // Check truthiness from the raw value (before serialization wrapping)
    const rawVal = result.result.value;
    const isTruthy = rawVal !== null && rawVal !== undefined &&
      rawVal !== false && rawVal !== 0 && rawVal !== '' &&
      !(typeof rawVal === 'object' && rawVal.type === 'null') &&
      !(typeof rawVal === 'object' && rawVal.type === 'undefined') &&
      !(typeof rawVal === 'object' && rawVal.type === 'boolean' && rawVal.value === false) &&
      !(typeof rawVal === 'object' && rawVal.type === 'number' && rawVal.value === 0) &&
      !(typeof rawVal === 'object' && rawVal.type === 'string' && rawVal.value === '');

    if (isTruthy) {
      return { resolved: true, value: processed, elapsed: Date.now() - start };
    }

    const elapsed = Date.now() - start;
    if (elapsed >= timeout) {
      return { resolved: false, elapsed, lastValue };
    }

    await sleep(Math.min(interval, timeout - elapsed));
  }
}

// ---------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------

/**
 * Compile an array of micro-operations into a single async JS function string.
 *
 * @param {Array<Object>} steps - pipeline micro-ops
 * @returns {string} self-executing async function
 */
export function compilePipeline(steps) {
  const blocks = steps.map((op, idx) => {
    // find + fill
    if (op.find && op.fill !== undefined) {
      return `{
  const el = document.querySelector(${JSON.stringify(op.find)});
  if (!el) throw {step:${idx}, error:'not found: ${op.find.replace(/'/g, "\\'")}'};
  const nativeSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el).constructor === HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    'value'
  );
  if (nativeSetter && nativeSetter.set) {
    nativeSetter.set.call(el, ${JSON.stringify(String(op.fill))});
  } else {
    el.value = ${JSON.stringify(String(op.fill))};
  }
  el.dispatchEvent(new Event('input', {bubbles:true}));
  el.dispatchEvent(new Event('change', {bubbles:true}));
  results.push({ok:true});
}`;
    }

    // find + click
    if (op.find && op.click === true) {
      return `{
  const el = document.querySelector(${JSON.stringify(op.find)});
  if (!el) throw {step:${idx}, error:'not found: ${op.find.replace(/'/g, "\\'")}'};
  el.click();
  results.push({ok:true});
}`;
    }

    // find + type (character-by-character key events)
    if (op.find && op.type !== undefined) {
      return `{
  const el = document.querySelector(${JSON.stringify(op.find)});
  if (!el) throw {step:${idx}, error:'not found: ${op.find.replace(/'/g, "\\'")}'};
  el.focus();
  for (const ch of ${JSON.stringify(String(op.type))}) {
    el.dispatchEvent(new KeyboardEvent('keydown', {key:ch, bubbles:true}));
    el.dispatchEvent(new KeyboardEvent('keypress', {key:ch, bubbles:true}));
    el.value += ch;
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new KeyboardEvent('keyup', {key:ch, bubbles:true}));
  }
  el.dispatchEvent(new Event('change', {bubbles:true}));
  results.push({ok:true});
}`;
    }

    // find + check
    if (op.find && op.check !== undefined) {
      return `{
  const el = document.querySelector(${JSON.stringify(op.find)});
  if (!el) throw {step:${idx}, error:'not found: ${op.find.replace(/'/g, "\\'")}'};
  el.checked = ${!!op.check};
  el.dispatchEvent(new Event('input', {bubbles:true}));
  el.dispatchEvent(new Event('change', {bubbles:true}));
  results.push({ok:true});
}`;
    }

    // find + select
    if (op.find && op.select !== undefined) {
      return `{
  const el = document.querySelector(${JSON.stringify(op.find)});
  if (!el) throw {step:${idx}, error:'not found: ${op.find.replace(/'/g, "\\'")}'};
  el.value = ${JSON.stringify(String(op.select))};
  el.dispatchEvent(new Event('input', {bubbles:true}));
  el.dispatchEvent(new Event('change', {bubbles:true}));
  results.push({ok:true});
}`;
    }

    // waitFor
    if (op.waitFor) {
      const waitTimeout = op.timeout || 10000;
      return `{
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject({step:${idx}, error:'waitFor timeout after ${waitTimeout}ms'}), ${waitTimeout});
    const i = setInterval(() => {
      try {
        if ((${op.waitFor})()) { clearInterval(i); clearTimeout(t); resolve(); }
      } catch(e) { clearInterval(i); clearTimeout(t); reject({step:${idx}, error:e.message}); }
    }, 100);
    try {
      if ((${op.waitFor})()) { clearInterval(i); clearTimeout(t); resolve(); }
    } catch(e) { clearInterval(i); clearTimeout(t); reject({step:${idx}, error:e.message}); }
  });
  results.push({ok:true});
}`;
    }

    // sleep
    if (op.sleep !== undefined) {
      return `{
  await new Promise(r => setTimeout(r, ${Number(op.sleep) || 0}));
  results.push({ok:true});
}`;
    }

    // return
    if (op.return) {
      return `{
  const val = (${op.return})();
  results.push({ok:true, value:val});
}`;
    }

    throw new Error(`pipeline step ${idx}: unrecognized micro-op: ${JSON.stringify(op)}`);
  });

  return `(async function() {
  const results = [];
  try {
    ${blocks.join('\n    ')}
    return {completed:true, steps:results.length, results};
  } catch(e) {
    if (e && typeof e.step === 'number') {
      return {completed:false, failedAt:e.step, error:e.error, results};
    }
    return {completed:false, failedAt:results.length, error:e.message || String(e), results};
  }
})()`;
}

/**
 * Compile and execute a pipeline of micro-operations in the browser.
 *
 * @param {Object} pageController
 * @param {Array<Object>|Object} params - array of micro-ops, or {steps, timeout}
 * @returns {Promise<Object>}
 */
export async function executePipeline(pageController, params) {
  const steps = Array.isArray(params) ? params : params.steps;
  const timeout = (!Array.isArray(params) && typeof params.timeout === 'number')
    ? params.timeout : 30000;

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('pipeline requires a non-empty array of micro-operations');
  }

  const compiled = compilePipeline(steps);

  const evalPromise = pageController.evaluateInFrame(compiled, {
    returnByValue: true,
    awaitPromise: true
  });

  let result;
  if (timeout > 0) {
    let tid;
    const tp = new Promise((_, reject) => {
      tid = setTimeout(() => reject(new Error(`pipeline timed out after ${timeout}ms`)), timeout);
    });
    result = await Promise.race([evalPromise, tp]);
    clearTimeout(tid);
  } else {
    result = await evalPromise;
  }

  if (result.exceptionDetails) {
    const errorText = result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text || 'Unknown error';
    throw new Error(`pipeline error: ${errorText}`);
  }

  return result.result.value || { completed: false, error: 'no result' };
}

// ---------------------------------------------------------------------------
// Site Manifests
// ---------------------------------------------------------------------------

/**
 * Ensure the sites directory exists.
 */
async function ensureSitesDir() {
  await fs.mkdir(SITES_DIR, { recursive: true });
}

/**
 * Sanitize domain for use as a filename.
 */
function sanitizeDomain(domain) {
  return domain.replace(/^www\./, '').replace(/[^a-zA-Z0-9.\-]/g, '_');
}

/**
 * Load a site manifest for the given domain.
 *
 * @param {string} domain - hostname (e.g. "github.com")
 * @returns {Promise<string|null>} manifest markdown or null
 */
export async function loadSiteManifest(domain) {
  const clean = sanitizeDomain(domain);
  const manifestPath = path.join(SITES_DIR, `${clean}.md`);
  try {
    return await fs.readFile(manifestPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Write or update a site manifest.
 *
 * @param {Object} params - {domain, content}
 * @returns {Promise<Object>} {written, path}
 */
export async function executeWriteSiteManifest(params) {
  if (!params || !params.domain || !params.content) {
    throw new Error('writeSiteManifest requires domain and content');
  }

  const clean = sanitizeDomain(params.domain);
  await ensureSitesDir();
  const manifestPath = path.join(SITES_DIR, `${clean}.md`);
  await fs.writeFile(manifestPath, params.content, 'utf8');

  return { written: true, path: manifestPath, domain: params.domain };
}

// ---------------------------------------------------------------------------
// Light Auto-Fit
// ---------------------------------------------------------------------------

/**
 * Detection script run in browser on first visit to an unknown domain.
 */
export const LIGHT_FIT_SCRIPT = `() => {
  const detect = {};
  if (window.React || window.__REACT_DEVTOOLS_GLOBAL_HOOK__) detect.react = true;
  if (window.__NEXT_DATA__) detect.nextjs = true;
  if (window.Vue || window.__VUE__) detect.vue = true;
  if (window.ng || window.getAllAngularRootElements) detect.angular = true;
  if (window.__svelte || window.__SVELTE_HMR) detect.svelte = true;
  if (window.jQuery || window.$?.fn?.jquery) detect.jquery = true;
  if (window.Turbo || window.Turbolinks) detect.turbo = true;
  if (window.htmx) detect.htmx = true;
  if (window.__NUXT__) detect.nuxt = true;
  if (window.__remixContext) detect.remix = true;

  const main = document.querySelector('main, [role="main"]');
  detect.hasMain = !!main;
  detect.mainSelector = main ? (main.id ? '#' + main.id : main.tagName.toLowerCase()) : null;

  detect.usesPushState = !!window.history.pushState;
  detect.hasServiceWorker = !!navigator.serviceWorker?.controller;

  detect.title = document.title;
  detect.metaGenerator = document.querySelector('meta[name="generator"]')?.content || null;
  detect.bodyChildCount = document.body?.children.length || 0;
  detect.interactiveCount = document.querySelectorAll('a,button,input,select,textarea').length;

  return detect;
}`;

/**
 * Generate a light manifest markdown from detection results.
 *
 * @param {string} domain
 * @param {Object} detection
 * @returns {string} markdown content
 */
export function generateLightManifest(domain, detection) {
  const frameworks = [];
  if (detection.react) frameworks.push('React');
  if (detection.nextjs) frameworks.push('Next.js');
  if (detection.vue) frameworks.push('Vue');
  if (detection.nuxt) frameworks.push('Nuxt');
  if (detection.angular) frameworks.push('Angular');
  if (detection.svelte) frameworks.push('Svelte');
  if (detection.jquery) frameworks.push('jQuery');
  if (detection.turbo) frameworks.push('Turbo');
  if (detection.htmx) frameworks.push('htmx');
  if (detection.remix) frameworks.push('Remix');

  const date = new Date().toISOString().split('T')[0];
  const fingerprint = `bc${detection.bodyChildCount}-ic${detection.interactiveCount}`;

  let md = `# ${domain}\nFitted: ${date} (light)  |  Fingerprint: ${fingerprint}\n\n`;

  md += '## Environment\n';
  if (frameworks.length > 0) {
    md += `- Frameworks: ${frameworks.join(', ')}\n`;
  } else {
    md += '- No major framework detected\n';
  }

  if (detection.usesPushState) md += '- SPA with pushState navigation\n';
  if (detection.hasServiceWorker) md += '- Service Worker active\n';
  if (detection.metaGenerator) md += `- Generator: ${detection.metaGenerator}\n`;

  md += '\n## Regions\n';
  if (detection.hasMain) {
    md += `- mainContent: \`${detection.mainSelector}\`\n`;
  } else {
    md += '- No <main> or [role="main"] detected\n';
  }

  md += '\n## Notes\nLight fit only. Run full fit for strategies and recipes.\n';

  return md;
}

/**
 * Run light auto-fit for a URL. Returns detection info if manifest was created,
 * or null if a manifest already existed.
 *
 * @param {Object} pageController
 * @param {string} url - the navigated URL
 * @returns {Promise<Object|null>} {domain, level, frameworks} or null
 */
export async function runLightAutoFit(pageController, url) {
  let domain;
  try {
    domain = sanitizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }

  const existing = await loadSiteManifest(domain);
  if (existing) return null;

  // Run detection in browser
  const expression = `(${LIGHT_FIT_SCRIPT})()`;
  const result = await pageController.evaluateInFrame(expression, {
    returnByValue: true,
    awaitPromise: false
  });

  if (result.exceptionDetails || !result.result.value) {
    return null;
  }

  const detection = result.result.value;
  const manifest = generateLightManifest(domain, detection);

  await ensureSitesDir();
  const manifestPath = path.join(SITES_DIR, `${domain}.md`);
  await fs.writeFile(manifestPath, manifest, 'utf8');

  const frameworks = [];
  for (const key of ['react', 'nextjs', 'vue', 'nuxt', 'angular', 'svelte', 'jquery', 'turbo', 'htmx', 'remix']) {
    if (detection[key]) frameworks.push(key);
  }

  return { domain, level: 'light', frameworks };
}
