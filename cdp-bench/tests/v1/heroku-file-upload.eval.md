---
id: heroku-file-upload
name: The Internet - File Upload
category: forms
site: https://the-internet.herokuapp.com/upload

goal: |
  Test file upload functionality by selecting a file from the local filesystem,
  uploading it to the server, and verifying successful upload confirmation.

success_criteria:
  - File selected and displayed in upload form
  - File successfully uploaded to server
  - Upload confirmation page shows the uploaded filename

milestones:
  - id: page_loaded
    description: File upload page loaded with upload form visible
    weight: 0.1
  - id: file_selected
    description: File selected from filesystem and displayed in form
    weight: 0.3
  - id: upload_submitted
    description: Upload form submitted successfully
    weight: 0.3
  - id: upload_confirmed
    description: Confirmation page displays with uploaded filename
    weight: 0.3

constraints:
  max_steps: 15
  max_time_ms: 60000
  max_retries: 2

improvement_focus: [file-upload, input-handling, form-submission]
tags: [file-upload, forms, input-file, html5]
difficulty: medium
version: 1
---

# The Internet - File Upload Test

## Site Information

"The Internet" (the-internet.herokuapp.com) is a collection of test automation practice pages created by Dave Haeffner. The file upload page tests browser automation's ability to interact with HTML file input elements and manage file selection from the local filesystem.

## Test Steps

1. Navigate to the file upload page
2. Identify the file input element on the page
3. Create or use a temporary test file (e.g., a simple text file or image)
4. Select the file using the file input
5. Verify the filename appears in the form (either in the input or a display area)
6. Submit the upload form by clicking the "Upload" button
7. Verify the confirmation page appears with the filename displayed
8. The confirmation page should show: "File Uploaded!"
9. The filename should be visible on the confirmation page

## Page Elements

- Upload input: `#file-upload` (HTML file input element)
- Upload button: `#file-submit` or `button[type="submit"]`
- Filename display area: Usually shown as uploaded filename on confirmation page
- Confirmation heading: "File Uploaded!" message

## File Upload Methods

### Method 1: Direct File Input (Recommended)
- Interact with the `<input type="file">` element
- Use CDP's Input.setFileInputFiles method to set the file path
- This bypasses browser file picker restrictions

### Method 2: File Picker (Not Recommended)
- Some tools attempt to interact with the native file picker
- This is generally unreliable and not recommended for automation

## Test File

For this test, use a simple test file such as:
- A small text file (content doesn't matter)
- An image file (.png, .jpg)
- A CSV or JSON file
- Any file that can be created as a temporary file

The test infrastructure should handle creating a temporary test file in the system temp directory.

## Verification

After upload:
- Page should redirect to a confirmation page (typically `/upload` POST response)
- Confirmation page should display:
  - "File Uploaded!" heading
  - The uploaded filename in some form
- Use snapshot to verify the final state

## Notes for Agent

- File upload is challenging in browser automation due to security restrictions
- The HTTP file upload restriction prevents direct file picker access from JavaScript
- CDP's approach using Input.setFileInputFiles is the standard way to handle this
- The test file path must be accessible to the browser/CDP process
- The file should be created in the system temp directory for reliability
- After form submission, allow time for page navigation to complete
- The confirmation page shows the filename, which proves successful upload
- No authentication required for this page
- The page uses simple HTML form - straightforward DOM structure

## Implementation Notes

To implement file upload in the skill:
1. Create a temporary test file (e.g., in /tmp or system temp)
2. Get the file path
3. Use CDP's Input.setFileInputFiles to populate the file input
4. Submit the form
5. Wait for the confirmation page to load
6. Verify the filename appears on confirmation page

Example CDP call (JavaScript):
```javascript
// First, get the file input element
const fileInput = document.querySelector('#file-upload');

// Then set the files using CDP
await cdp.Input.setFileInputFiles({
  files: ['/path/to/test/file.txt'],
  objectId: fileInputObjectId
});
```

Alternatively, some automation tools allow:
```javascript
// Direct property assignment (if CDP supports)
fileInput.files = fileList; // Less reliable
```

## Difficulty Rationale

- **Medium difficulty** because:
  - Requires handling file system operations (creating test file)
  - File upload is a complex interaction with security implications
  - Not all automation approaches work reliably
  - Requires verification of results on confirmation page
- **Not hard** because:
  - Site is simple and straightforward
  - No authentication or complex state management
  - Clear success criteria with visible confirmation
