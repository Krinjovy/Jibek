import { get, list, put } from '@vercel/blob';

let memory = null;

export function useMemoryStore() {
  memory = new Map();
  return memory;
}

async function readStream(stream) {
  if (stream && typeof stream.getReader === 'function') {
    return new Response(stream).text();
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export async function writeJson(pathname, data) {
  const text = JSON.stringify(data);
  if (memory) {
    memory.set(pathname, text);
    return;
  }
  await put(pathname, text, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
}

export async function readJson(pathname) {
  if (memory) {
    const text = memory.get(pathname);
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode === 304 || !result.stream) return null;
  try { return JSON.parse(await readStream(result.stream)); } catch (e) { return null; }
}

export async function listPaths(prefix) {
  if (memory) return [...memory.keys()].filter(key => key.startsWith(prefix)).sort();
  const paths = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const blob of page.blobs) paths.push(blob.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return paths;
}

export async function readAll(prefix) {
  const paths = await listPaths(prefix);
  const rows = [];
  for (const path of paths) {
    const data = await readJson(path);
    if (data) rows.push(data);
  }
  return rows;
}
