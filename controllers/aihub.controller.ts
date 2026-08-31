// src/controllers/aihub.controller.ts
import { Request, Response } from 'express';
import { AppError } from '../middleware/error-handler.ts';
import {
  AIHubService,
  InvalidAudioInputError,
  InvalidImageInputError,
  InvalidPdfInputError,
} from '../services/aihub.service.ts'; // pending: services/aihub.py not yet sent

function tryExtractMessage(data: Record<string, unknown>): string | null {
  if (data.error && typeof data.error === 'object') {
    const inner = (data.error as Record<string, unknown>).message;
    if (typeof inner === 'string') return inner;
  }
  if (typeof data.message === 'string') return data.message;
  return null;
}

function tryParseDict(s: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* fall through */
  }
  return null;
  // Note: Python's ast.literal_eval (single-quote dict) fallback dropped — no JS analog needed.
}

function extractErrorMessage(error: unknown): string {
  const errorStr = error instanceof Error ? error.message : String(error);

  const direct = tryParseDict(errorStr);
  if (direct) {
    const message = tryExtractMessage(direct);
    if (message) return message;
  }

  const start = errorStr.indexOf('{');
  const end = errorStr.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const dictStr = errorStr.slice(start, end + 1);
    const parsed = tryParseDict(dictStr);
    if (parsed) {
      const message = tryExtractMessage(parsed);
      if (message) return message;
    }
  }

  return errorStr;
}

function mapUnexpected(e: unknown, action: string): never {
  console.error(`${action} failed:`, e);
  if (e instanceof Error && e.constructor.name === 'ValueError') {
    throw new AppError(503, 'SERVICE_UNAVAILABLE', extractErrorMessage(e));
  }
  throw new AppError(500, 'INTERNAL_ERROR', extractErrorMessage(e));
}

export async function generateText(req: Request, res: Response): Promise<void> {
  const service = new AIHubService();
  try {
    if (req.body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      try {
        for await (const content of service.gentxtStream(req.body)) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      } catch (e) {
        console.error('Stream error:', e);
        res.write(`data: ${JSON.stringify({ content: `[ERROR] ${extractErrorMessage(e)}` })}\n\n`);
      } finally {
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return;
    }
    res.status(200).json(await service.gentxt(req.body));
  } catch (e) {
    mapUnexpected(e, 'Text generation');
  }
}

export async function generateImage(req: Request, res: Response): Promise<void> {
  const service = new AIHubService();
  try {
    res.status(200).json(await service.genimg(req.body));
  } catch (e) {
    if (e instanceof InvalidImageInputError) throw new AppError(400, 'INVALID_IMAGE_INPUT', e.message);
    mapUnexpected(e, 'Image generation');
  }
}

export async function generateVideo(req: Request, res: Response): Promise<void> {
  const service = new AIHubService();
  try {
    res.status(200).json(await service.genvideo(req.body));
  } catch (e) {
    if (e instanceof InvalidImageInputError) throw new AppError(400, 'INVALID_IMAGE_INPUT', e.message);
    mapUnexpected(e, 'Video generation');
  }
}

export async function generateAudio(req: Request, res: Response): Promise<void> {
  const service = new AIHubService();
  try {
    res.status(200).json(await service.genaudio(req.body));
  } catch (e) {
    mapUnexpected(e, 'Audio generation');
  }
}

export async function transcribeAudio(req: Request, res: Response): Promise<void> {
  const service = new AIHubService();
  try {
    res.status(200).json(await service.transcribe(req.body));
  } catch (e) {
    if (e instanceof InvalidAudioInputError || (e instanceof Error && e.name === 'FileNotFoundError')) {
      throw new AppError(400, 'INVALID_AUDIO_INPUT', (e as Error).message);
    }
    mapUnexpected(e, 'Audio transcription');
  }
}

export async function analyzePdf(req: Request, res: Response): Promise<void> {
  const service = new AIHubService();
  try {
    res.status(200).json(await service.analyzePdf(req.body));
  } catch (e) {
    if (e instanceof InvalidPdfInputError) throw new AppError(400, 'INVALID_PDF_INPUT', e.message);
    mapUnexpected(e, 'PDF analysis');
  }
}