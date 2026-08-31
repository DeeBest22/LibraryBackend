import { z } from 'zod';

// ==================== Generate Text ====================

export const imageUrlSchema = z.object({
  url: z.string(),
});

export const contentPartTextSchema = z.object({
  type: z.string().default('text'),
  text: z.string(),
});

export const contentPartImageSchema = z.object({
  type: z.string().default('image_url'),
  image_url: imageUrlSchema,
});

export const chatMessageSchema = z.object({
  role: z.string(),
  content: z.union([
    z.string(),
    z.array(z.union([contentPartTextSchema, contentPartImageSchema])),
  ]),
});

export const genTxtRequestSchema = z.object({
  messages: z.array(chatMessageSchema),
  model: z.string().default('deepseek-v4-pro'),
  stream: z.boolean().default(false),
  temperature: z.number().optional().default(0.7),
  max_tokens: z.number().int().optional().default(4096),
});

export const genTxtResponseSchema = z.object({
  content: z.string(),
  model: z.string(),
  usage: z.record(z.any()).optional(),
});

// ==================== Generate Image ====================

export const genImgRequestSchema = z.object({
  prompt: z.string(),
  image: z.union([z.string(), z.array(z.string())]).optional(),
  model: z.string().default('gpt-image-2'),
  size: z.string().default('1024x1024'),
  quality: z.enum(['auto', 'hd']).default('auto'),
  n: z.number().int().default(1),
  response_format: z.string().default('url'),
});

export const genImgResponseSchema = z.object({
  images: z.array(z.string()),
  model: z.string(),
  revised_prompt: z.string().optional(),
});

// ==================== Generate Video ====================

export const genVideoRequestSchema = z.object({
  prompt: z.string(),
  image: z.string().optional(),
  model: z.string().default('wan2.6-t2v'),
  size: z.string().default('1280x720'),
  seconds: z.string().default('4'),
});

export const genVideoResponseSchema = z.object({
  url: z.string(),
  model: z.string(),
  duration: z.number().int(),
  revised_prompt: z.string().optional(),
});

// ==================== Generate Audio ====================

export const genAudioRequestSchema = z.object({
  text: z.string(),
  model: z.string().default('qwen3-tts-flash'),
  gender: z.enum(['male', 'female']).default('female'),
});

export const genAudioResponseSchema = z.object({
  url: z.string(),
  model: z.string(),
  gender: z.string(),
  voice: z.string(),
});

// ==================== Analyze PDF ====================

export const analyzePdfRequestSchema = z.object({
  pdf: z.string(),
  instruction: z.string(),
  mode: z.enum(['qa', 'extract']).default('qa'),
  page_start: z.number().int().default(1),
  page_end: z.number().int().optional(),
});

export const analyzePdfResponseSchema = z.object({
  status: z.string(),
  result: z.string(),
  message: z.string(),
  pdf_name: z.string(),
  mode: z.string(),
  model: z.string(),
  page_start: z.number().int(),
  page_end: z.number().int().optional(),
  total_pages: z.number().int().optional(),
  error_type: z.string().optional(),
});

// ==================== Transcribe Audio ====================

export const transcribeAudioRequestSchema = z.object({
  audio: z.string(),
  model: z.string().default('scribe_v2'),
});

export const transcribeAudioResponseSchema = z.object({
  text: z.string(),
  model: z.string(),
  source_name: z.string().optional(),
});

// ==================== Inferred TS types ====================

export type ImageUrl = z.infer<typeof imageUrlSchema>;
export type ContentPartText = z.infer<typeof contentPartTextSchema>;
export type ContentPartImage = z.infer<typeof contentPartImageSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type GenTxtRequest = z.infer<typeof genTxtRequestSchema>;
export type GenTxtResponse = z.infer<typeof genTxtResponseSchema>;
export type GenImgRequest = z.infer<typeof genImgRequestSchema>;
export type GenImgResponse = z.infer<typeof genImgResponseSchema>;
export type GenVideoRequest = z.infer<typeof genVideoRequestSchema>;
export type GenVideoResponse = z.infer<typeof genVideoResponseSchema>;
export type GenAudioRequest = z.infer<typeof genAudioRequestSchema>;
export type GenAudioResponse = z.infer<typeof genAudioResponseSchema>;
export type AnalyzePdfRequest = z.infer<typeof analyzePdfRequestSchema>;
export type AnalyzePdfResponse = z.infer<typeof analyzePdfResponseSchema>;
export type TranscribeAudioRequest = z.infer<typeof transcribeAudioRequestSchema>;
export type TranscribeAudioResponse = z.infer<typeof transcribeAudioResponseSchema>;