import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // CLAUDE.md rules: the simulation is deterministic and knows nothing about render or the DOM.
    files: ['src/sim/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'src/sim must not import Three.js.' },
            {
              group: ['**/render/**', '**/ui/**', '**/audio/**', '**/camera/**'],
              message: 'src/sim must not depend on presentation layers.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use world.rng.' },
        { object: 'Date', property: 'now', message: 'Use the tick counter.' },
        { object: 'performance', property: 'now', message: 'Use the tick counter.' },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'performance',
        'requestAnimationFrame',
      ],
    },
  },
  {
    files: ['tests/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
