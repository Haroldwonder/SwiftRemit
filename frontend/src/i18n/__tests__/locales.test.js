import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const localesDir = path.join(__dirname, '../locales')

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

describe('Locale Validation', () => {
  const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'))
  const locales = {}
  
  for (const file of files) {
    const locale = file.replace('.json', '')
    const filePath = path.join(localesDir, file)
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    locales[locale] = content
  }

  const enKeys = new Set(getAllKeys(locales.en))

  it('should have all locale files', () => {
    expect(Object.keys(locales)).toContain('en')
    expect(Object.keys(locales)).toContain('pt')
    expect(Object.keys(locales)).toContain('es')
    expect(Object.keys(locales)).toContain('fr')
  })

  describe('Portuguese (pt) locale', () => {
    it('should have all keys from English', () => {
      const ptKeys = new Set(getAllKeys(locales.pt))
      const missing = [...enKeys].filter(k => !ptKeys.has(k))
      expect(missing).toEqual([])
    })

    it('should not have extra keys not in English', () => {
      const ptKeys = new Set(getAllKeys(locales.pt))
      const extra = [...ptKeys].filter(k => !enKeys.has(k))
      expect(extra).toEqual([])
    })

    it('should have correct translations', () => {
      expect(locales.pt.app.title).toBe('SwiftRemit')
      expect(locales.pt.wallet.title).toBe('Carteira')
      expect(locales.pt.sendMoney.title).toBe('Enviar Dinheiro')
    })

    it('should have Portuguese-specific values', () => {
      expect(locales.pt.language.pt).toBe('Português')
      expect(locales.pt.app.subtitle).toContain('Remessas')
    })
  })

  describe('Spanish (es) locale', () => {
    it('should have all keys from English', () => {
      const esKeys = new Set(getAllKeys(locales.es))
      const missing = [...enKeys].filter(k => !esKeys.has(k))
      expect(missing).toEqual([])
    })

    it('should not have extra keys not in English', () => {
      const esKeys = new Set(getAllKeys(locales.es))
      const extra = [...esKeys].filter(k => !enKeys.has(k))
      expect(extra).toEqual([])
    })
  })

  describe('French (fr) locale', () => {
    it('should have all keys from English', () => {
      const frKeys = new Set(getAllKeys(locales.fr))
      const missing = [...enKeys].filter(k => !frKeys.has(k))
      expect(missing).toEqual([])
    })

    it('should not have extra keys not in English', () => {
      const frKeys = new Set(getAllKeys(locales.fr))
      const extra = [...frKeys].filter(k => !enKeys.has(k))
      expect(extra).toEqual([])
    })
  })

  describe('Structure validation', () => {
    it('should have all main sections', () => {
      const sections = ['app', 'wallet', 'sendMoney', 'language', 'kyc', 'dispute']
      for (const locale of Object.values(locales)) {
        for (const section of sections) {
          expect(locale).toHaveProperty(section)
        }
      }
    })

    it('should have error sections where applicable', () => {
      for (const locale of Object.values(locales)) {
        if (locale.wallet?.errors) {
          expect(typeof locale.wallet.errors).toBe('object')
        }
        if (locale.sendMoney?.errors) {
          expect(typeof locale.sendMoney.errors).toBe('object')
        }
      }
    })
  })

  describe('Translation completeness', () => {
    it('should not have empty strings in any locale', () => {
      for (const [localeCode, content] of Object.entries(locales)) {
        function checkEmpty(obj, path = '') {
          for (const [key, value] of Object.entries(obj)) {
            const fullPath = path ? `${path}.${key}` : key
            if (typeof value === 'string') {
              expect(value).not.toBe('', `Empty string in ${localeCode} at ${fullPath}`)
            } else if (typeof value === 'object' && value !== null) {
              checkEmpty(value, fullPath)
            }
          }
        }
        checkEmpty(content)
      }
    })
  })
})
