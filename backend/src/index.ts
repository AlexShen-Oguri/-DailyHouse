import './bootstrapEnv';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPersonalApp } from './personal/app';
import { PersonalStore } from './personal/store';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.WORKBENCH_DATA_DIR || resolve(moduleDir, '../data');
const port = Number(process.env.PORT || 3456);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid workbench port');

// Personal data is separate from the preserved third-party SQLite database.
// Retired connectors, AI clients and schedulers are never loaded.
const store = new PersonalStore(join(dataDirectory, 'personal-workbench.json'));
const app = createPersonalApp(store, resolve(moduleDir, '../../frontend/dist'), port);
app.listen(port, '127.0.0.1', () => console.log(`日常小院已启动: http://127.0.0.1:${port}`));
