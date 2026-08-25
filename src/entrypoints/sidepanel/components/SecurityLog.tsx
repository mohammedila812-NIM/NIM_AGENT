import React, { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, Ban, Info, Trash2 } from 'lucide-react';
import { loadSecurityLog, clearSecurityLog, type SecurityLogEntry } from '../../../lib/security/audit-log';

export const SecurityLog: React.FC = () => {
  const [logs, setLogs] = useState<SecurityLogEntry[]>([]);

  const fetchLogs = async () => {
    const data = await loadSecurityLog();
    setLogs(data.reverse()); // most recent first
  };

  useEffect(() => {
    void fetchLogs();
  }, []);

  const handleClear = async () => {
    await clearSecurityLog();
    setLogs([]);
  };

  const renderBadge = (event: SecurityLogEntry['event']) => {
    switch (event.type) {
      case 'injection_detected':
        return (
          <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded text-[10px] font-semibold flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" /> Injection Blocked
          </span>
        );
      case 'action_blocked':
        return (
          <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded text-[10px] font-semibold flex items-center gap-1">
            <Ban className="w-3 h-3" /> Action Blocked
          </span>
        );
      case 'action_warned':
        return (
          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[10px] font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> HITL Warning
          </span>
        );
      case 'sender_rejected':
        return (
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded text-[10px] font-semibold flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" /> Sender Rejected
          </span>
        );
      case 'out_of_scope_domain':
        return (
          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[10px] font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Scope Warning
          </span>
        );
      case 'cost_limit_hit':
        return (
          <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded text-[10px] font-semibold flex items-center gap-1">
            <Info className="w-3 h-3" /> Budget Ceiling
          </span>
        );
      case 'tool_validation_error':
        return (
          <span className="px-2 py-0.5 bg-slate-500/20 text-slate-300 border border-slate-500/40 rounded text-[10px] font-semibold flex items-center gap-1">
            <Info className="w-3 h-3" /> Schema Error
          </span>
        );
    }
  };

  const renderDetails = (event: SecurityLogEntry['event']) => {
    switch (event.type) {
      case 'injection_detected':
        return (
          <div>
            <p className="text-xs text-rose-200">
              Source: <span className="font-mono text-slate-300">{event.url}</span>
            </p>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">Payload: {event.snippet}</p>
          </div>
        );
      case 'action_blocked':
        return (
          <p className="text-xs text-slate-300">
            Blocked: <span className="font-mono text-rose-300">{event.action}</span> — {event.reason}
          </p>
        );
      case 'action_warned':
        return (
          <p className="text-xs text-slate-300">
            Action: <span className="font-mono text-amber-300">{event.action}</span> ({event.reason})
          </p>
        );
      case 'sender_rejected':
        return (
          <p className="text-xs text-slate-300 font-mono">
            Rejected Sender ID: {event.senderId} (Port: {event.portName ?? 'n/a'})
          </p>
        );
      case 'out_of_scope_domain':
        return (
          <p className="text-xs text-slate-300">
            Domain: <span className="font-mono text-amber-300">{event.domain}</span> (Task: {event.taskId})
          </p>
        );
      case 'cost_limit_hit':
        return <p className="text-xs text-slate-300">{event.detail}</p>;
      case 'tool_validation_error':
        return <p className="text-xs text-slate-400 font-mono">{event.errors}</p>;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand-400">
          <ShieldCheck className="w-4 h-4" />
          <span>Security & Audit Log</span>
        </div>
        {logs.length > 0 && (
          <button
            onClick={handleClear}
            className="p-1 text-slate-500 hover:text-rose-400 transition"
            title="Clear Audit Log"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-6 text-center space-y-2">
          <ShieldCheck className="w-8 h-8 text-brand-500 mx-auto" />
          <p className="text-sm font-medium text-slate-300">Clean Audit Log</p>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Zero security violations detected. Indirect prompt injections, unapproved domain navigations, and sender rejections will be recorded here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {logs.map((item) => (
            <div
              key={item.id}
              className="bg-slate-800/70 border border-slate-700/80 rounded-xl p-3 space-y-1.5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                {renderBadge(item.event)}
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="pt-0.5">{renderDetails(item.event)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
