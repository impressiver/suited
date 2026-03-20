# Build changes

1. **Dependencies (Ink + React already installed):**
   ```
   # Already in package.json — do not re-install:
   # ink ^6.8.0, react ^19.2.4, ink-text-input ^6.0.0
   #
   # Add dev deps when first Ink integration test lands:
   pnpm add -D @types/react
   pnpm add -D @inkjs/testing-library  # NOT the old "ink-testing-library" (v1.x, Ink 3/4 era)
   # Verify @inkjs/testing-library works with Ink 6 + React 19 before committing.
   # If unavailable or broken, fall back to direct render() + lastFrame() snapshot testing.
   ```

   **Testing library note:** `ink-testing-library` on npm (v1.x) was built for Ink 3/4. Ink 5+ uses `@inkjs/testing-library`. Verify the package name and version at install time. If neither works with React 19, use Ink's `render()` directly with `vi.useFakeTimers()`.

2. `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "jsx": "react-jsx",
       "jsxImportSource": "react"
     }
   }
   ```
   With `moduleResolution: NodeNext` and React 19 ESM, `react/jsx-runtime` resolves correctly. If TypeScript reports resolution errors, check that `@types/react` version matches the installed `react` major.

3. Extend Vitest `include` to `['src/**/*.test.ts', 'src/**/*.test.tsx']`.

4. **Biome v2:** TSX is supported natively. However, verify `biome.json` does not need a JSX config addition. If Biome reports JSX parse errors on `.tsx` files, add:
   ```json
   {
     "javascript": {
       "jsxRuntime": "reactClassic"
     }
   }
   ```

5. Existing build script (`tsc && cp -r src/templates dist/templates`) is unchanged. The TUI is pure TypeScript — no additional asset copy step is needed. If Phase A uses subprocess delegation, `argv[1]` must resolve to `dist/commands/flow.js` after compilation; verify the path in the delegation code before shipping.
