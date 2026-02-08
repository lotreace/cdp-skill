import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function datasetReloadPlugin() {
  return {
    name: 'dataset-reload',
    configureServer(server) {
      const dataPath = path.resolve(__dirname, 'data/dataset.json');
      server.watcher.add(dataPath);
      server.watcher.on('change', (file) => {
        if (path.resolve(file) === dataPath) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
    closeBundle() {
      // Copy data/dataset.json into dist/ for production builds
      const src = path.resolve(__dirname, 'data/dataset.json');
      const dest = path.resolve(__dirname, 'dist/data/dataset.json');
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }
  };
}

export default defineConfig({
  plugins: [datasetReloadPlugin()],
  publicDir: false,
  server: { open: true }
});
