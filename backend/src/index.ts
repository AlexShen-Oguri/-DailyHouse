import './bootstrapEnv';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPersonalApp } from './personal/app';
import { PersonalStore } from './personal/store';
import { InspirationStore } from './personal/inspiration-store';
import { ReadingClassificationService } from './personal/reading-classification-service';
import { ProjectResumeService } from './personal/project-resume';
import { ReadingCollectionService } from './personal/reading-collection';
import { CodexReadingClient } from './personal/codex-reading-client';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.WORKBENCH_DATA_DIR || resolve(moduleDir, '../data');
const port = Number(process.env.PORT || 3456);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid workbench port');

// Personal data is separate from the preserved third-party SQLite database.
// Retired third-party connectors and schedulers are never loaded.
const store = new PersonalStore(join(dataDirectory, 'personal-workbench.json'));
const inspiration = new InspirationStore(join(dataDirectory, 'inspiration-garden.json'), store);
const classification = new ReadingClassificationService(store);
const projects = new ProjectResumeService(join(dataDirectory, 'project-resume.json'), inspiration);
const collectionFile = process.env.WORKBENCH_DATA_DIR ? join(dataDirectory, 'reading-collection.json') : resolve(moduleDir, '../../.runtime/reading-collection.json');
const collection: ReadingCollectionService = new ReadingCollectionService(collectionFile, store, {
  selector: new CodexReadingClient({ cwd: resolve(moduleDir, '../..'), conversationFile: join(dirname(collectionFile), 'reading-codex-conversation.json'), previousThreadId: () => collection.history().items.find(run => run.threadId)?.threadId }),
  extensionPath: resolve(moduleDir, '../../extensions/bilibili-reading'),
});
const app = createPersonalApp(store, resolve(moduleDir, '../../frontend/dist'), port, inspiration, { classification, projects, collection });
const server = app.listen(port, '127.0.0.1', () => {
  classification.resume();
  console.log(`日常小院已启动: http://127.0.0.1:${port}`);
});
function shutdown() { collection.close(); projects.close(); void classification.stop().finally(() => server.close()); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
