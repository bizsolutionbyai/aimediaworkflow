// Thin typed wrapper over the backend REST API.
export class ApiError extends Error {
  constructor(message: string, public status: number, public data: any) {
    super(message);
  }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ApiError(data?.error ?? `${res.status} ${res.statusText}`, res.status, data);
  return data as T;
}

export const get = <T = any>(url: string) => api<T>("GET", url);
export const post = <T = any>(url: string, body?: unknown) => api<T>("POST", url, body ?? {});
export const put = <T = any>(url: string, body?: unknown) => api<T>("PUT", url, body ?? {});
export const patch = <T = any>(url: string, body?: unknown) => api<T>("PATCH", url, body ?? {});
export const del = <T = any>(url: string) => api<T>("DELETE", url);

export const fileUrl = (rel: string) => `/files/${rel}`;
