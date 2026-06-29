#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const localesDir = path.join(__dirname, '../src/i18n/locales')

function getAllKeys(obj, prefix = '') {
  let keys = []
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      keys = keys.concat(getAllKeys(obj[key], fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

function validateLocales() {
  const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'))
  const locales = {}
  
  for (const file of files) {
    const locale = file.replace('.json', '')
    const filePath = path.join(localesDir, file)
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    locales[locale] = content
  }

  const enKeys = new Set(getAllKeys(locales.en))
  const missingByLocale = {}
  const extraByLocale = {}
  let hasErrors = false

  for (const [locale, content] of Object.entries(locales)) {
    if (locale === 'en') continue

    const localeKeys = new Set(getAllKeys(content))
    const missing = [...enKeys].filter(k => !localeKeys.has(k))
    const extra = [...localeKeys].filter(k => !enKeys.has(k))

    if (missing.length > 0) {
      missingByLocale[locale] = missing
      hasErrors = true
    }
    if (extra.length > 0) {
      extraByLocale[locale] = extra
      hasErrors = true
    }
  }

  if (hasErrors) {
    console.error('\n❌ Locale validation failed:\n')
    
    for (const [locale, missing] of Object.entries(missingByLocale)) {
      console.error(`${locale}: Missing keys:`)
      missing.forEach(key => console.error(`  - ${key}`))
    }

    for (const [locale, extra] of Object.entries(extraByLocale)) {
      console.error(`${locale}: Extra keys not in en.json:`)
      extra.forEach(key => console.error(`  - ${key}`))
    }

    process.exit(1)
  }

  console.log('✓ All locales have matching keys with en.json')
  process.exit(0)
}

validateLocales()
