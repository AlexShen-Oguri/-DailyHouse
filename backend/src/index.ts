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
import { JournalStore } from './personal/journal';
import { DevelopmentToolsService } from './personal/development-tools';
import { PrivateSyncService, readSyncDevice } from './personal/private-sync';
import { SharedProjectStore } from './personal/shared-projects';
import { createSyncSource } from './personal/sync-source';
import { SupabaseSyncTransport } from './personal/supabase-sync';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.WORKBENCH_DATA_DIR || resolve(moduleDir, '../data');
const port = Number(process.env.PORT || 3456);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid workbench port');

// Personal data is separate from the preserved third-party SQLite database.
// Retired third-party connectors and schedulers are never loaded.
const store = new PersonalStore(join(dataDirectory, 'personal-workbench.json'));
const journal = new JournalStore(join(dataDirectory, 'work-journal.json'));
const inspiration = new InspirationStore(join(dataDirectory, 'inspiration-garden.json'), store);
const classification = new ReadingClassificationService(store);
const tools = new DevelopmentToolsService();
const projects = new ProjectResumeService(join(dataDirectory, 'project-resume.json'), inspiration, { developmentTools: tools });
// The sync sidecar owns a stable device identity. No old records are replaced on startup.
let sync: PrivateSyncService;
const device = readSyncDevice(join(dataDirectory, 'private-sync.json'));
const sharedProjects = new SharedProjectStore(join(dataDirectory, 'shared-projects.json'), join(dataDirectory, 'device-project-links.json'), device, projects, tools, record => sync.provenance(record));
const source = createSyncSource({ store, inspiration, journal, projects: sharedProjects, dataDirectory });
const cloudUrl = process.env.DAILYHOUSE_SUPABASE_URL;
const cloudKey = process.env.DAILYHOUSE_SUPABASE_PUBLISHABLE_KEY;
if (Boolean(cloudUrl) !== Boolean(cloudKey)) throw new Error('Private sync configuration is incomplete. Set both Supabase settings or leave both unset.');
const transport = cloudUrl && cloudKey ? new SupabaseSyncTransport({ url: cloudUrl, publishableKey: cloudKey, credentialsFile: join(dataDirectory, 'sync-credentials.local.json') }, device.id) : undefined;
sync = new PrivateSyncService(join(dataDirectory, 'private-sync.json'), source, transport, device);
const collectionFile = process.env.WORKBENCH_DATA_DIR ? join(dataDirectory, 'reading-collection.json') : resolve(moduleDir, '../../.runtime/reading-collection.json');
const collection: ReadingCollectionService = new ReadingCollectionService(collectionFile, store, {
  selector: new CodexReadingClient({ cwd: resolve(moduleDir, '../..'), conversationFile: join(dirname(collectionFile), 'reading-codex-conversation.json'), previousThreadId: () => collection.history().items.find(run => run.threadId)?.threadId }),
  extensionPath: resolve(moduleDir, '../../extensions/bilibili-reading'),
});
const app = createPersonalApp(store, resolve(moduleDir, '../../frontend/dist'), port, inspiration, { classification, projects, collection, journal, tools, sync, sharedProjects });
const server = app.listen(port, '127.0.0.1', () => {
  classification.resume();
  sync.start();
  console.log(`日常小院已启动: http://127.0.0.1:${port}`);
});
function shutdown() { sync.close(); collection.close(); projects.close(); void classification.stop().finally(() => server.close()); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
