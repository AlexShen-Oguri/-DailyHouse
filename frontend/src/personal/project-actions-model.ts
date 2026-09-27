export type ProjectActionThread = { id: string; title: string; url: string; latest?: { request: string } };
export type ProjectNextAction = {
  id: string; projectId: string; projectTitle: string; title: string; acceptance: string;
  thread?: { id: string; title: string; url: string };
  status: 'active' | 'blocked' | 'paused' | 'done'; reason: string; result: string;
  dueDate: string | null; createdAt: string; updatedAt: string; completedAt?: string;
  revision: number; todoId?: string; completions: { id: string; result: string; completedAt: string }[];
};
