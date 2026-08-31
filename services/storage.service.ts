// services/storage.service.ts
import { env } from '../config/env.ts';
import { observeExternalHttp } from '../telemetry/http.ts';
import type {
  BucketInfo,
  BucketListResponse,
  BucketRequest,
  BucketResponse,
  DeleteResponse,
  FileUpDownRequest,
  FileUpDownResponse,
  ObjectInfo,
  ObjectListResponse,
  ObjectRequest,
  RenameRequest,
  RenameResponse,
} from '../schemas/storage.schemas.ts';

// Named `ValueError` on purpose: storage.controller.ts's handleServiceError()
// checks `e.name === 'ValueError'` to map these to 400 BAD_REQUEST. That check
// was flagged as unreachable until this file existed — this resolves it.
export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValueError';
  }
}

type HttpMethod = 'GET' | 'POST' | 'DELETE';

// Best-effort extension -> MIME type map. Not exhaustive like Python's
// `mimetypes` module (kept small on purpose); falls back to
// 'application/octet-stream' exactly as the source does.
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
  txt: 'text/plain', json: 'application/json', csv: 'text/csv',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  zip: 'application/zip', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function guessContentType(objectKey: string): string {
  const ext = objectKey.split('.').pop()?.toLowerCase();
  return (ext && CONTENT_TYPES[ext]) || 'application/octet-stream';
}

export class StorageService {
  private headers: Record<string, string>;

  constructor() {
    if (!env.OSS_SERVICE_URL || !env.OSS_API_KEY) {
      throw new ValueError('OSS service not configured. Set OSS_SERVICE_URL and OSS_API_KEY.');
    }
    this.headers = {
      Authorization: `Bearer ${env.OSS_API_KEY}`,
      'Content-Type': 'application/json',
    };
  }

  async createBucket(request: BucketRequest): Promise<BucketResponse> {
    const result = await this.post('api/v1/infra/client/oss/buckets', {
      bucket_name: request.bucket_name,
      visibility: request.visibility,
    });
    return { bucket_name: result.bucket_name, created_at: result.created_at ?? '' } as BucketResponse;
  }

  async listBuckets(): Promise<BucketListResponse> {
    const result = await this.get('api/v1/infra/client/oss/buckets', {});
    const buckets: BucketInfo[] = (result.buckets ?? []).map((item: any) => ({
      bucket_name: item.bucket_name,
      visibility: item.visibility,
    }));
    return { buckets };
  }

  async listObjects(request: { bucket_name: string }): Promise<ObjectListResponse> {
    const endpoint = `api/v1/infra/client/oss/buckets/${request.bucket_name}/objects`;
    const result = await this.get(endpoint, {});
    const objects: ObjectInfo[] = (result.objects ?? []).map((item: any) => ({
      bucket_name: request.bucket_name,
      object_key: item.key,
      size: item.size,
      last_modified: item.last_modified,
      etag: item.etag,
    }));
    return { objects };
  }

  async getObjectInfo(request: ObjectRequest): Promise<ObjectInfo> {
    const endpoint = `api/v1/infra/client/oss/buckets/${request.bucket_name}/objects/metadata`;
    const result = await this.get(endpoint, { object_key: request.object_key });
    return {
      bucket_name: request.bucket_name,
      object_key: result.key,
      size: result.size,
      last_modified: result.last_modified,
      etag: result.etag,
    };
  }

  async renameObject(request: RenameRequest): Promise<RenameResponse> {
    const endpoint = `api/v1/infra/client/oss/buckets/${request.bucket_name}/objects/rename`;
    await this.post(endpoint, {
      overwrite_key: request.overwrite_key,
      source_key: request.source_key,
      target_key: request.target_key,
    });
    return { success: true };
  }

  async deleteObject(request: ObjectRequest): Promise<DeleteResponse> {
    const endpoint = `api/v1/infra/client/oss/buckets/${request.bucket_name}/objects`;
    await this.delete(endpoint, { object_keys: [request.object_key] });
    return { success: true };
  }

  async createUploadUrl(request: FileUpDownRequest): Promise<FileUpDownResponse> {
    const endpoint = `api/v1/infra/client/oss/buckets/${request.bucket_name}/objects/upload_url`;
    const result = await this.post(endpoint, { expires_in: 0, object_key: request.object_key });
    return { upload_url: result.upload_url, expires_at: result.expires_at } as FileUpDownResponse;
  }

  async createDownloadUrl(request: FileUpDownRequest): Promise<FileUpDownResponse> {
    const endpoint = `api/v1/infra/client/oss/buckets/${request.bucket_name}/objects/download_url`;
    const result = await this.post(endpoint, {
      content_type: guessContentType(request.object_key),
      expires_in: 0,
      object_key: request.object_key,
    });
    return { download_url: result.download_url, expires_at: result.expires_at } as FileUpDownResponse;
  }

  private get(endpoint: string, params: Record<string, string>) {
    return this.request('GET', endpoint, { params });
  }
  private post(endpoint: string, payload: Record<string, unknown>) {
    return this.request('POST', endpoint, { payload });
  }
  private delete(endpoint: string, payload: Record<string, unknown>) {
    return this.request('DELETE', endpoint, { payload });
  }

  private async request(
    method: HttpMethod,
    endpoint: string,
    opts: { params?: Record<string, string>; payload?: Record<string, unknown> },
  ): Promise<any> {
    const base = env.OSS_SERVICE_URL.endsWith('/') ? env.OSS_SERVICE_URL : `${env.OSS_SERVICE_URL}/`;
    const url = new URL(endpoint.replace(/^\//, ''), base);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await observeExternalHttp(
        fetch(url, {
          method,
          headers: this.headers,
          body: opts.payload !== undefined ? JSON.stringify(opts.payload) : undefined,
          signal: controller.signal,
        }),
      );

      if (!response.ok) {
        const text = await response.text();
        throw new ValueError(`ObjectStorage service HTTP error: ${response.status} - ${text}`);
      }

      const result = await response.json();
      if (result.code !== 0) {
        throw new ValueError(`ObjectStorage service error: ${result.error ?? 'Unknown error'}. ${result.message ?? ''}`);
      }
      return result.data ?? [];
    } finally {
      clearTimeout(timeout);
    }
  }
}