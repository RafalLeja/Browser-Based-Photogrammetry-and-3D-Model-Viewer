// Typed client for the Vitrine API. Requests go to /api on the same origin (Vite proxies it in
// development, nginx in production), so the HttpOnly session cookie travels with them.
import type { Vec3 } from './types';

export const API = '/api/v1';

export interface User {
  id: number;
  login: string;
  display_name: string;
  role: string;
}

export interface CollectionObject {
  id: number;
  title: string;
  description: string;
  tags: string[];
  status: 'processing' | 'ready' | 'failed';
  model_url: string | null;
  model_format: 'gltf' | 'ply';
  up: Vec3 | null;
  dimensions_mm: Vec3 | null;
  triangles: number | null;
  file_size: number | null;
  thumbnail_url: string | null;
  is_demo: boolean;
  job_id: number | null;
  annotation_count: number;
  created_at: string;
  updated_at: string;
}

export interface ObjectPage {
  items: CollectionObject[];
  total: number;
  page: number;
  page_size: number;
}

export interface Annotation {
  id: number;
  object_id: number;
  position: Vec3;
  normal: Vec3;
  title: string;
  text: string;
  author: string | null;
  created_at: string;
  updated_at: string;
}

export type EnvironmentName = 'studio' | 'room' | 'outdoor' | 'none';

export interface SharedViewState {
  position: Vec3;
  target: Vec3;
  environment?: EnvironmentName;
  exposure?: number;
  light_intensity?: number;
  light_direction?: Vec3;
  background?: boolean;
}

export interface SharedView {
  id: string;
  object_id: number;
  state: SharedViewState;
  created_at: string;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: number;
  object_id: number;
  object_title: string;
  status: JobStatus;
  stage: string | null;
  progress: number;
  pipeline: string | null;
  photo_count: number;
  stage_times: Record<string, number>;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  log: string | null;
}

export interface Stage {
  key: string;
  label: string;
  description: string;
}

export interface PipelineInfo {
  mode: string;
  reason: string;
  stages: Stage[];
  limits: { min_photos: number; max_photos: number; max_photo_mb: number; max_upload_mb: number };
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** FastAPI reports errors as {detail: string} or, for validation, {detail: [{msg, loc}]}. */
export function errorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string; loc?: unknown[] };
    const field = Array.isArray(first.loc) ? first.loc.at(-1) : undefined;
    return field && typeof field === 'string' ? `${field}: ${first.msg}` : (first.msg ?? 'Invalid request.');
  }
  if (status === 0) return 'Cannot reach the server. Check that the API is running.';
  if (status >= 500) return 'The server had a problem. Try again in a moment.';
  return `Request failed (${status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, errorMessage(0, null));
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, errorMessage(response.status, body));
  return body as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export interface ObjectQuery {
  q?: string;
  tag?: string;
  sort?: 'newest' | 'oldest' | 'title';
  status?: 'ready' | 'processing' | 'failed' | 'all';
  page?: number;
  page_size?: number;
}

export const api = {
  me: () => request<User>('/auth/me'),
  login: (login: string, password: string) => request<User>('/auth/login', json('POST', { login, password })),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  objects: (query: ObjectQuery = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
    return request<ObjectPage>(`/objects?${params}`);
  },
  tags: () => request<{ tag: string; count: number }[]>('/objects/tags'),
  object: (id: number) => request<CollectionObject>(`/objects/${id}`),
  updateObject: (id: number, patch: Partial<Pick<CollectionObject, 'title' | 'description' | 'tags' | 'dimensions_mm'>>) =>
    request<CollectionObject>(`/objects/${id}`, json('PATCH', patch)),
  deleteObject: (id: number) => request<void>(`/objects/${id}`, { method: 'DELETE' }),
  setThumbnail: (id: number, image: Blob) =>
    request<CollectionObject>(`/objects/${id}/thumbnail`, { method: 'PUT', body: image, headers: { 'Content-Type': image.type } }),

  annotations: (objectId: number) => request<Annotation[]>(`/objects/${objectId}/annotations`),
  createAnnotation: (objectId: number, body: Pick<Annotation, 'position' | 'normal' | 'title' | 'text'>) =>
    request<Annotation>(`/objects/${objectId}/annotations`, json('POST', body)),
  updateAnnotation: (id: number, body: Partial<Pick<Annotation, 'title' | 'text'>>) =>
    request<Annotation>(`/annotations/${id}`, json('PATCH', body)),
  deleteAnnotation: (id: number) => request<void>(`/annotations/${id}`, { method: 'DELETE' }),

  createView: (objectId: number, state: SharedViewState) => request<SharedView>(`/objects/${objectId}/views`, json('POST', state)),
  view: (id: string) => request<SharedView>(`/views/${encodeURIComponent(id)}`),

  pipeline: () => request<PipelineInfo>('/pipeline'),
  jobs: (status: 'all' | 'active' | 'done' | 'failed' = 'all') => request<Job[]>(`/jobs?status=${status}`),
  job: (id: number) => request<Job>(`/jobs/${id}`),
  cancelJob: (id: number) => request<Job>(`/jobs/${id}/cancel`, { method: 'POST' }),
  retryJob: (id: number) => request<Job>(`/jobs/${id}/retry`, { method: 'POST' }),
};

export interface UploadResult {
  object: CollectionObject;
  job: Job;
  skipped_files: number;
}

/**
 * Sends photos with XMLHttpRequest, because fetch cannot report upload progress yet.
 * `onProgress` receives 0..1. Abort with the returned controller's abort().
 */
export function uploadPhotos(
  form: { title: string; description: string; tags: string; realHeightMm?: number },
  files: File[],
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const data = new FormData();
  data.set('title', form.title);
  data.set('description', form.description);
  data.set('tags', form.tags);
  if (form.realHeightMm) data.set('real_height_mm', String(form.realHeightMm));
  for (const file of files) data.append('files', file, file.name);

  const promise = new Promise<UploadResult>((resolve, reject) => {
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON: fall through to a generic message.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResult);
      else reject(new ApiError(xhr.status, errorMessage(xhr.status, body)));
    };
    xhr.onerror = () => reject(new ApiError(0, errorMessage(0, null)));
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled.'));
  });
  xhr.open('POST', `${API}/uploads`);
  xhr.withCredentials = true;
  xhr.send(data);
  return { promise, abort: () => xhr.abort() };
}
