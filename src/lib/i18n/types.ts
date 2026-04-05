export type Locale = 'en' | 'nl'

export type MessageValue =
  | string
  | ((params?: Record<string, string | number | undefined>) => string)

export type MessageDictionary = Record<string, MessageValue>
