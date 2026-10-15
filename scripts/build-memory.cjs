const started = Date.now();
const mb = value => Math.round(value / 1024 / 1024);
function report(label) {
  const { rss, heapUsed } = process.memoryUsage();
  console.error(`[memory] pid=${process.pid} ${label} elapsed=${Math.round((Date.now()-started)/1000)}s rss=${mb(rss)}MiB heap=${mb(heapUsed)}MiB`);
}
report('start');
setInterval(() => report('running'), 15000).unref();
process.once('exit', () => {
  console.error(`[memory] pid=${process.pid} maxRSS=${Math.round(process.resourceUsage().maxRSS/1024)}MiB`);
});
