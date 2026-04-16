import { AgentActivity, AgentTrace } from "../types";

type AgentActivityPanelProps = {
  activities: AgentActivity[];
  traces: AgentTrace[];
  isVisible: boolean;
};

const AGENT_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  memory: {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>,
    color: "var(--agent-memory)"
  },
  retriever: {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>,
    color: "var(--agent-retriever)"
  },
  coder: {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"></path></svg>,
    color: "var(--agent-coder)"
  },
  critic: {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>,
    color: "var(--agent-critic)"
  },
  supervisor: {
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>,
    color: "var(--agent-supervisor)"
  },
};

export function AgentActivityPanel({ activities, traces, isVisible }: AgentActivityPanelProps) {
  if (!isVisible || activities.length === 0) return null;

  return (
    <div className="agent-activity-panel">
      <div className="agent-activity-header">
        <svg
          className="agent-activity-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent-primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <span className="agent-activity-title">Live Agent Pipeline</span>
      </div>

      <div className="agent-activities">
        {activities.map((activity) => {
          const config = AGENT_CONFIG[activity.id];
          const isComplete = activity.status === "complete";
          
          return (
            <div key={activity.id} className={`agent-activity-item ${activity.status}`}>
              <div className="agent-activity-info">
                <span className="agent-icon" style={{ color: isComplete ? "var(--success)" : config?.color }}>
                  {config?.icon}
                </span>
                <div className="agent-info">
                  <span className="agent-activity-name">{activity.name}</span>
                  <span className="agent-activity-status">{activity.status}</span>
                </div>
              </div>
              
              <div className="agent-progress-bar">
                <div 
                  className="agent-progress-fill" 
                  style={{ 
                    width: `${activity.progress}%`,
                    background: isComplete ? "var(--success)" : config?.color
                  }}
                ></div>
              </div>
              
              {activity.message && <div className="agent-activity-message">{activity.message}</div>}
            </div>
          );
        })}
      </div>

      {traces.length > 0 && (
        <div className="agent-traces">
          {traces.map((trace, i) => (
            <div key={i} className={`agent-trace-item ${trace.status}`}>
              <span className="agent-trace-phase">{trace.phase.replace("_", " ")}</span>
              {trace.duration && (
                <span className="agent-trace-duration">{trace.duration.toFixed(2)}s</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
