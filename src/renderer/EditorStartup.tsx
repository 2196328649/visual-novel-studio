import { useEffect, useState } from 'react';
import type { ProjectHubInfo, ProjectSession } from '../core/bridge';
import { createProject } from '../core/model';
import { errorMessage } from '../core/error-message';
import App from './App';
import { ProjectBrowser } from './ProjectBrowser';

export function EditorStartup() {
  const [info, setInfo] = useState<ProjectHubInfo>();
  const [session, setSession] = useState<ProjectSession>();
  const [error, setError] = useState('');
  const bridge = window.studio;
  useEffect(() => { if (!bridge?.getProjectHub) return; let active = true; void bridge.getProjectHub().then(value => { if (active) { setInfo(value); if (value.direct) setSession(value.direct); } }).catch(error => { if (active) setError(errorMessage(error)); }); return () => { active = false; }; }, [bridge]);
  useEffect(() => { if (session || !bridge?.getProjectHub) return; return bridge.onCloseRequested?.(() => ({ project: createProject(), dirty: false })); }, [bridge, session]);
  if (!bridge?.getProjectHub) return <App />;
  if (session) return <App initialSession={session} />;
  if (error) return <div className="project-startup-error"><h1>未能打开项目窗口</h1><p role="alert">{error}</p><button className="small-button" onClick={() => location.reload()}>重试</button></div>;
  if (!info) return <div className="project-startup-error" role="status">正在读取项目列表…</div>;
  return <ProjectBrowser bridge={bridge} initial={info} onOpen={setSession} />;
}
