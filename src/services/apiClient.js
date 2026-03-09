const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

// Holds a reference to Clerk's getToken function, set by the app on init
let _getToken = null;

export function setTokenProvider(getTokenFn) {
  _getToken = getTokenFn;
}

async function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (_getToken) {
    try {
      const token = await _getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (e) {
      // Not signed in — proceed without auth
    }
  }
  return headers;
}

export async function apiGet(path) {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, { headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API error ${response.status}`);
  }
  return response.json();
}

export async function apiPost(path, body) {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API error ${response.status}`);
  }
  return response.json();
}

export async function apiPut(path, body) {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API error ${response.status}`);
  }
  return response.json();
}

export async function apiStream(path, body, onChunk, onDone, onError, signal) {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API error ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'text') onChunk(data.text);
          else if (data.type === 'done') onDone();
          else if (data.type === 'error') onError(data.error);
        } catch (e) {
          // Skip malformed SSE data
        }
      }
    }
  }
}

export async function apiDelete(path) {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API error ${response.status}`);
  }
  // 204 No Content returns no body
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
}
