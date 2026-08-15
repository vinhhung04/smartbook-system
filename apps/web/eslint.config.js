import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// These files predate the strict lint gate. Keep the exception list explicit so
// new files cannot introduce untyped API payloads without failing CI.
const legacyExplicitAnyFiles = [
  'src/components/ai-action-card.tsx',
  'src/components/ai-chatbot.tsx',
  'src/components/motion-utils.tsx',
  'src/components/pages/ai-assistant.tsx',
  'src/components/pages/audit-trail.tsx',
  'src/components/pages/borrow-loan-detail.tsx',
  'src/components/pages/borrow-loans.tsx',
  'src/components/pages/borrow-reservations.tsx',
  'src/components/pages/catalog.tsx',
  'src/components/pages/customer/_shared/fine-card.tsx',
  'src/components/pages/customer/_shared/fine-item.tsx',
  'src/components/pages/customer/_shared/loan-card.tsx',
  'src/components/pages/customer/_shared/loan-item.tsx',
  'src/components/pages/customer/_shared/notification-bell-dropdown.tsx',
  'src/components/pages/customer/_shared/notification-item.tsx',
  'src/components/pages/customer/_shared/notification-list-item.tsx',
  'src/components/pages/customer/_shared/reservation-card.tsx',
  'src/components/pages/customer/_shared/reservation-item.tsx',
  'src/components/pages/customer/catalog.tsx',
  'src/components/pages/customer/dashboard.tsx',
  'src/components/pages/customer/fines.tsx',
  'src/components/pages/customer/loan-detail.tsx',
  'src/components/pages/customer/loans.tsx',
  'src/components/pages/customer/notifications.tsx',
  'src/components/pages/customer/profile.tsx',
  'src/components/pages/customer/reading-analytics.tsx',
  'src/components/pages/customer/reservations.tsx',
  'src/components/pages/customer/wishlist.tsx',
  'src/components/pages/goods-receipt.tsx',
  'src/components/pages/receiving-smart.tsx',
  'src/components/pages/recommendations.tsx',
  'src/components/pages/reports.tsx',
  'src/lib/export-utils.ts',
  'src/lib/print-utils.ts',
  'src/services/ai.ts',
  'src/services/book.ts',
  'src/services/goods-receipt.ts',
  'src/services/receiving-smart.ts',
  'src/services/role.ts',
  'src/services/user.ts',
]

const mixedRefreshExportFiles = [
  'src/components/motion-utils.tsx',
  'src/components/ui/badge.tsx',
  'src/components/ui/button.tsx',
  'src/components/ui/form.tsx',
  'src/components/ui/navigation-menu.tsx',
  'src/components/ui/sidebar.tsx',
  'src/components/ui/toggle.tsx',
  'src/lib/i18n.tsx',
  'src/lib/socket.tsx',
  'src/lib/theme.tsx',
]

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^[A-Z_]',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'react-refresh/only-export-components': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/component-hook-factories': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/refs': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/purity': 'error',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/config': 'warn',
      'react-hooks/gating': 'warn',
    },
  },
  {
    files: legacyExplicitAnyFiles,
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: mixedRefreshExportFiles,
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
