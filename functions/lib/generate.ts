import OpenAI from 'openai'
import { env } from '@functions/lib/env'

/**
 * Image generation through Neon AI Gateway, using the OpenAI Responses API dialect
 * (`/openai/v1`). No provider keys: the gateway token is injected per branch.
 */
const client =
  env.NEON_AI_GATEWAY_TOKEN && env.NEON_AI_GATEWAY_BASE_URL
    ? new OpenAI({
        apiKey: env.NEON_AI_GATEWAY_TOKEN,
        baseURL: `${env.NEON_AI_GATEWAY_BASE_URL}/openai/v1`,
      })
    : null

export async function generateHeadshot(input: { selfie: Buffer; mimeType: string; prompt: string }): Promise<Buffer> {
  if (!client) throw new Error('AI Gateway is not enabled on this branch (aiGateway: true)')

  const stream = client.responses.stream({
    model: env.IMAGE_MODEL,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: input.prompt },
          {
            type: 'input_image',
            image_url: `data:${input.mimeType};base64,${input.selfie.toString('base64')}`,
            detail: 'high',
          },
        ],
      },
    ],
    tools: [{ type: 'image_generation', output_format: 'jpeg', size: '1024x1024', quality: 'high' }],
    tool_choice: { type: 'image_generation' },
  })

  const response = await stream.finalResponse()
  for (const item of response.output) {
    if (item.type === 'image_generation_call' && typeof item.result === 'string') {
      return Buffer.from(item.result, 'base64')
    }
  }
  throw new Error(`model ${env.IMAGE_MODEL} returned no image`)
}
