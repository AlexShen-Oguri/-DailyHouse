import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/AppShell';
import { WorkspaceProvider } from './personal/Workspace';
import { HomePage, TodosPage, KnowledgePage, SettingsPage } from './personal/pages';
import ReadingPage from './personal/Reading';
import IdeasPage from './personal/Ideas';
import IdeaDetailPage from './personal/IdeaDetail';
import ProjectsPage from './personal/Projects';
import { PomodoroProvider } from './personal/Pomodoro';
import LearningPage, { LearningDetailPage } from './personal/Learning';
import JournalPage, { JournalDetailPage } from './personal/Journal';

export default function App() {
  return (
    <PomodoroProvider><WorkspaceProvider><Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/todos" element={<TodosPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/reading" element={<ReadingPage />} />
        <Route path="/learning" element={<LearningPage />} />
        <Route path="/learning/:id" element={<LearningDetailPage />} />
        <Route path="/journal" element={<JournalPage />} />
        <Route path="/journal/:date" element={<JournalDetailPage />} />
        <Route path="/ideas" element={<IdeasPage />} />
        <Route path="/ideas/:id" element={<IdeaDetailPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/workflow" element={<Navigate to="/ideas" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes></WorkspaceProvider></PomodoroProvider>
  );
}
