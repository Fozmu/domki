// Scheduled: drops "done" tasks older than the retention window daily,
// so old tasks get purged even if nobody opens the staff panel.
// See lib/task-store.js for the retention rule (shared with tasks.js).

const { connectLambda, getStore } = require('@netlify/blobs');
const { STORE_NAME, loadAndPurge } = require('./lib/task-store');

exports.handler = async (event) => {
  if (event) connectLambda(event);
  const store = getStore(STORE_NAME);
  await loadAndPurge(store);
  return { statusCode: 200 };
};

exports.config = { schedule: '@daily' };
