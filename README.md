# CDP Browser Automation Skill

A lightweight, zero-dependency browser automation library using Chrome DevTools Protocol (CDP). Designed for AI agents like Claude Code to control Chrome through simple JSON commands.

## Why CDP Skill?

- **Zero dependencies** - Pure Node.js, no Playwright/Puppeteer overhead
- **AI-agent optimized** - JSON in, JSON out; designed for LLM tool use
- **Auto-launch Chrome** - Detects and starts Chrome automatically on macOS, Linux, Windows
- **Accessibility-first** - ARIA snapshots with element refs for resilient automation
- **Site profiles** - Per-domain knowledge files that agents build and share across sessions
- **Battle-tested** - 1,150+ unit tests

## Quick Start

```bash
# Open a tab (Chrome auto-launches if needed)
node src/cdp-skill.js '{"steps":[{"openTab":"https://google.com"}]}'

# Use the returned tab ID for subsequent calls
node src/cdp-skill.js '{"tab":"t1","steps":[{"click":"#btn"}]}'

# Non-default Chrome (rare)
node src/cdp-skill.js '{"steps":[{"openTab":{"url":"https://google.com","port":9333,"headless":true}}]}'
```

## Features

### Site Profiles
- **Per-domain knowledge** - Agents record quirks, selectors, and strategies at `~/.cdp-skill/sites/{domain}.md`
- **Automatic prompting** - `goto`/`openTab` returns `actionRequired` for unknown sites, `siteProfile` for known ones
- **Read/write** - `readSiteProfile` and `writeSiteProfile` steps for ad-hoc profile access
- **Collaborative** - Multiple agents share and improve profiles across sessions

### Chrome Management
- **Auto-launch** - Detects Chrome path on macOS/Linux/Windows, launches with remote debugging
- **Status check** - `chromeStatus` step for diagnostics (optional — `openTab` handles launch automatically)
- **Multi-agent safe** - Multiple agents can share Chrome; each manages their own tabs
- **Headless support** - Run Chrome without UI via `{"openTab":{"url":"...","headless":true}}`

### Navigation
- **URL navigation** - `goto`, `back`, `forward`, `reload`
- **Wait conditions** - Network idle, DOM ready, element visible, text appears, URL changes
- **Navigation detection** - Automatic navigation tracking after clicks

### Element Interaction
- **Click** - CSS selectors, ARIA refs, text content, or x/y coordinates
- **Fill & Type** - Input filling with React/controlled component support
- **Keyboard** - Key presses, combos (`Control+a`, `Meta+Shift+Enter`)
- **Hover** - Mouse over with configurable duration
- **Drag & Drop** - Source to target with step interpolation
- **Select** - Text selection within inputs
- **Scroll** - To element, coordinates, or page top/bottom

### Smart Waiting (Auto-Actionability)
- **Visible** - Element in DOM with dimensions, not hidden
- **Enabled** - Not disabled or aria-disabled
- **Stable** - Position unchanged for 3 animation frames
- **Unobscured** - Not covered by overlays/modals
- **Pointer events** - CSS pointer-events not disabled
- **Auto-force** - Retries with force when actionability times out

### Action Hooks
- **readyWhen** - Poll a condition before executing the action
- **settledWhen** - Poll a condition after the action completes
- **observe** - Run a function after settlement, return value in response

### Accessibility & Queries
- **ARIA snapshots** - Get accessibility tree as YAML with clickable refs
- **Snapshot search** - Find elements by text, pattern, or role within snapshots
- **Role queries** - Find elements by ARIA role (`button`, `textbox`, `link`, etc.)
- **CSS queries** - Traditional selector-based queries
- **Multi-query** - Batch multiple queries in one step
- **Page inspection** - Quick overview of page structure
- **Coordinate discovery** - `refAt`, `elementsAt`, `elementsNear` for visual-based targeting

### Dynamic Browser Execution
- **pageFunction** - Run agent-generated JavaScript in the browser with serialized return values
- **poll** - Poll a predicate function until truthy or timeout
- **pipeline** - Compile micro-operations (find+fill, find+click, waitFor, sleep) into a single async JS function with zero roundtrips

### Frame Support
- **List frames** - Enumerate all iframes
- **Switch context** - Execute in iframe by selector, index, or name
- **Cross-origin detection** - Identifies cross-origin frames in snapshots
- **Shadow DOM** - Pierce shadow roots with `pierceShadow` option in snapshots

### Screenshots & PDF
- **Auto-capture** - Screenshots taken on every visual action
- **Full page** - Entire scrollable area
- **Element capture** - Specific element by selector
- **PDF generation** - With metadata (page count, dimensions)

### Data Extraction
- **Structured extraction** - Tables and lists with auto-detection
- **Text/HTML/attributes** - Extract content from elements
- **Console logs** - Capture browser console output
- **Cookies** - Get, set, delete with expiration support
- **JavaScript eval** - Execute code in page context with serialization

### Form Handling
- **Fill form** - Multiple fields in one step
- **Validation** - Check HTML5 constraint validation state
- **Submit** - With validation error reporting

### Assertions
- **URL checks** - Contains, equals, matches regex
- **Text presence** - Verify text on page
- **Element state** - Check element properties

### Device Emulation
- **Viewport presets** - iPhone, iPad, Pixel, Galaxy, desktop sizes
- **Custom dimensions** - Width, height, scale factor
- **Mobile mode** - Touch events, mobile user agent

### Tab Management
- **Open/close tabs** - Create and clean up tabs
- **List tabs** - See all open tabs
- **Tab reuse** - Pass tab ID to reuse existing tab across CLI invocations

## Documentation

- **[SKILL.md](./cdp-skill/SKILL.md)** - Complete step reference and API documentation
- **[EXAMPLES.md](./cdp-skill/EXAMPLES.md)** - JSON examples, response shapes, and worked patterns

## Architecture

```
src/
├── cdp-skill.js              # CLI entry point, JSON parsing, response assembly
├── aria.js                   # Accessibility snapshots, role queries
├── diff.js                   # Snapshot diffing, viewport change detection
├── utils.js                  # Errors, key validation, device presets
├── constants.js              # Shared constants
├── index.js                  # Public API exports
├── cdp/                      # CDP connection layer
│   ├── browser.js            #   Chrome launcher, path detection
│   ├── connection.js         #   WebSocket CDP connection
│   ├── discovery.js          #   Tab discovery, target filtering
│   └── target-and-session.js #   Target attachment, session management
├── page/                     # Page-level operations
│   ├── page-controller.js    #   Navigation, frame switching, eval
│   ├── cookie-manager.js     #   Cookie get/set/delete
│   ├── dom-stability.js      #   DOM mutation and stability detection
│   └── wait-utilities.js     #   Wait conditions (selector, text, URL)
├── dom/                      # Element interaction
│   ├── element-locator.js    #   CSS/ref/text element finding
│   ├── actionability.js      #   Visibility, stability, pointer-events checks
│   ├── click-executor.js     #   Click dispatch (CDP, JS, coordinate)
│   ├── fill-executor.js      #   Input filling, React support
│   ├── input-emulator.js     #   Keyboard/mouse CDP commands
│   └── element-handle.js     #   Element box model, scrolling
├── capture/                  # Output capture
│   ├── screenshot-capture.js #   Viewport and full-page screenshots
│   ├── pdf-capture.js        #   PDF generation
│   ├── console-capture.js    #   Console log capture
│   ├── eval-serializer.js    #   JS value serialization
│   └── error-aggregator.js   #   Error collection and formatting
└── runner/                   # Step orchestration
    ├── step-executors.js     #   Main step dispatch and execution
    ├── step-validator.js     #   Step definition validation
    ├── context-helpers.js    #   Step types, action context
    ├── execute-dynamic.js    #   pageFunction, poll, pipeline, site profiles
    ├── execute-interaction.js#   click, hover, drag
    ├── execute-input.js      #   fill, fillActive, selectOption
    ├── execute-navigation.js #   wait, scroll, waitForNavigation
    ├── execute-query.js      #   snapshot, query, inspect, getBox, etc.
    ├── execute-form.js       #   validate, submit, extract, assert
    └── execute-browser.js    #   eval, pdf, cookies, console, tabs
```

## Requirements

- Node.js 22+
- Chrome or Chromium (auto-detected)

## License

MIT
