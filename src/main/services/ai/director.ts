/**
 * AI Creative Director.
 *
 * Claude reads the current OceanMixer project plus the conversation so far and
 * either replies conversationally or proposes a batch of EditOps via the
 * `apply_timeline_edits` tool. The renderer validates and applies the returned
 * ops through `applyOps` (see src/shared/project-utils.ts), so this module only
 * has to gather them faithfully — it does not mutate the project itself.
 *
 * Model/SDK notes (do not "modernize" these without checking the API):
 *   - Model id comes from settings (default 'claude-opus-4-8').
 *   - Adaptive thinking: `thinking: { type: 'adaptive' }` + `output_config: { effort: 'high' }`.
 *     Do NOT pass budget_tokens / temperature / top_p / top_k — they 400 on this model.
 *   - response.content is a discriminated union; narrow by block.type before access.
 *   - Tool loop runs at most 2 rounds: after a tool_use turn we append the
 *     assistant turn + tool_result(s) and ask once more for a natural-language
 *     summary, collecting ops from tool_use blocks across all rounds.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { AIChatRequest, AIChatResponse, AIMessage } from '@shared/ipc'
import type { EditOp } from '@shared/ai-ops'
import { summarizeProject } from '@shared/project-utils'
import { getAnthropicKey, getAuthMode, getSettings } from '../settings'
import { antAccessToken, OAUTH_BETA_HEADER } from './anthropicAuth'

/**
 * Decide which credential to authenticate with. Honors the user's chosen
 * authMode but falls back to whatever is actually available, so the Director
 * works as long as either an API key or an account login is present.
 */
type Credential =
  | { kind: 'apiKey'; apiKey: string }
  | { kind: 'oauth'; token: string }
  | { kind: 'none' }

async function resolveCredential(): Promise<Credential> {
  const mode = getAuthMode()
  const key = getAnthropicKey()
  if (mode === 'oauth') {
    const token = await antAccessToken()
    if (token) return { kind: 'oauth', token }
    if (key) return { kind: 'apiKey', apiKey: key }
    return { kind: 'none' }
  }
  if (key) return { kind: 'apiKey', apiKey: key }
  const token = await antAccessToken()
  if (token) return { kind: 'oauth', token }
  return { kind: 'none' }
}

/** Build an Anthropic client for the resolved credential. */
function makeClient(cred: Exclude<Credential, { kind: 'none' }>): Anthropic {
  if (cred.kind === 'oauth') {
    return new Anthropic({
      // OAuth bearer auth: Authorization: Bearer + the oauth beta header.
      // apiKey: null prevents the SDK from also sending a key from the env.
      apiKey: null,
      authToken: cred.token,
      defaultHeaders: { 'anthropic-beta': OAUTH_BETA_HEADER }
    })
  }
  return new Anthropic({ apiKey: cred.apiKey })
}

const DEFAULT_MODEL = 'claude-opus-4-8'
const MAX_TOKENS = 8000
const MAX_ROUNDS = 2

/** The single tool the Director may call to mutate the timeline. */
const APPLY_TOOL: Anthropic.Tool = {
  name: 'apply_timeline_edits',
  description:
    'Apply a batch of edit operations to the OceanMixer timeline. Use this to ' +
    'add/trim/split/move/remove clips, add text, set transitions/effects, ' +
    'reorder, change project settings. Each op is an object with an "op" field.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      explanation: {
        type: 'string',
        description: 'Brief explanation of the edits for the user.'
      },
      ops: {
        type: 'array',
        description: 'List of edit operations.',
        items: { type: 'object' }
      }
    },
    required: ['ops']
  }
}

/* ----------------------------------------------------------- system prompt */

function buildSystemPrompt(req: AIChatRequest): string {
  const summary = summarizeProject(req.project)
  const ctx: string[] = []
  if (req.selectedClipId) ctx.push(`Selected clip id: ${req.selectedClipId}`)
  if (typeof req.playheadSec === 'number') {
    ctx.push(`Playhead position: ${req.playheadSec.toFixed(2)}s`)
  }
  const contextBlock = ctx.length > 0 ? ctx.join('\n') : '(no selection; playhead at 0s)'

  return `You are the Creative Director inside OceanMixer, a local AI-assisted
video/image/music editor. You help the user edit a timeline by reasoning over
the current project state and, when concrete changes are warranted, calling the
\`apply_timeline_edits\` tool with a batch of edit operations.

# How to behave
- If the user simply chats, asks a question, or wants advice, reply in natural
  language WITHOUT calling the tool.
- If the user asks for concrete changes ("trim this", "add a title", "fade
  between the first two clips", "make it 9:16", "speed up clip X"), prefer doing
  the edits by calling \`apply_timeline_edits\` with a precise \`ops\` array, and
  set a short \`explanation\`.
- Never invent ids. Only use \`assetId\` values from the MEDIA POOL and existing
  \`trackId\`/\`clipId\` values from the TIMELINE below. To target a track you are
  creating in the same batch, give the addTrack op a \`ref\` string (e.g.
  "$t1") and use that same string as the \`trackId\` of later ops in the batch.
- All times and durations are in SECONDS (floats). The timeline starts at 0.
- Tracks are listed bottom→top; index 0 is the bottom video layer. Video tracks
  composite top-down. Each track holds a single kind ('video' or 'audio').
- Keep batches minimal and ordered; later ops can reference \`ref\`s created by
  earlier ops in the same batch.

# Edit operations (\`ops\` items) — each is an object with an "op" field
- addTrack: { op:"addTrack", kind:"video"|"audio", name?:string, ref?:string }
    Append a new track. Use \`ref\` so later ops in the same batch can target it.
- removeTrack: { op:"removeTrack", trackId:string }
    Remove a track (an existing track id, or a $ref created earlier in the batch).
- addClip: { op:"addClip", trackId:string, assetId:string, start?:number,
    inPoint?:number, outPoint?:number, ref?:string }
    Place a media asset on a track. \`assetId\` MUST be an id from the MEDIA POOL.
    Omit \`start\` to append after the last clip on that track. \`inPoint\`/\`outPoint\`
    are source-trim seconds (default: full asset).
- addTextClip: { op:"addTextClip", trackId:string, start:number, duration:number,
    text:{ text:string, fontFamily?:string, fontSize?:number, color?:string,
    backgroundColor?:string, align?:"left"|"center"|"right", bold?:boolean,
    italic?:boolean }, transform?:{ x?:number, y?:number, scale?:number,
    rotation?:number, opacity?:number }, ref?:string }
    Add a text/title clip. \`text.text\` is required; other text fields are optional.
    Text clips go on video tracks. transform offsets are px from frame center.
- removeClip: { op:"removeClip", clipId:string }
- moveClip: { op:"moveClip", clipId:string, start:number, trackId?:string }
    Move a clip to a new start time, optionally onto another track.
- trimClip: { op:"trimClip", clipId:string, inPoint?:number, outPoint?:number,
    duration?:number }
    Adjust source trim and/or on-timeline duration (all in seconds).
- splitClip: { op:"splitClip", clipId:string, at:number }
    Split a clip at an ABSOLUTE timeline time (seconds) inside the clip's bounds.
- setClipProps: { op:"setClipProps", clipId:string, props:{ volume?:number(0..2),
    muted?:boolean, speed?:number(0.1..8), label?:string, color?:string,
    transform?:{ x?,y?,scale?,rotation?,opacity? },
    text?:{ text?,fontFamily?,fontSize?,color?,backgroundColor?,align?,bold?,italic? } } }
    Change clip properties. \`speed\` is a playback multiplier; \`volume\` 1 = unchanged.
- addEffect: { op:"addEffect", clipId:string, effect:{ type:"brightness"|
    "contrast"|"saturation"|"hue"|"gamma"|"blur"|"sharpen"|"grayscale"|"sepia"|
    "vignette"|"fadeIn"|"fadeOut", params:{ [name:string]:number }, enabled:boolean } }
    Add a parametric effect to a clip (the engine assigns the effect id).
- removeEffect: { op:"removeEffect", clipId:string, effectId:string }
- setTransition: { op:"setTransition", clipId:string, transition:{ type:"fade"|
    "dissolve"|"wipeleft"|"wiperight"|"slideup"|"slidedown"|"circleopen",
    durationSec:number } | null }
    Set (or clear, with null) the transition crossing INTO this clip from the
    previous clip on the same track.
- reorderClips: { op:"reorderClips", trackId:string, clipIdsInOrder:string[] }
    Repack the named clips sequentially from 0 in the given order on a track.
- setProjectSettings: { op:"setProjectSettings", settings:{ width?:number,
    height?:number, fps?:number, sampleRate?:number, backgroundColor?:string } }
    e.g. 9:16 vertical = { width:1080, height:1920 }.
- renameProject: { op:"renameProject", name:string }

# Current project state
CONTEXT:
${contextBlock}

${summary}`
}

/* ------------------------------------------------------------- op parsing */

interface ToolInput {
  explanation?: unknown
  ops?: unknown
}

/** Extract the ops array and optional explanation from a tool_use block input. */
function readToolInput(input: unknown): { ops: EditOp[]; explanation?: string } {
  if (typeof input !== 'object' || input === null) return { ops: [] }
  const obj = input as ToolInput
  const ops = Array.isArray(obj.ops) ? (obj.ops as unknown[]) : []
  // The ops are loosely typed here; the renderer validates each via applyOps.
  const editOps = ops.filter((o): o is EditOp => typeof o === 'object' && o !== null) as EditOp[]
  const explanation =
    typeof obj.explanation === 'string' && obj.explanation.trim().length > 0
      ? obj.explanation.trim()
      : undefined
  return { ops: editOps, explanation }
}

/* ----------------------------------------------------------- message types */

type Block = Anthropic.TextBlock | Anthropic.ToolUseBlock
type ConvMessage = Anthropic.MessageParam

function toConversation(messages: AIMessage[]): ConvMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }))
}

/* ---------------------------------------------------------------- the call */

export async function runDirector(req: AIChatRequest): Promise<AIChatResponse> {
  const cred = await resolveCredential()
  if (cred.kind === 'none') {
    return {
      reply:
        'No Anthropic credentials. Add an API key or log in with your Anthropic account in Settings to use the Creative Director.',
      ops: [],
      error: 'no-auth'
    }
  }

  const model = getSettings().aiModel || DEFAULT_MODEL

  try {
    const client = makeClient(cred)
    const system = buildSystemPrompt(req)

    const conversation: ConvMessage[] = toConversation(req.messages)

    const collectedOps: EditOp[] = []
    const explanations: string[] = []
    const textReplies: string[] = []
    let usageIn = 0
    let usageOut = 0

    for (let round = 0; round < MAX_ROUNDS; round++) {
      // The SDK shipped here predates adaptive thinking / output_config in its
      // TS types, but the API accepts these body fields; build then forward.
      const params = {
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: conversation,
        tools: [APPLY_TOOL],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' }
      } as unknown as Anthropic.MessageCreateParamsNonStreaming

      const response = await client.messages.create(params)

      usageIn += response.usage?.input_tokens ?? 0
      usageOut += response.usage?.output_tokens ?? 0

      const blocks = response.content as Block[]
      const toolUses: Anthropic.ToolUseBlock[] = []

      for (const block of blocks) {
        if (block.type === 'text') {
          const t = block.text.trim()
          if (t.length > 0) textReplies.push(t)
        } else if (block.type === 'tool_use' && block.name === APPLY_TOOL.name) {
          toolUses.push(block)
          const { ops, explanation } = readToolInput(block.input)
          if (ops.length > 0) collectedOps.push(...ops)
          if (explanation) explanations.push(explanation)
        }
      }

      // Model is done editing (or never started) — stop the loop.
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        break
      }

      // Last allowed round but the model still wants the tool: don't ask again,
      // we already have the ops; avoid an extra round-trip with no payoff.
      if (round === MAX_ROUNDS - 1) {
        break
      }

      // Feed tool results back so the model can produce a final summary turn.
      conversation.push({ role: 'assistant', content: blocks })
      conversation.push({
        role: 'user',
        content: toolUses.map<Anthropic.ToolResultBlockParam>((tu) => ({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ ok: true })
        }))
      })
    }

    const reply = composeReply(textReplies, explanations, collectedOps.length)

    return {
      reply,
      ops: collectedOps,
      model,
      usage: { inputTokens: usageIn, outputTokens: usageOut }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      reply: 'The Director hit an error: ' + msg,
      ops: [],
      error: msg
    }
  }
}

/** Build the user-facing reply from text blocks + tool explanations. */
function composeReply(
  textReplies: string[],
  explanations: string[],
  opCount: number
): string {
  // Prefer the model's natural-language text; fall back to the tool explanation.
  if (textReplies.length > 0) return textReplies.join('\n\n')
  if (explanations.length > 0) return explanations.join('\n\n')
  if (opCount > 0) {
    return `Applied ${opCount} edit${opCount === 1 ? '' : 's'} to the timeline.`
  }
  return 'Done.'
}
