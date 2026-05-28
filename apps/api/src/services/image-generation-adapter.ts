import type { ModelConfig } from '@wecom-platform/types'

export class ImageGenerationError extends Error {
  constructor(message: string, public code: 'failed' | 'timeout' | 'rate_limited' | 'content_safety' | 'bad_response') {
    super(message)
  }
}

export interface ImageGenerationResult {
  bytes: Buffer
  mimeType: string
  extension: string
  cost?: number | null
}

export async function generateImageWithModel(model: ModelConfig, prompt: string): Promise<ImageGenerationResult> {
  const baseUrl = model.baseUrl?.replace(/\/+$/, '')
  if (!baseUrl) throw new ImageGenerationError('Image model baseUrl is not configured', 'failed')
  if (!model.apiKey) throw new ImageGenerationError('Image model apiKey is not configured', 'failed')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), model.timeoutMs ?? 120_000)
  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${model.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model.modelName,
        prompt,
        response_format: 'b64_json',
        ...model.defaultParams,
      }),
      signal: controller.signal,
    })

    const bodyText = await response.text()
    const body = parseJson(bodyText)
    if (!response.ok) {
      const message = body?.error?.message ?? bodyText ?? `Image generation failed with status ${response.status}`
      if (response.status === 429) throw new ImageGenerationError(message, 'rate_limited')
      if (/content|safety|policy|moderation/i.test(message)) throw new ImageGenerationError(message, 'content_safety')
      throw new ImageGenerationError(message, 'failed')
    }

    const item = Array.isArray(body?.data) ? body.data[0] : null
    if (item?.b64_json) {
      return {
        bytes: Buffer.from(item.b64_json, 'base64'),
        mimeType: item.mime_type ?? 'image/png',
        extension: mimeExtension(item.mime_type ?? 'image/png'),
        cost: numberOrNull(body?.usage?.cost),
      }
    }
    if (item?.url) {
      const imageResponse = await fetch(item.url, { signal: controller.signal })
      if (!imageResponse.ok) throw new ImageGenerationError(`Failed to download generated image: ${imageResponse.status}`, 'bad_response')
      const arrayBuffer = await imageResponse.arrayBuffer()
      const mimeType = imageResponse.headers.get('content-type') ?? 'image/png'
      return {
        bytes: Buffer.from(arrayBuffer),
        mimeType,
        extension: mimeExtension(mimeType),
        cost: numberOrNull(body?.usage?.cost),
      }
    }
    throw new ImageGenerationError('Image model response did not include b64_json or url', 'bad_response')
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new ImageGenerationError('Image generation timed out', 'timeout')
    if (err instanceof ImageGenerationError) throw err
    throw new ImageGenerationError(err instanceof Error ? err.message : String(err), 'failed')
  } finally {
    clearTimeout(timeout)
  }
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function mimeExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  return '.png'
}
