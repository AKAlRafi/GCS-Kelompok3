import { useCallback, useEffect, useState } from 'react';
import { logApi } from '../services/api';

export default function FlightLogPanel() {
  const [activeLog, setActiveLog] = useState(null);
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [status, list] = await Promise.all([logApi.status(), logApi.list()]);
      setActiveLog(status.active ? status : null);
      setLogs(Array.isArray(list) ? list : list.logs ?? []);
    } catch (requestError) {
      setError(requestError.message || 'Could not load flight logs.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([logApi.status(), logApi.list()]).then(([status, list]) => {
      if (!active) return;
      setActiveLog(status.active ? status : null);
      setLogs(Array.isArray(list) ? list : list.logs ?? []);
    }).catch((requestError) => {
      if (active) setError(requestError.message || 'Could not load flight logs.');
    });
    return () => { active = false; };
  }, []);

  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      if (activeLog) {
        await logApi.stop();
      } else {
        await logApi.start('flight');
      }
      await refresh();
    } catch (requestError) {
      setError(requestError.message || 'Flight log request failed.');
    } finally {
      setBusy(false);
    }
  };

  const download = async (log) => {
    setError('');
    try {
      const response = await logApi.download(log.id);
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = log.file_name || `${log.name || 'flight-log'}.jsonl`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message || 'Could not download flight log.');
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-lg">
      <div className="flex items-center justify-between border-b border-slate-700 pb-3">
        <h2 className="text-sm font-bold tracking-wide text-slate-100">Flight Log</h2>
        <span className={`rounded-md border px-2.5 py-1 text-[10px] font-bold tracking-wider ${activeLog ? 'border-sky-700 bg-sky-950 text-sky-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>{activeLog ? 'RECORDING' : 'STOPPED'}</span>
      </div>
      <button disabled={busy} onClick={toggle}
        className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-40">
        {busy ? 'Processing…' : activeLog ? 'Stop Recording' : 'Start Recording'}
      </button>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {logs.length === 0 ? <p className="text-xs text-slate-500">No flight logs yet.</p> : logs.map((log) => (
          <button key={log.id} onClick={() => download(log)} className="block w-full truncate rounded-md border border-slate-700 bg-slate-800 px-3 py-2.5 text-left text-xs text-sky-300 hover:border-slate-500 hover:bg-slate-700">
            {log.name || log.file_name || `Flight log ${log.id}`}
          </button>
        ))}
      </div>
    </section>
  );
}
