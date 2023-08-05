import typescriptEslintPlugin from '@typescript-eslint/eslint-plugin'
import typescriptEslintParser from '@typescript-eslint/parser'
import eslintJs from '@eslint/js'

/**
 * @type {import('eslint').Linter.FlatConfig[]}
 * @see https://stackoverflow.com/a/74819187
 */
const config = [
  eslintJs.configs.recommended,
  {
    languageOptions: {
      parser: typescriptEslintParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2021,
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslintPlugin,
    },
  },
  {
    rules: typescriptEslintPlugin.configs['eslint-recommended']?.overrides?.[0]?.rules,
  },
  {
    rules: typescriptEslintPlugin.configs?.['recommended']?.rules,
  },
]

export default config
