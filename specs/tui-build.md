# Build changes

1. Add dependencies:
   ```
   pnpm add ink react ink-text-input
   pnpm add -D @types/react ink-testing-library
   ```

2. `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "jsx": "react-jsx",
       "jsxImportSource": "react"
     }
   }
   ```

3. Extend Vitest `include` to `['src/**/*.test.ts', 'src/**/*.test.tsx']`.

4. Biome natively supports TSX (v2); no config change needed.

5. Existing build script (`tsc && cp -r src/templates dist/templates`) unchanged.
