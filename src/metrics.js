// A tiny rolling window of recent events (requests, auth failures, AI
// suggestions triggered) for the /metrics endpoint. Deliberately simple —
// this is operational visibility for a hobby-scale deployment, not a real
// metrics pipeline.

const MAX_ENTRIES = 1000;

let events = [];

function record(type) {
  events.push({ type, time: Date.now() });
  if (events.length > MAX_ENTRIES) events.shift();
}

function summary() {
  const byType = events.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});
  return {
    total: events.length,
    byType,
    recent: events.slice(-20),
  };
}

module.exports = { record, summary };
