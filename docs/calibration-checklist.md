# Manual calibration checklist (Avery 5260)

Automated tests prove the PDF is Letter size and every label sits inside its cell. They can't check
the printer, so do this once per printer, and again if labels drift.

You need: a plain sheet of paper, one real 5260 label sheet (or a partly used one), and good light.

## 1. Check the geometry against a real sheet
1. In the app, check a few people and choose **Print Labels…**.
2. Turn on **Show label outlines** and choose **Print…** on **plain paper** (not a label sheet).
   - In the macOS print dialog, set **Scale 100%** and turn off any "Fit to page" / headers and footers.
3. Hold the printout against a real 5260 sheet in front of a window or lamp.
4. Look at the top-left, top-right, bottom-left and bottom-right labels. The printed outlines should
   sit on the die-cut edges.

## 2. Set the nudge
- Open **Alignment** in the dialog (⌘⌥A). Positive values move the print right and down.
- Measure the gap, enter it (in inches, −0.25 to 0.25), and repeat step 1 until the four corners line up.
- Recorded values: x = ______  y = ______  (printer: __________________)

If the error grows from one side of the page to the other, the printer is scaling the page.
Re-check that scale is 100% before nudging. A nudge cannot fix scaling.

Note: the grid in `src/shared/geometry.js` was measured from Avery's own PDF template (0.5 in top,
0.1875 in left, 2.75 x 1.0 in pitch), so a consistent offset here is the printer's feed, not the
layout. Fix it with the nudge. If a different brand of 30-up sheet is slightly different, remeasure it
with `scripts/measure-avery-template.py` and update `test/golden/geometry.json`.

## 3. Partly used sheet
1. Take a sheet with the first 13 labels removed.
2. Check about 20 people, choose **Print Labels…**, set **Start at cell** to 14 (row 5, column 2).
3. Print on that sheet. Labels should land only on the remaining cells, with no overlap on the
   empty (peeled) ones.
4. Note whether your printer pulls a partly used sheet cleanly. Avery's guarantee only covers a
   single pass through a laser printer.

## 4. Content
1. Print the full list (**Select all**) to PDF with **Save as PDF…** and compare against
   `Holiday Cards.pdf` for names and addresses.
2. Check the 4-line label (Bea and Jo) and the long international ones (Freedonia, Metropolis) are
   fully readable and not clipped.

## 5. Projects and print tracking
Do this on a real printer once. The automated tests stand in for the system print dialog, so only you can
check that the real hand-off is recorded.
1. Open a project, select a few people, and **Print Labels… ▸ Print…** on a real sheet. Confirm the toast
   ("Sent N labels to the printer…"), that the chips change to **Printed**, and that the footer shows
   "Last print… Review…".
2. Print again but **cancel** in the macOS print dialog. Confirm nothing is recorded (no toast, chips unchanged).
3. Cause a deliberate jam, or just peel a label off, and mark that person **Didn't come out** from
   **Review…** (or right-click ▸ Didn't come out). Confirm only that person reverts, then reprint them.
4. Change an address after a run (They moved, then Fix a typo on another person) and confirm both show
   **Address changed**. Use **⋯ ▸ Select needs printing** and reprint just those.
5. **Save as PDF…**, print it from Preview, and use **⋯ ▸ I printed these myself**. Confirm the PDF alone did not
   mark anyone.

## 6. Packaged app
Open the built `.app` (see README) and confirm it finds your data and prints.

Sign-off: date __________  by __________
