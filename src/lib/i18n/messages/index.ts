import type { Locale, MessageDictionary } from '../types'
import { enMessages } from './en'
import { nlMessages } from './nl'

export const localeMessages: Record<Locale, MessageDictionary> = {
  en: enMessages,
  nl: nlMessages,
}

export const supportedLocales: Locale[] = ['en', 'nl']
