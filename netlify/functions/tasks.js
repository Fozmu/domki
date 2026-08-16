// Staff task board API. Stores tasks as one JSON blob in Netlify Blobs.
// Auth: HTTP Basic, checked against STAFF_USERNAME/STAFF_PASSWORD env vars
// (falls back to admin/domki123 if unset).

const crypto = require('crypto');
const { connectLambda, getStore } = require('@netlify/blobs');

const STORE_NAME = 'staff-tasks';
const BLOB_KEY = 'tasks';

exports.handler = async (event) => {
  connectLambda(event);

  if (!checkAuth(event.headers)) {
    return json(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Basic realm="staff"' });
  }

  const store = getStore(STORE_NAME);

  try {
    switch (event.httpMethod) {
      case 'GET':
        return json(200, { tasks: await loadTasks(store) });

      case 'POST': {
        const body = parseBody(event.body);
        if (!body.title || !body.title.trim()) {
          return json(400, { error: 'title_required' });
        }
        const tasks = await loadTasks(store);
        const task = {
          id: crypto.randomUUID(),
          title: body.title.trim().slice(0, 200),
          details: (body.details || '').trim().slice(0, 2000),
          reporter: (body.reporter || '').trim().slice(0, 100),
          priority: ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal',
          status: 'open',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        tasks.unshift(task);
        await store.setJSON(BLOB_KEY, tasks);
        return json(201, { task });
      }

      case 'PATCH': {
        const body = parseBody(event.body);
        if (!body.id) return json(400, { error: 'id_required' });
        const tasks = await loadTasks(store);
        const task = tasks.find((t) => t.id === body.id);
        if (!task) return json(404, { error: 'not_found' });
        if (body.status && ['open', 'in_progress', 'done'].includes(body.status)) {
          task.status = body.status;
        }
        if (typeof body.title === 'string' && body.title.trim()) {
          task.title = body.title.trim().slice(0, 200);
        }
        if (typeof body.details === 'string') {
          task.details = body.details.trim().slice(0, 2000);
        }
        if (['low', 'normal', 'high'].includes(body.priority)) {
          task.priority = body.priority;
        }
        task.updatedAt = new Date().toISOString();
        await store.setJSON(BLOB_KEY, tasks);
        return json(200, { task });
      }

      case 'DELETE': {
        const id = (event.queryStringParameters && event.queryStringParameters.id)
          || parseBody(event.body).id;
        if (!id) return json(400, { error: 'id_required' });
        const tasks = await loadTasks(store);
        const next = tasks.filter((t) => t.id !== id);
        await store.setJSON(BLOB_KEY, next);
        return json(200, { ok: true });
      }

      default:
        return json(405, { error: 'method_not_allowed' });
    }
  } catch (err) {
    return json(500, { error: 'server_error', message: String(err && err.message) });
  }
};

async function loadTasks(store) {
  const tasks = await store.get(BLOB_KEY, { type: 'json' });
  return Array.isArray(tasks) ? tasks : [];
}

function parseBody(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function checkAuth(headers) {
  const header = (headers && (headers.authorization || headers.Authorization)) || '';
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return false;

  let decoded;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  const sepIndex = decoded.indexOf(':');
  if (sepIndex === -1) return false;

  const user = decoded.slice(0, sepIndex);
  const pass = decoded.slice(sepIndex + 1);
  const expectedUser = process.env.STAFF_USERNAME || 'admin';
  const expectedPass = process.env.STAFF_PASSWORD || 'domki123';

  return safeEqual(user, expectedUser) && safeEqual(pass, expectedPass);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // still run a comparison so length mismatches don't short-circuit timing
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
    body: JSON.stringify(body)
  };
}
