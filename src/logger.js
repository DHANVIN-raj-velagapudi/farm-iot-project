// Minimal structured-ish logger. No external dependency — this project is
// small enough that a real logging library would be more ceremony than
// value, but every line is at least timestamped and leveled so Railway/Fly
// log viewers can filter on it.

function line(level, msg, meta) {
  const ts = new Date().toISOString();
  const suffix = meta ? " " + JSON.stringify(meta) : "";
  return `[${ts}] ${level.padEnd(5)} ${msg}${suffix}`;
}

module.exports = {
  info(msg, meta) {
    console.log(line("INFO", msg, meta));
  },
  warn(msg, meta) {
    console.warn(line("WARN", msg, meta));
  },
  error(msg, meta) {
    console.error(line("ERROR", msg, meta));
  },
};
