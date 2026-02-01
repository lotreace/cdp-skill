---
id: vue-examples
name: Vue.js Examples Playground
category: spa
site: https://vuejs.org/examples/

goal: |
  Navigate Vue.js examples, view different demos, and interact with components.

success_criteria:
  - Examples page loaded with demo list
  - Successfully interacted with at least 2 different examples

milestones:
  - id: page_loaded
    description: Vue.js examples page loaded
    weight: 0.1
  - id: example_selected
    description: Selected an example from the list
    weight: 0.2
  - id: first_interaction
    description: Interacted with the first example successfully
    weight: 0.35
  - id: second_example
    description: Navigated to and interacted with a second example
    weight: 0.35

constraints:
  max_steps: 30
  max_time_ms: 90000
  max_retries: 2

improvement_focus: [navigation, actions, observations]
tags: [vue, reactive, code-examples]
difficulty: medium
version: 1
---

# Vue.js Examples Playground Test

## Site Information

The Vue.js examples page showcases various Vue features through interactive demos. Each example demonstrates a different concept with live, editable code.

## Test Steps

1. Navigate to vuejs.org/examples/
2. View the list of available examples
3. Click an example to view it (e.g., "Hello World" or "Counter")
4. Interact with the demo (click buttons, type input, etc.)
5. Navigate to a different example
6. Interact with that demo

## Available Examples

The page lists many examples including:
- **Hello World**: Basic Vue app
- **Counter**: Click to increment
- **Form Binding**: Two-way data binding
- **Grid**: Sortable/filterable table
- **Tree View**: Nested list with expand/collapse
- **Markdown**: Live markdown preview
- **Todo List**: Full todo application

## Page Structure

- **Left Sidebar**: List of example names
- **Main Area**: Code editor and live preview
- **Preview Pane**: Interactive demo output

## Suggested Examples

For this test, choose from these simpler examples:
1. **Counter**: Just a button to click
2. **Form Binding**: Input fields with live updates
3. **Grid**: Table with sorting and filtering

## Interaction Patterns

Each example has different interactions:
- Counter: Click button to increment
- Form Binding: Type in input, see changes reflected
- Grid: Click headers to sort, type in search
- Tree: Click to expand/collapse nodes

## Notes for Agent

- The sidebar scrolls if many examples
- Code editor is editable but changes aren't needed for test
- Preview updates automatically when example changes
- Some examples may have loading states
- Use snapshot to identify interactive elements in preview
- Focus on completing interactions, not reading all code
