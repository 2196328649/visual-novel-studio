import React from "react";
import { createRoot } from "react-dom/client";
import { EditorStartup } from './EditorStartup';
import { AiWindow } from './AiWindow';
import { UiPreviewWindow } from './UiPreviewWindow';
import "./styles.css";
import "./workbench-theme.css";
import "./workbench.css";
import "./play-workspace.css";
import './story-workspace.css';
import './editor-themes.css';
import './ui-preview-window.css';
import './editor-controls.css';
import { initializeEditorTheme } from './editor-theme';

initializeEditorTheme();

const assistantWindow = location.hash === '#ai-assistant';
const uiPreviewWindow = location.hash === '#ui-preview';
if (assistantWindow) document.body.classList.add('ai-window-body');
if (uiPreviewWindow) document.body.classList.add('ui-preview-window-body');

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {assistantWindow ? <AiWindow /> : uiPreviewWindow ? <UiPreviewWindow /> : <EditorStartup />}
  </React.StrictMode>,
);
