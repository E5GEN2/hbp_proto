import { FlatCompat } from '@eslint/eslintrc';

// Next 15.5 deprecates `next lint` (gone in 16); the ESLint CLI reads this
// flat config instead — `pnpm lint`, run by CI (.github/workflows/quality.yml),
// not by `next build` (eslint.ignoreDuringBuilds in next.config.mjs keeps a
// lint rule from ever failing a production deploy). eslint-config-next 15 still
// ships legacy-format configs, hence FlatCompat.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'scripts/visual-diff/**', '.phaseb/**', 'src/generated/**'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Deliberate `any` at catch sites / Prisma payload seams (164 today) —
      // visible debt, not a deploy blocker. Tighten per-file, not globally.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Pages-router advice (`_document`); the App Router segment layouts link
      // Google Fonts on purpose (React 19 hoists the preconnects).
      '@next/next/no-page-custom-font': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
];

export default config;
