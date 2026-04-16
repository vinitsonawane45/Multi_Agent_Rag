// Type definitions for Multi-Agent RAG UI — Advanced

export type SourceItem = {
  score: number;
  text: string;
  source: string;
  chunk_id: number | null;
};

export type Health = {
  status: string;
  redis: boolean;
  qdrant: boolean;
  ollama_ok?: boolean;
  groq_configured?: boolean;
  qdrant_mode?: string;
  ollama_model: string;
  ollama_base_url: string;
  groq_model?: string;
  hints?: string[];
};

export type ChatResponse = {
  answer: string;
  grounded: boolean | null;
  sources: SourceItem[];
  trace: string[];
  critic_issues: string;
};

export type ChatMessage =
  | { role: "user"; content: string; timestamp: number }
  | {
      role: "assistant";
      content: string;
      timestamp: number;
      meta: Pick<ChatResponse, "sources" | "trace" | "grounded" | "critic_issues">;
    };

// Agent activity types
export type AgentStatus = "idle" | "searching" | "planning" | "analyzing" | "supervising" | "responding" | "complete";

export type AgentActivity = {
  id: string;
  name: string;
  status: AgentStatus;
  progress: number;
  message?: string;
  startedAt?: number;
  completedAt?: number;
};

export type AgentTrace = {
  phase: string;
  status: "pending" | "running" | "completed" | "error";
  duration?: number;
  details?: string;
};

// History types
export type ConversationSession = {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: number;
  preview: string;
};

// Settings types
export type Theme = "dark" | "light" | "system";

export type AppSettings = {
  theme: Theme;
  showAgentPanel: boolean;
  autoScroll: boolean;
  streamResponses: boolean;
  maxHistorySessions: number;
};

// Streaming types
export type StreamEvent =
  | { type: "phase_start"; phase: string; timestamp: number }
  | { type: "phase_end"; phase: string; duration: number; timestamp: number }
  | { type: "token"; content: string; timestamp: number }
  | { type: "sources"; sources: SourceItem[]; timestamp: number }
  | { type: "complete"; answer: string; grounded: boolean; critic_issues: string; timestamp: number }
  | { type: "error"; message: string; timestamp: number };

// Stats types
export type SessionStats = {
  totalQueries: number;
  avgResponseTime: number;
  groundedPercentage: number;
  avgTokensPerResponse: number;
};

export type AgentStats = {
  memory_load: { count: number; avgDuration: number };
  retriever_agent: { count: number; avgDuration: number };
  coder_agent: { count: number; avgDuration: number };
  critic_agent: { count: number; avgDuration: number };
};

// Toast notification types
export type ToastType = "success" | "error" | "warning" | "info";

export type Toast = {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
};
