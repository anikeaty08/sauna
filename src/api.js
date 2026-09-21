export async function api(path, body) {
  const response = await fetch(`/api${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.detail || 'The server could not complete this request.');
  return result;
}
