// cPanel "Application startup file". Passenger loads the startup file with require(),
// which can't load app.js (an ES module with top-level await), so hand off via import().
import('./app.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
