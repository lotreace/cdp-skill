# Test 24: Complex Date Picker Navigation

## Objective
Test interaction with complex date picker widgets that require multi-step navigation through months/years to select a specific date.

## Steps

1. Navigate to https://www.booking.com
2. Dismiss any popups/overlays that appear
3. Find the check-in date field and click to open the date picker
4. The target date is: **March 15, 2027** (over a year from now)
5. Navigate the calendar forward:
   - Click "next month" button repeatedly OR
   - Click on month/year header to access month/year selector
6. Count how many times you need to click to reach March 2027
7. Once on March 2027, click on day 15
8. Verify the check-in date field shows "March 15, 2027" (or equivalent format)
9. Now select check-out date: **March 22, 2027**
10. Verify the date range is displayed correctly
11. Navigate to https://jqueryui.com/datepicker/
12. Switch to the iframe containing the demo
13. Click the date input to open the picker
14. Use the month/year dropdowns (if available) to jump to December 2026
15. Select December 25, 2026
16. Verify the input shows the selected date
17. Navigate to https://www.airbnb.com
18. Find the date picker for check-in
19. Navigate to select dates 6 months in the future
20. Handle any flexible dates UI that Airbnb may show
21. Complete the date selection and verify

## Expected Results
- Should be able to navigate months forward/backward
- Year transitions should work correctly
- Selected dates should populate the input fields
- Date range selection should work (start and end dates)

## Difficulty
- Date pickers vary wildly between sites (React, jQuery UI, custom)
- Some use dropdowns, some use arrow buttons, some use swipe
- Booking sites often have complex overlay UIs
- Need to handle month boundaries and year changes
- Date format varies by locale

## Notes
- Take snapshots frequently to understand the picker structure
- May need `force: true` on clicks if elements are obscured
- Consider using keyboard navigation (arrow keys, Enter)
- Watch for loading states between month transitions
