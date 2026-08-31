// services/aihub.service.ts
import { OpenAI, toFile } from 'openai';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { observeExternalHttp } from '../telemetry/http.js';
import type {
  GenTxtRequest,
  GenTxtResponse,
  GenImgRequest,
  GenImgResponse,
  GenVideoRequest,
  GenVideoResponse,
  GenAudioRequest,
  GenAudioResponse,
  AnalyzePdfRequest,
  AnalyzePdfResponse,
  TranscribeAudioRequest,
  TranscribeAudioResponse,
} from '../schemas/aihub.schemas.js';

const PDF_ANALYSIS_MODEL = 'claude-sonnet-4.6';
const PDF_SYSTEM_PROMPT = `You are a careful PDF analysis assistant.

Rules:
- Answer only from the attached PDF.
- If the PDF does not contain the requested information, say so clearly.
- Do not invent or infer unsupported facts.
- Mention page numbers for important facts whenever the PDF makes that possible.
- Match the user's instruction language.
`;
const PDF_MODE_PROMPTS: Record<string, string> = {
  qa: `Task type: Question answering.
Read the attached PDF and answer the user's question directly, clearly, and only with information supported by the document.`,
  extract: `Task type: Structured extraction.
Read the attached PDF and extract the requested information as concise Markdown with clear headings and bullets when helpful.`,
};
const PDF_MAX_PAGE_WINDOW = 80;
const PDF_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const PDF_MAX_TOTAL_PAGES = 80;

/** Named to match aihub.controller.ts's existing `e.constructor.name === 'ValueError'` check. */
export class ValueError extends Error {}
export class InvalidImageInputError extends ValueError {}
export class InvalidAudioInputError extends ValueError {}
export class InvalidPdfInputError extends ValueError {}

const VOICE_MAP: Record<string, string> = {
  'qwen3-tts-flash|male': 'Ethan',
  'qwen3-tts-flash|female': 'Cherry',
  'gemini-2.5-pro-preview-tts|male': 'Puck',
  'gemini-2.5-pro-preview-tts|female': 'Zephyr',
  'eleven_v3|male': 'echo',
  'eleven_v3|female': 'alloy',
  'eleven_turbo_v2|male': 'echo',
  'eleven_turbo_v2|female': 'alloy',
  'gpt-4o-mini-tts|male': 'echo',
  'gpt-4o-mini-tts|female': 'nova',
};
const DEFAULT_VOICE: Record<string, string> = { male: 'Ethan', female: 'Cherry' };

interface UploadFile {
  buffer: Buffer;
  name: string;
}

export class AIHubService {
  private client: OpenAI | null = null;

  constructor() {
    if (env.APP_AI_BASE_URL && env.APP_AI_KEY) {
      this.client = new OpenAI({
        apiKey: env.APP_AI_KEY,
        baseURL: env.APP_AI_BASE_URL.replace(/\/+$/, ''),
      });
    }
  }

  private requireAiClient(): OpenAI {
    if (!this.client) {
      throw new ValueError('AI service not configured. Set APP_AI_BASE_URL and APP_AI_KEY.');
    }
    return this.client;
  }

  // ------------------------------------------------------------------
  // Text generation
  // ------------------------------------------------------------------
  async gentxt(request: GenTxtRequest): Promise<GenTxtResponse> {
    try {
      const client = this.requireAiClient();
      const response = await observeExternalHttp(
        client.chat.completions.create({
          model: request.model,
          messages: request.messages as any,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          stream: false,
        })
      );

      const content = response.choices[0]?.message?.content ?? '';
      const usage = response.usage
        ? {
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : undefined;

      return { content, model: request.model, usage };
    } catch (e) {
      console.error('gentxt error:', e);
      throw e;
    }
  }

  async *gentxtStream(request: GenTxtRequest): AsyncGenerator<string, void, unknown> {
    try {
      const client = this.requireAiClient();
      const stream = await observeExternalHttp(
        client.chat.completions.create({
          model: request.model,
          messages: request.messages as any,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          stream: true,
        })
      );

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    } catch (e) {
      console.error('gentxt_stream error:', e);
      throw e;
    }
  }

  // ------------------------------------------------------------------
  // Shared: data URI / upload-file helpers
  // ------------------------------------------------------------------
  private static extractImageRef(item: any): string {
    const url = item?.url;
    if (url) return url;
    const b64 = item?.b64_json;
    if (b64) return `data:image/png;base64,${b64}`;
    throw new Error('Neither url nor b64_json found in genimg response item');
  }

  private static parseDataUri(dataUri: string, ErrorCls: typeof ValueError = ValueError): [Buffer, string] {
    const commaIdx = dataUri.indexOf(',');
    if (commaIdx === -1) throw new ErrorCls("Invalid data URI: missing ',' separator.");

    const header = dataUri.slice(0, commaIdx);
    const b64Data = dataUri.slice(commaIdx + 1);
    let contentType = ErrorCls === InvalidImageInputError ? 'image/png' : 'application/octet-stream';

    if (header.startsWith('data:')) {
      const meta = header.slice(5);
      if (meta.includes(';')) {
        const maybeType = meta.split(';', 1)[0].trim();
        if (maybeType) contentType = maybeType;
      } else if (meta.trim()) {
        contentType = meta.trim();
      }
    }

    try {
      return [Buffer.from(b64Data, 'base64'), contentType];
    } catch (e) {
      throw new ErrorCls('Invalid base64 data in data URI.');
    }
  }

  private static filenameFromContentType(contentType: string, namePrefix = 'file', defaultExt = 'bin'): string {
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/flac': 'flac',
    };
    const ext = extMap[(contentType || '').toLowerCase()] ?? defaultExt;
    return `${namePrefix}.${ext}`;
  }

  private static getSourceName(sourceRef: string, fallback = 'input_file'): string {
    const ref = (sourceRef || '').trim();
    if (ref.startsWith('http://') || ref.startsWith('https://')) {
      const noQuery = ref.split('?')[0].replace(/\/+$/, '');
      return noQuery.split('/').pop() || fallback;
    }
    if (ref.startsWith('data:')) return fallback;
    return path.basename(ref) || fallback;
  }

  private async imageStrToUploadFile(image: string, namePrefix = 'image'): Promise<UploadFile> {
    image = (image || '').trim();
    if (!image) throw new InvalidImageInputError('Input image is empty.');

    if (image.startsWith('http://') || image.startsWith('https://')) {
      try {
        const resp = await observeExternalHttp(fetch(image));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const bytes = Buffer.from(await resp.arrayBuffer());
        const name = image.split('?')[0].replace(/\/+$/, '').split('/').pop() || `${namePrefix}.png`;
        return { buffer: bytes, name };
      } catch (e) {
        throw new InvalidImageInputError(`Failed to download image from URL: ${(e as Error).message}`);
      }
    }

    if (!image.startsWith('data:')) {
      throw new InvalidImageInputError(
        'Only base64 data URI or HTTP URL is supported. Example: `data:image/png;base64,...` or `https://...`.'
      );
    }

    const [bytes, contentType] = AIHubService.parseDataUri(image, InvalidImageInputError);
    const name = AIHubService.filenameFromContentType(contentType, namePrefix, 'png');
    return { buffer: bytes, name };
  }

  private async imageInputToUploadFiles(imageInput: string | string[]): Promise<UploadFile[]> {
    const images = typeof imageInput === 'string' ? [imageInput] : imageInput;
    if (!images.length) throw new InvalidImageInputError('Input image list is empty.');

    const files: UploadFile[] = [];
    for (let i = 0; i < images.length; i++) {
      if (typeof images[i] !== 'string') {
        throw new InvalidImageInputError('Each image must be a base64 data URI string.');
      }
      files.push(await this.imageStrToUploadFile(images[i], `image_${i + 1}`));
    }
    return files;
  }

  private async audioStrToUploadFile(audio: string, namePrefix = 'audio'): Promise<UploadFile> {
    audio = (audio || '').trim();
    if (!audio) throw new InvalidAudioInputError('Input audio is empty.');

    if (audio.startsWith('http://') || audio.startsWith('https://')) {
      try {
        const resp = await observeExternalHttp(fetch(audio));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const bytes = Buffer.from(await resp.arrayBuffer());
        const name = AIHubService.getSourceName(audio, `${namePrefix}.mp3`);
        return { buffer: bytes, name };
      } catch (e) {
        throw new InvalidAudioInputError(`Failed to download audio from URL: ${(e as Error).message}`);
      }
    }

    if (audio.startsWith('data:')) {
      const [bytes, contentType] = AIHubService.parseDataUri(audio, InvalidAudioInputError);
      const name = AIHubService.filenameFromContentType(contentType, namePrefix, 'mp3');
      return { buffer: bytes, name };
    }

    // NOTE: server-side absolute-path input only makes sense if this process
    // has direct filesystem access to whatever path the caller sent — same
    // trust assumption the Python version made. Preserved as-is, not hardened.
    if (!path.isAbsolute(audio)) {
      throw new InvalidAudioInputError(
        'Only absolute path, http(s) URL, or base64 data URI is supported for audio input.'
      );
    }
    if (!fs.existsSync(audio) || !fs.statSync(audio).isFile()) {
      const err = new Error(`Audio file not found: ${audio}`);
      err.name = 'FileNotFoundError'; // matches controller's `e.name === 'FileNotFoundError'` check
      throw err;
    }
    return { buffer: fs.readFileSync(audio), name: path.basename(audio) };
  }

  private static extractTranscriptionText(resp: unknown): string | null {
    if (typeof resp === 'string' && resp.trim()) return resp.trim();

    let text: unknown;
    let content: unknown;
    if (resp && typeof resp === 'object') {
      text = (resp as any).text;
      content = (resp as any).content;
    }
    if (typeof text === 'string' && text.trim()) return text.trim();

    if (content instanceof Uint8Array) {
      content = Buffer.from(content).toString('utf-8');
    }

    let data: any;
    if (content && typeof content === 'object') {
      data = content;
    } else if (typeof content === 'string' && content.trim()) {
      try {
        data = JSON.parse(content);
      } catch {
        return null;
      }
    } else {
      return null;
    }

    const nested = data?.text;
    return typeof nested === 'string' && nested.trim() ? nested.trim() : null;
  }

  private static extractChatTextContent(content: unknown): string {
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      const parts = content
        .map((item) => (typeof item === 'object' ? (item as any)?.text : undefined))
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      return parts.join('\n').trim();
    }
    return '';
  }

  private static extractCompletionText(response: any): string {
    const choices = response?.choices;
    if (!choices?.length) return '';
    const content = choices[0]?.message?.content;
    return AIHubService.extractChatTextContent(content);
  }

  // ------------------------------------------------------------------
  // PDF analysis
  // ------------------------------------------------------------------
  private static buildPdfUserPrompt(instruction: string, mode: string): string {
    return `${PDF_MODE_PROMPTS[mode]}\n\nUser instruction:\n${instruction.trim()}\n`;
  }

  private static buildPdfSuccessMessage(pageStart: number, pageEnd: number, totalPages: number): string {
    const selectedRange = pageStart === pageEnd ? `page ${pageStart}` : `pages ${pageStart}-${pageEnd}`;
    const totalLabel = totalPages === 1 ? 'page' : 'pages';
    return `PDF analyzed successfully using ${selectedRange} of ${totalPages} total ${totalLabel}.`;
  }

  private static resolvePdfPageRange(
    totalPages: number,
    pageStart = 1,
    pageEnd?: number
  ): [number, number] {
    if (totalPages <= 0) throw new InvalidPdfInputError('PDF has no pages.');
    if (pageStart < 1) throw new InvalidPdfInputError('page_start must be greater than or equal to 1.');
    if (pageStart > totalPages) {
      throw new InvalidPdfInputError(`page_start ${pageStart} exceeds total PDF pages ${totalPages}.`);
    }

    let end = pageEnd ?? Math.min(totalPages, pageStart + PDF_MAX_PAGE_WINDOW - 1);

    if (end < pageStart) throw new InvalidPdfInputError('page_end must be greater than or equal to page_start.');
    if (end > totalPages) throw new InvalidPdfInputError(`page_end ${end} exceeds total PDF pages ${totalPages}.`);

    const selectedPages = end - pageStart + 1;
    if (selectedPages > PDF_MAX_PAGE_WINDOW) {
      throw new InvalidPdfInputError(
        `Requested page range contains ${selectedPages} pages. ` +
          `The maximum supported range per request is ${PDF_MAX_PAGE_WINDOW} pages.`
      );
    }

    return [pageStart, end];
  }

  private static validatePdfAttachmentLimits(pdfBytes: Uint8Array, pageCount: number): void {
    if (pdfBytes.length <= PDF_MAX_TOTAL_BYTES && pageCount <= PDF_MAX_TOTAL_PAGES) return;
    const sizeMb = pdfBytes.length / 1024 / 1024;
    throw new InvalidPdfInputError(
      `PDF exceeds native attachment limits: ${sizeMb.toFixed(2)}MB and ${pageCount} pages ` +
        `(limits: 15MB total, 80 pages total).`
    );
  }

  /**
   * Trims the PDF to [pageStart, pageEnd] using pdf-lib (no PyMuPDF equivalent in
   * Node). Functionally the same goal as the Python version — subset + re-save —
   * but pdf-lib's compression isn't byte-identical to MuPDF's `garbage=4,
   * deflate=True`, so output size will differ somewhat from the Python version.
   */
  private static async preparePdfAttachment(
    pdfBytes: Buffer,
    pageStart = 1,
    pageEnd?: number
  ): Promise<[string, number, number, number]> {
    let sourceDoc: PDFDocument;
    try {
      sourceDoc = await PDFDocument.load(pdfBytes);
    } catch (e) {
      throw new InvalidPdfInputError('Failed to read the provided PDF document.');
    }

    const totalPages = sourceDoc.getPageCount();
    const [start, end] = AIHubService.resolvePdfPageRange(totalPages, pageStart, pageEnd);

    const subsetDoc = await PDFDocument.create();
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
    const copiedPages = await subsetDoc.copyPages(sourceDoc, indices);
    copiedPages.forEach((page) => subsetDoc.addPage(page));
    const subsetBytes = await subsetDoc.save({ useObjectStreams: true });

    AIHubService.validatePdfAttachmentLimits(subsetBytes, end - start + 1);
    return [Buffer.from(subsetBytes).toString('base64'), start, end, totalPages];
  }

  private async pdfSourceToBytes(pdf: string): Promise<[Buffer, string]> {
    pdf = (pdf || '').trim();
    if (!pdf) throw new InvalidPdfInputError('PDF input is empty.');
    if (!pdf.startsWith('data:')) {
      throw new InvalidPdfInputError(
        'Only base64 PDF data URI is supported for PDF input. Example: `data:application/pdf;base64,...`.'
      );
    }

    const [bytes, contentType] = AIHubService.parseDataUri(pdf, InvalidPdfInputError);
    if (contentType.toLowerCase() !== 'application/pdf') {
      throw new InvalidPdfInputError('PDF data URI must use content type `application/pdf`.');
    }
    return [bytes, AIHubService.getSourceName(pdf, 'document.pdf')];
  }

  async analyzePdf(request: AnalyzePdfRequest): Promise<AnalyzePdfResponse> {
    if (!request.instruction?.trim()) {
      throw new InvalidPdfInputError('instruction is required for PDF analysis.');
    }

    const client = this.requireAiClient();
    const [pdfBytes, pdfName] = await this.pdfSourceToBytes(request.pdf);
    const [pdfB64, start, end, totalPages] = await AIHubService.preparePdfAttachment(
      pdfBytes,
      request.page_start,
      request.page_end
    );
    const userPrompt = AIHubService.buildPdfUserPrompt(request.instruction, request.mode);

    const response = await observeExternalHttp(
      client.chat.completions.create({
        model: PDF_ANALYSIS_MODEL,
        messages: [
          { role: 'system', content: PDF_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 },
                citations: { enabled: true },
              },
            ] as any,
          },
        ],
        temperature: 0.0,
        max_tokens: 8192,
        stream: false,
      })
    );

    const result = AIHubService.extractCompletionText(response);
    if (!result) throw new Error('PDF analysis returned an empty result.');

    return {
      status: 'success',
      result,
      message: AIHubService.buildPdfSuccessMessage(start, end, totalPages),
      pdf_name: pdfName,
      mode: request.mode,
      model: PDF_ANALYSIS_MODEL,
      page_start: start,
      page_end: end,
      total_pages: totalPages,
    };
  }

  // ------------------------------------------------------------------
  // Image generation
  // ------------------------------------------------------------------
  async genimg(request: GenImgRequest): Promise<GenImgResponse> {
    try {
      const client = this.requireAiClient();
      let response;

      if (request.image) {
        const files = await this.imageInputToUploadFiles(request.image);
        const uploadables = await Promise.all(
          files.map((f) => toFile(f.buffer, f.name))
        );
        response = await observeExternalHttp(
          client.images.edit({
            model: request.model,
            image: uploadables.length === 1 ? uploadables[0] : uploadables,
            prompt: request.prompt,
            size: request.size as any,
            n: request.n,
            response_format: request.response_format as any,
          })
        );
      } else {
        response = await observeExternalHttp(
          client.images.generate({
            model: request.model,
            prompt: request.prompt,
            size: request.size as any,
            quality: request.quality as any,
            n: request.n,
            response_format: request.response_format as any,
          })
        );
      }

      if (!response.data?.length) throw new Error('Image generation returned empty result');

      const revisedPrompt = response.data[0]?.revised_prompt;
      const images = response.data.map((item) => AIHubService.extractImageRef(item));

      return { images, model: request.model, revised_prompt: revisedPrompt };
    } catch (e) {
      console.error('genimg error:', e);
      throw e;
    }
  }

  // ------------------------------------------------------------------
  // Video generation
  // ------------------------------------------------------------------
  private static safeInt(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  /**
   * Handles the custom AI-proxy's varying response shapes for video/audio —
   * see file-level note above. Tries attribute-style objects first (matching
   * SDK response objects), then falls back to parsing a JSON body off a
   * fetch-style Response (`.content`/`.text()`), matching the Python version's
   * HttpxBinaryResponseContent fallback.
   */
  private static async extractCdnUrl(obj: any): Promise<string | null> {
    const isHttpUrl = (v: unknown): v is string =>
      typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'));

    if (isHttpUrl(obj?.url)) return obj.url;

    const videos = obj?.videos;
    if (Array.isArray(videos) && videos.length > 0 && isHttpUrl(videos[0]?.url)) {
      return videos[0].url;
    }

    for (const attr of ['video_url', 'audio_url']) {
      if (isHttpUrl(obj?.[attr])) return obj[attr];
    }

    if (obj?.output && isHttpUrl(obj.output.url)) return obj.output.url;

    if (obj?.meta_data && isHttpUrl(obj.meta_data.url)) return obj.meta_data.url;

    // Fallback: JSON body on a fetch-style Response or an object exposing raw bytes/text.
    try {
      let raw: string | null = null;
      if (typeof obj?.text === 'function') {
        raw = await obj.text();
      } else if (obj?.content instanceof Uint8Array) {
        raw = Buffer.from(obj.content).toString('utf-8');
      } else if (typeof obj?.content === 'string') {
        raw = obj.content;
      }
      if (raw) {
        const data = JSON.parse(raw);
        for (const key of ['url', 'video_url', 'audio_url']) {
          if (isHttpUrl(data?.[key])) return data[key];
        }
      }
    } catch {
      /* ignore, fall through to null */
    }

    return null;
  }

  async genvideo(request: GenVideoRequest): Promise<GenVideoResponse> {
    try {
      const client = this.requireAiClient();
      const createParams: Record<string, unknown> = {
        model: request.model,
        prompt: request.prompt,
        size: request.size,
        seconds: request.seconds,
      };

      if (request.image) {
        const file = await this.imageStrToUploadFile(request.image, 'input_reference');
        createParams.input_reference = await toFile(file.buffer, file.name);
      }

      // NOTE: client.videos requires a recent `openai` SDK version — confirm
      // your installed version exposes this before relying on genvideo.
      let video: any = await observeExternalHttp((client as any).videos.create(createParams));
      const videoId = video?.id;
      if (!videoId) throw new Error('Video generation started but missing video id');

      console.log(`Video generation started: ${videoId}`);

      let status = video?.status;
      while (status === 'in_progress' || status === 'queued') {
        console.log(`Video ${videoId} progress: ${video?.progress ?? 0}%`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        video = await observeExternalHttp((client as any).videos.retrieve(videoId));
        status = video?.status;
      }

      if (status === 'failed') {
        throw new Error(video?.error?.message || 'Video generation failed');
      }

      const cdnUrl = await AIHubService.extractCdnUrl(video);
      if (!cdnUrl) throw new Error('Video generation completed but missing CDN url');

      const requestedSeconds = AIHubService.safeInt(request.seconds, 4);
      const actualDuration = AIHubService.safeInt(video?.seconds, requestedSeconds);

      console.log(`Video generated: ${cdnUrl}`);

      return {
        url: cdnUrl,
        model: request.model,
        duration: actualDuration,
        revised_prompt: video?.revised_prompt,
      };
    } catch (e) {
      console.error('genvideo error:', e);
      throw e;
    }
  }

  // ------------------------------------------------------------------
  // Audio (TTS + transcription)
  // ------------------------------------------------------------------
  private static getVoice(model: string, gender: string): string {
    return VOICE_MAP[`${model}|${gender}`] ?? DEFAULT_VOICE[gender] ?? 'alloy';
  }

  async genaudio(request: GenAudioRequest): Promise<GenAudioResponse> {
    try {
      const client = this.requireAiClient();
      const voice = AIHubService.getVoice(request.model, request.gender);

      console.log(`Audio generation started: model=${request.model}, gender=${request.gender}, voice=${voice}`);

      const resp: any = await observeExternalHttp(
        client.audio.speech.create({
          model: request.model,
          input: request.text,
          voice: voice as any,
          response_format: 'mp3',
        })
      );

      const cdnUrl = await AIHubService.extractCdnUrl(resp);
      if (!cdnUrl) {
        console.warn('Failed to extract CDN URL from audio response');
        throw new Error('Audio generation completed but missing CDN url');
      }

      console.log(`Audio generated: ${cdnUrl}`);

      return { url: cdnUrl, model: request.model, gender: request.gender, voice };
    } catch (e) {
      console.error('genaudio error:', e);
      throw e;
    }
  }

  async transcribe(request: TranscribeAudioRequest): Promise<TranscribeAudioResponse> {
    const sourceName = AIHubService.getSourceName(request.audio, 'input_audio');
    const file = await this.audioStrToUploadFile(request.audio, 'input_audio');

    try {
      const client = this.requireAiClient();
      console.log(`Audio transcription started: model=${request.model}, source=${sourceName}`);

      const resp = await observeExternalHttp(
        client.audio.transcriptions.create({
          file: await toFile(file.buffer, file.name),
          model: request.model,
          response_format: 'json',
        })
      );

      const text = AIHubService.extractTranscriptionText(resp);
      if (!text) throw new Error('Audio transcription completed but missing text in response');

      console.log(`Audio transcribed: ${sourceName}`);

      return { text, model: request.model, source_name: sourceName };
    } catch (e) {
      console.error('transcribe error:', e);
      throw e;
    } finally {
      // NOTE: Python closes a real file handle here. Buffers need no cleanup —
      // this finally block is kept only to mirror the source's structure and
      // as the natural place to add cleanup if uploads ever move to streamed
      // temp files instead of in-memory Buffers.
    }
  }
}