import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';
import { AgentManagerPanelProvider } from './AgentManagerPanelProvider';
import { SessionEditorPanelProvider } from './SessionEditorPanelProvider';
import { createCodexManager, type CodexManager } from './codex';
import { resolveWorkspaceFolders } from './workspaceResolver';

let chatViewProvider: ChatViewProvider | undefined;
let agentManagerProvider: AgentManagerPanelProvider | undefined;
let sessionEditorProvider: SessionEditorPanelProvider | undefined;
let codexManager: CodexManager | undefined;
let outputChannel: vscode.OutputChannel | undefined;

let activeSessionId: string | null = null;
let activeSessionTitle: string | null = null;

const t = vscode.l10n.t;

const CHAT_VIEW_BOOTSTRAP_DELAY_MS = 80;

const waitForChatViewBootstrap = () => new Promise<void>((resolve) => setTimeout(resolve, CHAT_VIEW_BOOTSTRAP_DELAY_MS));

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('OpenChamber');

  let moveToRightSidebarScheduled = false;

  const isCursorLikeHost = () => /\bcursor\b/i.test(vscode.env.appName);

  const findMoveToRightSidebarCommandId = async (): Promise<string | null> => {
    const commands = await vscode.commands.getCommands(true);

    const preferred = [
      // Newer VS Code naming
      'workbench.action.moveViewToSecondarySideBar',
      'workbench.action.moveViewToSecondarySidebar',
      'workbench.action.moveFocusedViewToSecondarySideBar',
      'workbench.action.moveFocusedViewToSecondarySidebar',

      // Some builds use "Auxiliary Bar" naming
      'workbench.action.moveViewToAuxiliaryBar',
      'workbench.action.moveFocusedViewToAuxiliaryBar',
    ];

    for (const commandId of preferred) {
      if (commands.includes(commandId)) return commandId;
    }

    const fuzzy = commands.find((commandId) => {
      const id = commandId.toLowerCase();
      const looksLikeMoveView = id.includes('workbench.action') && id.includes('move') && id.includes('view');
      if (!looksLikeMoveView) return false;

      // Support both "secondary sidebar" and "auxiliary bar" naming.
      return (id.includes('secondary') && id.includes('side') && id.includes('bar')) || (id.includes('auxiliary') && id.includes('bar'));
    });

    return fuzzy || null;
  };

  const attemptMoveChatToRightSidebar = async (): Promise<'moved' | 'unsupported' | 'failed'> => {
    const moveCommandId = await findMoveToRightSidebarCommandId();
    if (!moveCommandId) return 'unsupported';

    try {
      await vscode.commands.executeCommand('openchamber.chatView.focus');
      await vscode.commands.executeCommand(moveCommandId);
      return 'moved';
    } catch (error) {
      outputChannel?.appendLine(
        `[OpenChamber] Failed moving chat view to right sidebar (command=${moveCommandId}): ${error instanceof Error ? error.message : String(error)}`
      );
      return 'failed';
    }
  };

  const maybeMoveChatToRightSidebarOnStartup = async () => {
    if (isCursorLikeHost()) return;

    const attempted = context.globalState.get<boolean>('openchamber.sidebarAutoMoveAttempted') || false;
    if (attempted) return;
    await context.globalState.update('openchamber.sidebarAutoMoveAttempted', true);

    if (moveToRightSidebarScheduled) return;
    moveToRightSidebarScheduled = true;

    // Defer until after activation to avoid stealing focus during startup.
    setTimeout(() => {
      void (async () => {
        try {
          await attemptMoveChatToRightSidebar();
        } finally {
          moveToRightSidebarScheduled = false;
        }
      })();
    }, 800);
  };


  // Migration: clear legacy auto-set API URLs (ports 47680-47689 were auto-assigned by older extension versions)
  const config = vscode.workspace.getConfiguration('openchamber');
  const legacyApiUrl = config.get<string>('apiUrl') || '';
  if (/^https?:\/\/localhost:4768\d\/?$/.test(legacyApiUrl.trim())) {
    await config.update('apiUrl', '', vscode.ConfigurationTarget.Global);
  }

  // Create Codex manager first
  codexManager = createCodexManager(context);

  // Create chat view provider with manager reference
  // The webview will show a loading state until the runtime is ready
  chatViewProvider = new ChatViewProvider(context, context.extensionUri, codexManager);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Register sidebar/focus commands AFTER the webview view provider is registered
  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openSidebar', async () => {
      // Best-effort: open the container (if available), then focus the chat view.
      try {
        await vscode.commands.executeCommand('workbench.view.extension.openchamber');
      } catch (e) {
        outputChannel?.appendLine(`[OpenChamber] workbench.view.extension.openchamber failed: ${e}`);
      }

      try {
        await vscode.commands.executeCommand('openchamber.chatView.focus');
      } catch (e) {
        outputChannel?.appendLine(`[OpenChamber] openchamber.chatView.focus failed: ${e}`);
        vscode.window.showErrorMessage(t('OpenChamber: Failed to open sidebar - {0}', String(e)));
        return false;
      }

      if (!chatViewProvider?.hasResolvedView()) {
        outputChannel?.appendLine('[OpenChamber] Chat sidebar focus completed before the webview was resolved');
        vscode.window.showWarningMessage(t('OpenChamber: Chat sidebar is not ready'));
        return false;
      }

      return true;
    })
  );

  const revealChatViewForPayload = async () => {
    const opened = await vscode.commands.executeCommand<boolean>('openchamber.openSidebar');
    if (!opened) {
      return false;
    }

    await waitForChatViewBootstrap();
    if (!chatViewProvider?.hasResolvedView()) {
      outputChannel?.appendLine('[OpenChamber] Chat sidebar webview was disposed before payload delivery');
      vscode.window.showWarningMessage(t('OpenChamber: Chat sidebar is not ready'));
      return false;
    }

    return true;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.focusChat', async () => {
      await vscode.commands.executeCommand('openchamber.chatView.focus');
    })
  );

  void maybeMoveChatToRightSidebarOnStartup();

  // Create Agent Manager panel provider
  agentManagerProvider = new AgentManagerPanelProvider(context, context.extensionUri, codexManager);
  sessionEditorProvider = new SessionEditorPanelProvider(context, context.extensionUri, codexManager);

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.internal.settingsSynced', (settings: unknown) => {
      chatViewProvider?.notifySettingsSynced(settings);
      sessionEditorProvider?.notifySettingsSynced(settings);
      agentManagerProvider?.notifySettingsSynced(settings);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      chatViewProvider?.notifyWindowFocusChanged(state.focused);
      sessionEditorProvider?.notifyWindowFocusChanged(state.focused);
      agentManagerProvider?.notifyWindowFocusChanged(state.focused);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openAgentManager', () => {
      agentManagerProvider?.createOrShow();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.setActiveSession', (sessionId: unknown, title?: unknown) => {
      if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
        activeSessionId = sessionId.trim();
        activeSessionTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim() : null;
        return;
      }

      activeSessionId = null;
      activeSessionTitle = null;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openActiveSessionInEditor', () => {
      if (!activeSessionId) {
        vscode.window.showInformationMessage(t('OpenChamber: No active session'));
        return;
      }
      sessionEditorProvider?.createOrShow(activeSessionId, activeSessionTitle ?? undefined);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openSessionInEditor', (sessionId: string, title?: string) => {
      if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
        return;
      }
      sessionEditorProvider?.createOrShow(sessionId.trim(), title);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openNewSessionInEditor', () => {
      sessionEditorProvider?.createOrShowNewSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openCurrentOrNewSessionInEditor', () => {
      if (activeSessionId) {
        sessionEditorProvider?.createOrShow(activeSessionId, activeSessionTitle ?? undefined);
      } else {
        sessionEditorProvider?.createOrShowNewSession();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.restartApi', async () => {
      try {
        // Prefer the full in-app reload flow driven by the webview. Fall back to
        // a bare manager restart when no webview is open to drive it.
        if (chatViewProvider?.reloadApi()) {
          return;
        }
        await codexManager?.restart();
        vscode.window.showInformationMessage(t('OpenChamber: API connection restarted'));
      } catch (e) {
        vscode.window.showErrorMessage(t('OpenChamber: Failed to restart API - {0}', String(e)));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.addToContext', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(t('OpenChamber [Add to Context]: No active editor'));
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      if (!selectedText) {
        vscode.window.showWarningMessage(t('OpenChamber [Add to Context]: No text selected'));
        return;
      }

      // Get file info for context
      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      // Get line numbers (1-based for display)
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;
      const lineRange = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;

      const filename = `${editor.document.fileName.split(/[\\/]/).pop() || filePath}:${lineRange}`;
      const contextSelection = {
        filePath: editor.document.uri.fsPath,
        filename,
        text: selectedText,
      };

      if (!sessionEditorProvider?.addContextSelectionToActivePanel(contextSelection)) {
        if (!(await revealChatViewForPayload())) {
          return;
        }
        chatViewProvider?.addContextSelection(contextSelection);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.attachExplorerToChat', async (resource?: vscode.Uri, resources?: vscode.Uri[]) => {
      const uriCandidates: vscode.Uri[] = [];
      if (Array.isArray(resources)) {
        uriCandidates.push(...resources.filter((entry): entry is vscode.Uri => entry instanceof vscode.Uri));
      }
      if (resource instanceof vscode.Uri) {
        uriCandidates.push(resource);
      }
      if (uriCandidates.length === 0) {
        const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
        if (activeEditorUri) {
          uriCandidates.push(activeEditorUri);
        }
      }

      const uniqueUris = Array.from(new Map(uriCandidates.map((uri) => [uri.toString(), uri])).values());
      const attachedFiles: Array<{ filePath: string; fileName: string; fileSize: number | null }> = [];
      const skippedEntries: string[] = [];

      for (const uri of uniqueUris) {
        if (uri.scheme !== 'file') {
          skippedEntries.push(uri.toString());
          continue;
        }

        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if ((stat.type & vscode.FileType.Directory) !== 0) {
            skippedEntries.push(vscode.workspace.asRelativePath(uri, false));
            continue;
          }
        } catch {
          skippedEntries.push(vscode.workspace.asRelativePath(uri, false));
          continue;
        }

        const filePath = uri.fsPath.trim();
        const fileName = uri.fsPath.replace(/\\/g, '/').split('/').pop() || vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/').trim();
        if (!filePath || !fileName) {
          skippedEntries.push(uri.fsPath || uri.toString());
          continue;
        }
        let fileSize: number | null = null;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          fileSize = stat.size;
        } catch {
          fileSize = null;
        }
        attachedFiles.push({ filePath, fileName, fileSize });
      }

      if (attachedFiles.length === 0) {
        vscode.window.showWarningMessage(t('OpenChamber: No file selected to mention'));
        return;
      }

      if (!sessionEditorProvider?.addFileAttachmentsToActivePanel(attachedFiles)) {
        if (!(await revealChatViewForPayload())) {
          return;
        }
        chatViewProvider?.addFileAttachments(attachedFiles);
      }

      if (skippedEntries.length > 0) {
        vscode.window.showInformationMessage(t('OpenChamber: Some selected entries were skipped (folders or unsupported resources)'));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.explain', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(t('OpenChamber [Explain]: No active editor'));
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const languageId = editor.document.languageId;

      let prompt: string;

      if (selectedText) {
        // Selection exists - explain the selected code
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        const lineRange = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
        prompt = `${t('Explain the following Code / Text:')}\n\n${filePath}:${lineRange}\n\`\`\`${languageId}\n${selectedText}\n\`\`\``;
      } else {
        // No selection - explain the entire file
        prompt = `${t('Explain the following Code / Text:')}\n\n${filePath}`;
      }

      if (!sessionEditorProvider?.createSessionWithPromptInActivePanel(prompt)) {
        if (!(await revealChatViewForPayload())) {
          return;
        }
        chatViewProvider?.createNewSessionWithPrompt(prompt);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.improveCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(t('OpenChamber [Improve Code]: No active editor'));
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      if (!selectedText) {
        vscode.window.showWarningMessage(t('OpenChamber [Improve Code]: No text selected'));
        return;
      }

      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const languageId = editor.document.languageId;
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;
      const lineRange = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;

      const prompt = `${t('Improve the following Code:')}\n\n${filePath}:${lineRange}\n\`\`\`${languageId}\n${selectedText}\n\`\`\``;

      if (!sessionEditorProvider?.createSessionWithPromptInActivePanel(prompt)) {
        if (!(await revealChatViewForPayload())) {
          return;
        }
        chatViewProvider?.createNewSessionWithPrompt(prompt);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.newSession', async (directory?: unknown) => {
      const candidates = resolveWorkspaceFolders(vscode.workspace.workspaceFolders ?? []);
      let folderPath: string | undefined = typeof directory === 'string' ? directory : undefined;

      if (!folderPath && candidates.length === 0) {
        vscode.window.showInformationMessage('OpenChamber: No folder is open. Open a folder to start a new session.');
        return;
      }

      if (!folderPath) {
        folderPath = candidates.length === 1
          ? candidates[0].path
          : (await vscode.window.showQuickPick(
              candidates.map((folder) => ({ label: folder.name, description: folder.path, path: folder.path })),
              { placeHolder: 'Select a workspace folder for this session', matchOnDescription: true }
            ))?.path;
      }

      if (!folderPath) {
        return;
      }

      if (codexManager) {
        const result = await codexManager.setWorkingDirectory(folderPath);
        if (!result.success) {
          vscode.window.showErrorMessage(`OpenChamber: ${result.error}`);
          return;
        }
      }
      const workspaceFolders = candidates.some((folder) => folder.path === folderPath)
        ? candidates
        : [
            ...candidates,
            {
              name: folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath,
              path: folderPath,
            },
          ];
      chatViewProvider?.createNewSession({ directory: folderPath, workspaceFolders });
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      chatViewProvider?.syncWorkspaceFolders(resolveWorkspaceFolders(vscode.workspace.workspaceFolders ?? []));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.showSettings', () => {
      chatViewProvider?.showSettings();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      chatViewProvider?.updateTheme(theme.kind);
      agentManagerProvider?.updateTheme(theme.kind);
      sessionEditorProvider?.updateTheme(theme.kind);
    })
  );

  // Theme changes can update the `workbench.colorTheme` setting slightly after the
  // `activeColorTheme` event. Listen for config changes too so we can re-resolve
  // the contributed theme JSON and update Shiki themes in the webview.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('workbench.colorTheme') ||
        event.affectsConfiguration('workbench.preferredLightColorTheme') ||
        event.affectsConfiguration('workbench.preferredDarkColorTheme')
      ) {
        chatViewProvider?.updateTheme(vscode.window.activeColorTheme.kind);
        agentManagerProvider?.updateTheme(vscode.window.activeColorTheme.kind);
        sessionEditorProvider?.updateTheme(vscode.window.activeColorTheme.kind);
      }
    })
  );

  // Subscribe to status changes - this broadcasts to webview
  context.subscriptions.push(
    codexManager.onStatusChange((status, error) => {
      chatViewProvider?.updateConnectionStatus(status, error);
      agentManagerProvider?.updateConnectionStatus(status, error);
      sessionEditorProvider?.updateConnectionStatus(status, error);

    })
  );

  // Start Codex runtime bookkeeping without blocking activation.
  // Blocking here delays webview resolution and causes a blank panel until startup completes.
  void codexManager.start();
}

export async function deactivate() {
  await codexManager?.stop();
  codexManager = undefined;
  chatViewProvider = undefined;
  agentManagerProvider = undefined;
  sessionEditorProvider = undefined;
  outputChannel?.dispose();
  outputChannel = undefined;
}
