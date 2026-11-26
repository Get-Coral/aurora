export type Locale = "en" | "nl";

export type MessageParams = Record<string, string | number | undefined>;

export type MessageValue = string | ((params?: MessageParams) => string);

export type MessageDictionary = Record<string, MessageValue>;
