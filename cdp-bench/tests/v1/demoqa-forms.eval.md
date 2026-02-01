---
id: demoqa-forms
name: DemoQA Practice Forms
category: forms
site: https://demoqa.com/automation-practice-form

goal: |
  Complete the practice form on DemoQA including text inputs, radio buttons,
  checkboxes, date picker, and file upload.

success_criteria:
  - Form submitted successfully
  - Confirmation modal shows entered data

milestones:
  - id: form_loaded
    description: Practice form page loaded with all fields visible
    weight: 0.1
  - id: text_inputs_filled
    description: Name and email fields filled
    weight: 0.2
  - id: selections_made
    description: Gender radio and hobbies checkboxes selected
    weight: 0.25
  - id: date_selected
    description: Date of birth selected via date picker
    weight: 0.2
  - id: form_submitted
    description: Form submitted and confirmation modal appeared
    weight: 0.25

constraints:
  max_steps: 30
  max_time_ms: 90000
  max_retries: 2

improvement_focus: [actions, selectors, waits]
tags: [datepicker, checkboxes, radio-buttons, file-upload]
difficulty: medium
version: 1
---

# DemoQA Practice Forms Test

## Site Information

DemoQA is a practice site for test automation with various form elements and widgets. The practice form tests common input types.

## Form Fields

1. **Text Inputs**
   - First Name (required)
   - Last Name (required)
   - Email
   - Mobile Number (10 digits)
   - Current Address (textarea)

2. **Radio Buttons**
   - Gender: Male / Female / Other (required)

3. **Checkboxes**
   - Hobbies: Sports / Reading / Music

4. **Date Picker**
   - Date of Birth (calendar widget)

5. **Dropdowns**
   - Subject (autocomplete multi-select)
   - State (dropdown)
   - City (dropdown, depends on State)

6. **File Upload**
   - Picture upload

## Test Data

Use realistic test data:
- First Name: "John"
- Last Name: "Doe"
- Email: "john.doe@example.com"
- Mobile: "1234567890"
- Gender: Male
- Date of Birth: Select any past date
- Hobbies: Sports, Reading
- Address: "123 Test Street"

## Date Picker Interaction

The date picker opens a calendar widget:
- Click the date field to open
- Navigate months with arrows
- Click a date to select
- Or type directly in the field

## Notes for Agent

- The page has ads that may cover form elements - scroll to ensure visibility
- Date picker requires clicking into the calendar widget
- Subject field uses autocomplete - type and select from suggestions
- File upload is optional for this test
- Submit button may need scrolling to view
- Success is indicated by a modal with the entered data
