# CDP Browser Automation Skill

A lightweight, zero-dependency browser automation library using Chrome DevTools Protocol (CDP). Designed for AI agents like Claude Code to control Chrome through simple JSON commands.

## Why CDP Skill?

- **Zero dependencies** - Pure Node.js, no Playwright/Puppeteer overhead
- **AI-agent optimized** - JSON in, JSON out; designed for LLM tool use
- **Auto-launch Chrome** - Detects and starts Chrome automatically on macOS, Linux, Windows
- **Accessibility-first** - ARIA snapshots with element refs for resilient automation
- **Battle-tested** - 600+ unit tests

## Quick Start

```bash
# Check Chrome status (auto-launches if needed)
node src/cdp-skill.js '{"steps":[{"chromeStatus":true}]}'

# Navigate to a page
node src/cdp-skill.js '{"steps":[{"goto":"https://google.com"}]}'
```

## Features

### Chrome Management
- **Auto-launch** - Detects Chrome path on macOS/Linux/Windows, launches with remote debugging
- **Status check** - `chromeStatus` step reports running state, version, and open tabs
- **Multi-agent safe** - Multiple agents can share Chrome; each manages their own tabs
- **Headless support** - Run Chrome without UI via `{"chromeStatus":{"headless":true}}`

### Navigation
- **URL navigation** - `goto`, `back`, `forward`
- **Wait conditions** - Network idle, DOM ready, element visible, text appears, URL changes
- **Navigation detection** - Automatic navigation tracking after clicks

### Element Interaction
- **Click** - CSS selectors, ARIA refs, or x/y coordinates
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

### Accessibility & Queries
- **ARIA snapshots** - Get accessibility tree as YAML with clickable refs
- **Role queries** - Find elements by ARIA role (`button`, `textbox`, `link`, etc.)
- **CSS queries** - Traditional selector-based queries
- **Multi-query** - Batch multiple queries in one step
- **Page inspection** - Quick overview of page structure

### Frame Support
- **List frames** - Enumerate all iframes
- **Switch context** - Execute in iframe by selector, index, or name
- **Cross-origin detection** - Identifies cross-origin frames in snapshots

### Screenshots & PDF
- **Viewport capture** - Current view
- **Full page** - Entire scrollable area
- **Element capture** - Specific element by selector
- **PDF generation** - With metadata (page count, dimensions)
- **Temp directory** - Auto-saves to platform temp dir for relative paths

### Data Extraction
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
- **List tabs** - See all open tabs with targetId
- **Close tabs** - Clean up when done
- **Tab reuse** - Pass targetId to reuse existing tab

### Debug Mode
- **Before/after screenshots** - Capture state around each action
- **DOM snapshots** - HTML at each step
- **Output to temp dir** - Automatic cleanup-friendly location

## Documentation

- **[SKILL.md](./SKILL.md)** - Complete step reference and API documentation
- **[src/](./src/)** - Source code with JSDoc comments

## Architecture

```
src/
├── cdp-skill.js   # CLI entry point
├── cdp.js         # CDP connection, discovery, Chrome launcher
├── page.js        # Page controller, navigation, cookies
├── dom.js         # Element location, input emulation, clicks
├── aria.js        # Accessibility snapshots, role queries
├── capture.js     # Screenshots, PDF, console, network
├── runner.js      # Step validation and execution
├── utils.js       # Errors, key validation, device presets
└── index.js       # Public API exports
```

## Requirements

- Node.js 22+
- Chrome or Chromium (auto-detected)

## License

MIT
