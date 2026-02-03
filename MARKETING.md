# Dynamic Steps + Site Fitting: Performance

## Benchmark: Standard vs Optimized Approach

Each CDP invocation carries ~400-500ms of fixed overhead (Node.js process startup, CDP WebSocket connection, snapshot capture, screenshot). The `pageFunction` and `pipeline` step types consolidate multiple operations into a single invocation, eliminating redundant overhead cycles.

### Results (4 sites, Feb 2026)

| Site | Task | Standard | Optimized | Speedup | Reduction |
|---|---|---|---|---|---|
| **saucedemo.com** | Login + full checkout (13 steps → pipeline) | 5,290ms | 1,086ms | **4.9x** | 79% |
| **en.wikipedia.org** | Article data extraction (7 evals → pageFunction) | 4,205ms | 1,140ms | **3.7x** | 73% |
| **github.com** | Org page extraction (7 evals → pageFunction) | 4,398ms | 1,107ms | **4.0x** | 75% |
| **news.ycombinator.com** | Top stories extraction (8 evals → pageFunction) | 4,356ms | 1,159ms | **3.8x** | 73% |

### Per-call overhead breakdown

```
Standard invocation (~450ms avg):
  Node.js startup          ~80ms
  CDP WebSocket connect    ~50ms
  Step execution           ~20ms  (the actual browser work)
  Snapshot capture         ~150ms
  Screenshot capture       ~100ms
  Serialization + I/O      ~50ms

Optimized invocation:
  Same overhead — but paid once instead of 7-13 times
```

### What this means for agents

In a real agent workflow, each CDP invocation also requires an LLM reasoning turn (~2-5s). The standard saucedemo checkout would look like:

```
13 CDP calls × 450ms overhead  =  5.9s  (tool overhead)
12 LLM turns × 3s avg         = 36.0s  (reasoning overhead)
                                ------
                                 41.9s  total
```

With pipeline:

```
 2 CDP calls × 550ms overhead  =  1.1s  (tool overhead)
 1 LLM turn  × 3s avg          =  3.0s  (reasoning overhead)
                                 ------
                                  4.1s  total
```

That's a **10x end-to-end improvement** when accounting for LLM reasoning turns.

### How it works

**`pageFunction`** — Run a single JS function in the browser that does everything at once. Instead of 7 separate eval calls to extract title, sections, infobox, refs, categories, etc., one function extracts all of it in one CDP roundtrip.

**`pipeline`** — Compile a sequence of browser-side micro-ops (find, fill, click, waitFor, sleep, return) into a single async JS function. The entire saucedemo login-to-checkout flow runs as one `Runtime.evaluate` call with zero intermediate roundtrips.

**Site manifests** — Per-domain knowledge files (`~/.cdp-skill/sites/{domain}.md`) that document framework quirks, working strategies, stable selectors, and reusable recipes. The agent reads the manifest once and executes correctly on the first attempt instead of discovering site behavior through trial and error.
