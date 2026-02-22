import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'src/pages/CrmSalesWorkbench.tsx',
    'src/pages/ServiceRepairWorkbench.tsx',
    'src/pages/InventoryWarehouseWorkbench.tsx',
    'src/pages/FinanceReportingWorkbench.tsx',
    'src/pages/PlatformServicesWorkbench.tsx',
    'src/pages/SectionPage.tsx',
    'src/pages/DashboardPage.tsx',
    'src/pages/ReadinessPage.tsx',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
