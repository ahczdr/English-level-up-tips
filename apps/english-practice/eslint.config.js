import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['src/**/*.vue', 'tests/**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
      globals: {
        Blob: 'readonly',
        URL: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        sessionStorage: 'readonly',
        location: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        Event: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
      },
    },
  },
  {
    files: ['**/*.vue'],
    rules: {
      ...tseslint.configs.recommended[0].rules,
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.{ts,vue}', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'vue/multi-word-component-names': 'off',
    },
  },
)
