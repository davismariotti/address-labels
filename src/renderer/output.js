/* Hidden Letter-size window: renders the same layout data at 1 inch = 1in for printing. */
(async function () {
  const id = new URLSearchParams(location.search).get('id');
  const job = await window.api.outputData(id);
  const root = document.getElementById('sheets');
  if (job) {
    const result = Shared.layout(job.labels, job.startCell, job.nudge);
    for (const sheet of result.sheets) {
      root.appendChild(renderSheet(sheet, { ppi: '1in', outlines: !!job.outlines, interactive: false }));
    }
  }
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  window.api.outputReady(id);
})();
