---
id: datatables-demo
name: DataTables Sorting and Filtering
category: tables
site: https://datatables.net/examples/basic_init/zero_configuration.html

goal: |
  Interact with a DataTables table including sorting, searching, and pagination.

success_criteria:
  - Table loaded with data visible
  - Successfully sorted by a column and searched/filtered data

milestones:
  - id: table_loaded
    description: DataTables example loaded with data rows visible
    weight: 0.15
  - id: sorting_tested
    description: Clicked column header to sort data
    weight: 0.25
  - id: search_tested
    description: Used search box to filter table rows
    weight: 0.3
  - id: pagination_tested
    description: Navigated between pages of results
    weight: 0.3

constraints:
  max_steps: 20
  max_time_ms: 60000
  max_retries: 2

improvement_focus: [selectors, actions, observations]
tags: [datatable, sorting, filtering, pagination]
difficulty: easy
version: 1
---

# DataTables Sorting and Filtering Test

## Site Information

DataTables is a popular jQuery plugin for creating interactive HTML tables. This test uses the official demo pages to validate table interaction capabilities.

## Test Steps

1. Navigate to the DataTables zero configuration example
2. Verify table is loaded with employee data
3. Click a column header (Name, Position, etc.) to sort
4. Verify sort order changed (look for sort indicators)
5. Enter text in the search box to filter rows
6. Verify table shows filtered results
7. Click pagination controls to navigate pages
8. Verify different data rows are shown

## Table Structure

- **Search Box**: Input field labeled "Search:"
- **Column Headers**: Clickable for sorting, show arrows for sort direction
- **Data Rows**: Employee information (Name, Position, Office, Age, Start date, Salary)
- **Pagination**: Page numbers and Previous/Next buttons
- **Info Text**: Shows "Showing X to Y of Z entries"

## Search/Filter

- Search is instant (no submit button)
- Filters across all columns
- Shows matching rows only
- Info text updates to show filtered count

## Sorting

- Click column header to sort ascending
- Click again to sort descending
- Arrow icons indicate sort direction
- Only one column sorted at a time

## Notes for Agent

- DataTables uses ARIA attributes for accessibility
- Sort indicators are typically arrow icons
- Pagination updates the visible rows without page reload
- Search box may have id like `#example_filter input`
- Table itself typically has class `dataTable`
