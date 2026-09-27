import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/AppShell';
import { WorkspaceProvider } from './personal/Workspace';
import { HomePage, TodosPage, KnowledgePage, FinancePage, SettingsPage } from './personal/pages';
import ReadingPage from './personal/Reading';
import WorkflowPage from './personal/Workflow';

export default function App() {
  return (
    <WorkspaceProvider><Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/todos" element={<TodosPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/reading" element={<ReadingPage />} />
        <Route path="/workflow" element={<WorkflowPage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes></WorkspaceProvider>
  );
}
