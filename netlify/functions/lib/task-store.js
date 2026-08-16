// Shared Netlify Blobs access for the staff task board, used by both
// tasks.js (the API) and tasks-cleanup.js (the scheduled purge).

const STORE_NAME = 'staff-tasks';
const BLOB_KEY = 'tasks';
const DONE_RETENTION_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

function isExpiredDone(task, now) {
  return task.status === 'done' && (now - Date.parse(task.updatedAt)) > DONE_RETENTION_MS;
}

// Loads tasks and drops any "done" task older than the retention window,
// persisting the trim so it doesn't need to be repeated on every read.
async function loadAndPurge(store) {
  const raw = await store.get(BLOB_KEY, { type: 'json' });
  const tasks = Array.isArray(raw) ? raw : [];
  const now = Date.now();
  const kept = tasks.filter((t) => !isExpiredDone(t, now));

  if (kept.length !== tasks.length) {
    await store.setJSON(BLOB_KEY, kept);
  }
  return kept;
}

async function saveTasks(store, tasks) {
  await store.setJSON(BLOB_KEY, tasks);
}

module.exports = { STORE_NAME, BLOB_KEY, DONE_RETENTION_MS, loadAndPurge, saveTasks };
