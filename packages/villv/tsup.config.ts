import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client/client.ts',
  },
  format: ['cjs', 'esm'],
  outDir: 'dist',
  clean: true,
})
