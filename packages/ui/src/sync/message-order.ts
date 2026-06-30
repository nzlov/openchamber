import type { Message } from "@/lib/codex/types"

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const getCreatedTime = (message: Message): number => {
  const created = (message.time as { created?: unknown } | undefined)?.created
  return typeof created === "number" && Number.isFinite(created) ? created : 0
}

export const compareMessages = (left: Message, right: Message): number => {
  const createdDiff = getCreatedTime(left) - getCreatedTime(right)
  if (createdDiff !== 0) return createdDiff
  return cmp(left.id, right.id)
}

export const findMessageIndexById = (messages: readonly Message[], messageID: string): number => (
  messages.findIndex((message) => message.id === messageID)
)

export const sortMessages = (messages: readonly Message[]): Message[] => (
  [...messages].sort(compareMessages)
)

export function ensureMessagesOrdered(messages: readonly Message[]): Message[] {
  for (let index = 1; index < messages.length; index += 1) {
    if (compareMessages(messages[index - 1], messages[index]) > 0) {
      return sortMessages(messages)
    }
  }
  return messages as Message[]
}

export function insertMessageOrdered(messages: readonly Message[], message: Message): Message[] {
  return sortMessages([...messages, message])
}

export function mergeMessages(a: readonly Message[], b: readonly Message[]): Message[] {
  const existing = new Map(a.map((item) => [item.id, item] as const))
  let changed = false
  for (const item of b) {
    if (!existing.has(item.id)) {
      existing.set(item.id, item)
      changed = true
    }
  }
  if (!changed) return ensureMessagesOrdered(a)
  return sortMessages([...existing.values()])
}
