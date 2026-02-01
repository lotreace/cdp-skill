---
id: todomvc-react
name: TodoMVC React App
category: spa
site: https://todomvc.com/examples/react/dist/

goal: |
  Use the React TodoMVC app to add, complete, filter, and delete todos.

success_criteria:
  - Added multiple todo items
  - Marked items as complete and used filters

milestones:
  - id: app_loaded
    description: TodoMVC React app loaded with input visible
    weight: 0.1
  - id: todos_added
    description: Added at least 2 todo items to the list
    weight: 0.25
  - id: todo_completed
    description: Marked a todo as complete (checked)
    weight: 0.25
  - id: filter_used
    description: Used filter buttons (All, Active, Completed)
    weight: 0.2
  - id: todo_deleted
    description: Deleted a todo item
    weight: 0.2

constraints:
  max_steps: 25
  max_time_ms: 60000
  max_retries: 2

improvement_focus: [actions, waits, selectors]
tags: [react, local-storage, keyboard-interaction]
difficulty: easy
version: 1
---

# TodoMVC React App Test

## Site Information

TodoMVC is a project comparing frontend frameworks using a standard todo app specification. The React implementation tests single-page app interactions with state management.

## Test Steps

1. Navigate to TodoMVC React example
2. Click the "What needs to be done?" input
3. Type a todo item and press Enter
4. Add a second todo item
5. Click the checkbox to mark one item complete
6. Click filter buttons to view Active/Completed items
7. Hover over a todo and click the X to delete it

## App Structure

- **Header**: Input field for new todos
- **Main**: List of todo items with checkboxes
- **Footer**: Item count, filter buttons, "Clear completed"

## Interactions

- **Adding**: Type in input, press Enter
- **Completing**: Click checkbox on left of item
- **Deleting**: Hover to reveal X button, click to delete
- **Filtering**: Click "All", "Active", or "Completed"
- **Editing**: Double-click text to edit (optional)
- **Clear**: "Clear completed" removes all checked items

## State Persistence

- TodoMVC uses localStorage to persist todos
- Todos survive page refresh
- State is managed by React

## Notes for Agent

- Input requires focus before typing
- Delete button only appears on hover
- Completed items show with strikethrough
- Filter buttons are links in the footer
- Use `react: true` for fill operations if needed
- The app is simple and predictable
