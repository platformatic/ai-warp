import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'
import unusedImports from 'eslint-plugin-unused-imports'

const baseConfig = neostandard({
  ts: true,
  ignores: resolveIgnoresFromGitignore()
})

export default [
  ...baseConfig,
  {
    plugins: {
      'unused-imports': unusedImports
    },
    rules: {
      // Turn off the base rule as it can report incorrect errors
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      // Use the unused-imports rules instead
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_'
        }
      ]
    }
  }
]
