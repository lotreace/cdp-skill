# Test 7: PDF Generation

## Objective
Test PDF generation with various options.

## Steps

1. Navigate to https://www.wikipedia.org
2. Wait for page to fully load
3. Generate a PDF with default settings
4. Verify the PDF file was created
5. Navigate to a longer article (e.g., Albert Einstein)
6. Generate a PDF with custom options:
   - landscape: true
   - printBackground: true
   - scale: 0.8
7. Verify second PDF was created
8. Compare file sizes to confirm different options were applied

## Expected Results
- PDF files should be created at specified paths
- Output should include the absolute path to the file
- Different options should produce different PDFs
- Landscape PDF should have different dimensions

## Feature Requests to Note
- FR-059: Include PDF metadata in output (file size, page count)
- FR-060: PDF from specific element selector
- FR-061: PDF validation option
