/**
 * Thin typed fetch wrapper around the FastAPI backend.
 *
 * The browser never talks to the database directly; every number rendered in the
 * dashboard comes from one of these endpoints.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000";

/** Serverless deployments cannot keep background threads alive. */
export const WORKFLOW_SYNC =
  process.env.NEXT_PUBLIC_WORKFLOW_SYNC === "true" ||
  process.env.NEXT_PUBLIC_WORKFLOW_SYNC === undefined;

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function messageFromDetail(detail: unknown, fallback: string): string {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) =>
        typeof item === "object" && item !== null && "msg" in item
          ? String((item as { msg: unknown }).msg)
          : String(item),
      )
      .join("; ");
  }
  if (typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      return record.errors.join(" ");
    }
    if (typeof record.detail === "string") return record.detail;
    return JSON.stringify(record);
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new ApiError(
      `Cannot reach the API at ${API_BASE}. Is the FastAPI server running?`,
      0,
      null,
    );
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (!response.ok) {
    const detail = payload && typeof payload === "object" ? (payload as { detail?: unknown }).detail : null;
    throw new ApiError(
      messageFromDetail(detail, `Request failed with status ${response.status}`),
      response.status,
      detail,
    );
  }
  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return request<T>(path, { method: "POST", body: form });
}

export function downloadUrl(report: string): string {
  return `${API_BASE}/api/reports/download?report=${encodeURIComponent(report)}`;
}

export function healthUrl(): string {
  return `${API_BASE}/health`;
}
