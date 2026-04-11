import * as vscode from 'vscode';
import { ActiveDiffState, ActiveDiffTracker } from './activeDiffTracker';
import { getSettings, loadViewState, ViewState } from './documentLoader';

/**
 * 差分ハンク間の移動方向です。
 */
type NavigateDirection = 'next' | 'previous';

/**
 * テキストエディターが差分のどちら側に属するかを表します。
 */
type DiffSide = 'original' | 'modified';

/**
 * VS Code のパネル領域に表示する縦積み差分パネルを提供します。
 */
export class VerticalDiffViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewId = 'verticalDiff.view';

    private webviewView: vscode.WebviewView | undefined;
    private isWebviewReady = false;
    private isRefreshing = false;
    private pendingRefresh = false;
    private currentState: ViewState = {
        kind: 'placeholder',
        title: 'Waiting For A Diff',
        detail: 'Open a diff editor to show it here.'
    };
    private readonly disposables: vscode.Disposable[] = [];

    /**
     * プロバイダーを初期化し、追跡中の差分変更を監視します。
     * @param extensionUri 拡張機能のルート URI です。
     * @param tracker アクティブ差分を追跡するトラッカーです。
     */
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly tracker: ActiveDiffTracker
    ) {
        this.disposables.push(
            this.tracker.onDidChange(() => {
                void this.handleTrackedDiffChange();
            })
        );
    }

    /**
     * パネルの Webview を解決し、拡張機能側とのメッセージ連携を設定します。
     * @param webviewView 解決対象の WebviewView です。
     */
    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.webviewView = webviewView;
        this.isWebviewReady = false;

        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);

        const messageDisposable = webviewView.webview.onDidReceiveMessage((message: unknown) => {
            if (isReadyMessage(message)) {
                this.isWebviewReady = true;
                void this.pushCurrentState();
            }
        });

        const disposeDisposable = webviewView.onDidDispose(() => {
            if (this.webviewView === webviewView) {
                this.webviewView = undefined;
            }

            this.isWebviewReady = false;
        });

        this.disposables.push(messageDisposable, disposeDisposable);
        void this.pushCurrentState();
    }

    /**
     * 現在追跡中の差分を読み込み、パネルを表示します。
     * @returns 表示完了を待機する Promise です。
     */
    async showCurrentDiff(): Promise<void> {
        await this.refresh(true);
        await this.reveal(false);
    }

    /**
     * 次または前の差分ハンクへ移動します。
     * @param direction 移動方向です。
     * @returns 移動処理の完了を待機する Promise です。
     */
    async navigate(direction: NavigateDirection): Promise<void> {
        await this.reveal(true);

        if (!this.webviewView || !this.isWebviewReady || this.currentState.kind !== 'diff') {
            return;
        }

        await this.webviewView.webview.postMessage({
            type: 'navigate',
            direction
        });
    }

    /**
     * 現在のエディター選択位置に合わせてパネルを同期します。
     * @param editor 同期元のテキストエディターです。
     * @returns 同期処理の完了を待機する Promise です。
     */
    async syncToSelection(editor: vscode.TextEditor): Promise<void> {
        if (!this.webviewView || !this.isWebviewReady || this.currentState.kind !== 'diff') {
            return;
        }

        const activeDiff = this.tracker.value;
        const matchedSide = getDiffSideForEditor(activeDiff, editor.document.uri);

        if (!matchedSide) {
            return;
        }

        const activeLine = editor.selection.active.line + 1;

        await this.webviewView.webview.postMessage({
            type: 'syncSelection',
            payload: {
                side: matchedSide,
                line: activeLine
            }
        });
    }

    /**
     * 現在のエディター可視範囲に合わせてパネルを同期します。
     * @param editor 同期元のテキストエディターです。
     * @returns 同期処理の完了を待機する Promise です。
     */
    async syncToVisibleRange(editor: vscode.TextEditor): Promise<void> {
        if (!this.webviewView || !this.isWebviewReady || this.currentState.kind !== 'diff') {
            return;
        }

        const activeDiff = this.tracker.value;
        const matchedSide = getDiffSideForEditor(activeDiff, editor.document.uri);

        if (!matchedSide || editor.visibleRanges.length === 0) {
            return;
        }

        const primaryRange = editor.visibleRanges[0];

        await this.webviewView.webview.postMessage({
            type: 'syncViewport',
            payload: {
                side: matchedSide,
                startLine: primaryRange.start.line + 1,
                endLine: primaryRange.end.line + 1
            }
        });
    }

    /**
     * 関連する設定が変わったときに表示を更新します。
     */
    handleConfigurationChange(): void {
        void this.refresh(true);
    }

    /**
     * プロバイダーが保持しているリソースを解放します。
     */
    dispose(): void {
        vscode.Disposable.from(...this.disposables).dispose();
    }

    /**
     * 追跡中の差分変更に応じて表示を更新し、必要ならパネルを表示します。
     * @returns 更新処理の完了を待機する Promise です。
     */
    private async handleTrackedDiffChange(): Promise<void> {
        const settings = getSettings();

        if (!settings.followActiveDiff && this.currentState.kind === 'diff') {
            return;
        }

        await this.refresh(true);

        if (settings.autoReveal && this.tracker.value) {
            await this.reveal(true);
        }
    }

    /**
     * 現在の表示状態を再構築して Webview へ送信します。
     * @param force 強制更新する場合は true です。
     * @returns 更新処理の完了を待機する Promise です。
     */
    private async refresh(force: boolean): Promise<void> {
        if (this.isRefreshing) {
            this.pendingRefresh = true;
            return;
        }

        this.isRefreshing = true;

        try {
            const settings = getSettings();

            if (!force && !settings.followActiveDiff) {
                return;
            }

            this.currentState = await loadViewState(this.tracker.value, settings);
            await this.pushCurrentState();
        } finally {
            this.isRefreshing = false;

            if (this.pendingRefresh) {
                this.pendingRefresh = false;
                void this.refresh(true);
            }
        }
    }

    /**
     * パネルコンテナーを表示し、必要ならビューへフォーカスします。
     * @param preserveFocus フォーカス維持の意図を受け取る引数です。
     * @returns 表示処理の完了を待機する Promise です。
     */
    private async reveal(preserveFocus: boolean): Promise<void> {
        void preserveFocus;

        await this.tryExecuteCommand('workbench.view.extension.verticalDiffPanel');

        if (!this.webviewView) {
            await this.tryExecuteCommand(`${VerticalDiffViewProvider.viewId}.focus`);
        }
    }

    /**
     * Webview の準備完了後に現在の状態を送信します。
     * @returns 送信処理の完了を待機する Promise です。
     */
    private async pushCurrentState(): Promise<void> {
        if (!this.webviewView || !this.isWebviewReady) {
            return;
        }

        if (this.currentState.kind === 'placeholder') {
            await this.webviewView.webview.postMessage({
                type: 'placeholder',
                payload: {
                    title: this.currentState.title,
                    detail: this.currentState.detail
                }
            });
            return;
        }

        await this.webviewView.webview.postMessage({
            type: 'render',
            payload: this.currentState.model
        });
    }

    /**
     * VS Code コマンドを実行し、ベストエフォートの失敗は握りつぶします。
     * @param command 実行するコマンド ID です。
     * @returns 実行処理の完了を待機する Promise です。
     */
    private async tryExecuteCommand(command: string): Promise<void> {
        try {
            await vscode.commands.executeCommand(command);
        } catch {
            // ベストエフォートの表示失敗は無視します。
        }
    }

    /**
     * パネル Webview に渡す HTML ドキュメント全体を構築します。
     * @param webview HTML を提供する対象の Webview です。
     * @returns Webview へ設定する HTML 文字列です。
     */
    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();

        void webview;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
    <title>Vertical Diff</title>
    <style nonce="${nonce}">
        :root {
            color-scheme: light dark;
            --vd-font-size: 11px;
            --vd-line-height: 18px;
        }

        * {
            box-sizing: border-box;
        }

        html,
        body {
            height: 100%;
            margin: 0;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
        }

        body {
            padding: 0;
            overflow: hidden;
        }

        .app {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        .surface {
            height: 100%;
            min-height: 0;
        }

        .toolbar {
            display: none;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            min-height: 40px;
            padding: 6px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-panel-border));
        }

        .toolbar-title {
            min-width: 0;
        }

        .toolbar-label {
            display: block;
            margin-bottom: 2px;
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .toolbar-file {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 12px;
            font-weight: 600;
        }

        .toolbar-meta {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-shrink: 0;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }

        .empty {
            display: grid;
            place-items: center;
            height: 100%;
            padding: 24px;
        }

        .empty-card {
            max-width: 480px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 10px;
            padding: 20px;
            background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-panel-border));
        }

        .empty-title {
            margin: 0 0 8px;
            font-size: 16px;
            font-weight: 600;
        }

        .empty-detail {
            margin: 0;
            color: var(--vscode-descriptionForeground);
            line-height: 1.5;
        }

        .hidden {
            display: none !important;
        }

        .diff-view {
            display: grid;
            grid-template-rows: 1fr 6px 1fr;
            height: 100%;
            min-height: 0;
            background: var(--vscode-panel-border);
        }

        .pane {
            display: grid;
            grid-template-rows: auto minmax(0, 1fr);
            min-height: 0;
            background: var(--vscode-editor-background);
        }

        .pane-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            min-height: 24px;
            padding: 2px 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: color-mix(in srgb, var(--vscode-editor-background) 95%, var(--vscode-panel-border));
        }

        .pane-headline {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }

        .pane-badge {
            padding: 1px 6px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 999px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--vscode-descriptionForeground);
            background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-panel-border));
        }

        .pane-path {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 12px;
            font-weight: 600;
        }

        .pane-meta {
            display: none;
        }

        .splitter {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: row-resize;
            background: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-panel-border));
            user-select: none;
        }

        .splitter::before {
            content: '';
            width: 56px;
            height: 2px;
            border-radius: 999px;
            background: color-mix(in srgb, var(--vscode-focusBorder) 65%, var(--vscode-panel-border));
            opacity: 0.8;
        }

        .splitter-label {
            display: none;
        }

        .pane-scroll {
            overflow: auto;
            min-height: 0;
        }

        .lines {
            min-width: max-content;
            font-family: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
            font-size: var(--vd-font-size);
            line-height: var(--vd-line-height);
            tab-size: 4;
        }

        .line {
            display: grid;
            grid-template-columns: 64px minmax(0, 1fr);
            min-height: var(--vd-line-height);
            line-height: var(--vd-line-height);
            white-space: pre;
        }

        .line-number {
            user-select: none;
            padding: 0 10px 0 8px;
            text-align: right;
            color: var(--vscode-editorLineNumber-foreground);
            border-right: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
            position: sticky;
            left: 0;
            z-index: 1;
            background: inherit;
        }

        .line-content {
            padding: 0 12px 0 10px;
            overflow: hidden;
        }

        .line--placeholder {
            background-image: linear-gradient(
                -45deg,
                transparent 0,
                transparent 8px,
                color-mix(in srgb, var(--vscode-panel-border) 18%, transparent) 8px,
                color-mix(in srgb, var(--vscode-panel-border) 18%, transparent) 9px,
                transparent 9px,
                transparent 17px
            );
            opacity: 0.52;
        }

        .line--placeholder .line-number {
            opacity: 0.5;
        }

        .line--insert-placeholder {
            background: color-mix(in srgb, var(--vscode-diffEditor-insertedLineBackground, rgba(76, 175, 80, 0.12)) 55%, transparent);
            background-image: linear-gradient(
                -45deg,
                transparent 0,
                transparent 8px,
                color-mix(in srgb, var(--vscode-diffEditor-insertedLineBackground, rgba(76, 175, 80, 0.18)) 55%, transparent) 8px,
                color-mix(in srgb, var(--vscode-diffEditor-insertedLineBackground, rgba(76, 175, 80, 0.18)) 55%, transparent) 9px,
                transparent 9px,
                transparent 17px
            );
        }

        .line--delete-placeholder {
            background: color-mix(in srgb, var(--vscode-diffEditor-removedLineBackground, rgba(255, 82, 82, 0.12)) 55%, transparent);
            background-image: linear-gradient(
                -45deg,
                transparent 0,
                transparent 8px,
                color-mix(in srgb, var(--vscode-diffEditor-removedLineBackground, rgba(255, 82, 82, 0.18)) 55%, transparent) 8px,
                color-mix(in srgb, var(--vscode-diffEditor-removedLineBackground, rgba(255, 82, 82, 0.18)) 55%, transparent) 9px,
                transparent 9px,
                transparent 17px
            );
        }

        .line--insert-placeholder .line-number,
        .line--delete-placeholder .line-number {
            opacity: 0.38;
        }

        .placeholder-marker {
            color: var(--vscode-descriptionForeground);
            opacity: 0.6;
        }

        .placeholder-marker--insert {
            color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
            opacity: 0.9;
        }

        .placeholder-marker--delete {
            color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c);
            opacity: 0.9;
        }

        .line--insert {
            background: color-mix(in srgb, var(--vscode-diffEditor-insertedLineBackground, rgba(76, 175, 80, 0.12)) 88%, transparent);
        }

        .line--delete {
            background: color-mix(in srgb, var(--vscode-diffEditor-removedLineBackground, rgba(255, 82, 82, 0.12)) 88%, transparent);
        }

        .line.is-active-hunk {
            box-shadow: inset 3px 0 0 var(--vscode-focusBorder), inset 0 0 0 9999px color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent);
        }

        .line.is-active-hunk .line-number {
            color: var(--vscode-editorLineNumber-activeForeground, var(--vscode-editor-foreground));
            font-weight: 700;
        }

        .inline-added {
            background: color-mix(in srgb, var(--vscode-diffEditor-insertedTextBackground, rgba(76, 175, 80, 0.3)) 92%, transparent);
            border-radius: 2px;
        }

        .inline-removed {
            background: color-mix(in srgb, var(--vscode-diffEditor-removedTextBackground, rgba(255, 82, 82, 0.3)) 92%, transparent);
            border-radius: 2px;
        }

        .line--collapsed {
            background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-panel-border));
        }

        .line--collapsed .line-number {
            opacity: 0;
            pointer-events: none;
        }

        .line--collapsed .line-content {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            text-align: center;
        }

        .hljs-comment,
        .hljs-quote {
            font-style: italic;
        }

        body.vscode-light .hljs-keyword,
        body.vscode-light .hljs-selector-tag,
        body.vscode-light .hljs-literal,
        body.vscode-light .hljs-title,
        body.vscode-light .hljs-section,
        body.vscode-light .hljs-doctag,
        body.vscode-light .hljs-type,
        body.vscode-light .hljs-name,
        body.vscode-light .hljs-strong {
            color: #0b62c0;
        }

        body.vscode-light .hljs-string,
        body.vscode-light .hljs-attr,
        body.vscode-light .hljs-template-tag,
        body.vscode-light .hljs-template-variable,
        body.vscode-light .hljs-bullet {
            color: #8a3c0e;
        }

        body.vscode-light .hljs-number,
        body.vscode-light .hljs-symbol,
        body.vscode-light .hljs-variable,
        body.vscode-light .hljs-params {
            color: #7a2e9b;
        }

        body.vscode-light .hljs-comment,
        body.vscode-light .hljs-quote {
            color: #6a737d;
        }

        body.vscode-dark .hljs-keyword,
        body.vscode-dark .hljs-selector-tag,
        body.vscode-dark .hljs-literal,
        body.vscode-dark .hljs-title,
        body.vscode-dark .hljs-section,
        body.vscode-dark .hljs-doctag,
        body.vscode-dark .hljs-type,
        body.vscode-dark .hljs-name,
        body.vscode-dark .hljs-strong,
        body.vscode-high-contrast .hljs-keyword,
        body.vscode-high-contrast .hljs-selector-tag,
        body.vscode-high-contrast .hljs-literal,
        body.vscode-high-contrast .hljs-title,
        body.vscode-high-contrast .hljs-section,
        body.vscode-high-contrast .hljs-doctag,
        body.vscode-high-contrast .hljs-type,
        body.vscode-high-contrast .hljs-name,
        body.vscode-high-contrast .hljs-strong {
            color: #6cb6ff;
        }

        body.vscode-dark .hljs-string,
        body.vscode-dark .hljs-attr,
        body.vscode-dark .hljs-template-tag,
        body.vscode-dark .hljs-template-variable,
        body.vscode-dark .hljs-bullet,
        body.vscode-high-contrast .hljs-string,
        body.vscode-high-contrast .hljs-attr,
        body.vscode-high-contrast .hljs-template-tag,
        body.vscode-high-contrast .hljs-template-variable,
        body.vscode-high-contrast .hljs-bullet {
            color: #f2cc60;
        }

        body.vscode-dark .hljs-number,
        body.vscode-dark .hljs-symbol,
        body.vscode-dark .hljs-variable,
        body.vscode-dark .hljs-params,
        body.vscode-high-contrast .hljs-number,
        body.vscode-high-contrast .hljs-symbol,
        body.vscode-high-contrast .hljs-variable,
        body.vscode-high-contrast .hljs-params {
            color: #d2a8ff;
        }

        body.vscode-dark .hljs-comment,
        body.vscode-dark .hljs-quote,
        body.vscode-high-contrast .hljs-comment,
        body.vscode-high-contrast .hljs-quote {
            color: #8b949e;
        }
    </style>
</head>
<body>
    <div class="app">
        <div class="empty" id="empty-state">
            <div class="empty-card">
                <h2 class="empty-title" id="empty-title">Waiting For A Diff</h2>
                <p class="empty-detail" id="empty-detail">Open a diff editor to show it here.</p>
            </div>
        </div>

        <div class="surface hidden" id="surface">
            <header class="toolbar">
                <div class="toolbar-title">
                    <span class="toolbar-label">Vertical Diff</span>
                    <div class="toolbar-file" id="diff-title">Active Diff</div>
                </div>
                <div class="toolbar-meta">
                    <span id="hunk-summary">No changes</span>
                    <span id="zoom-indicator">100%</span>
                </div>
            </header>

            <div class="diff-view" id="diff-view">
            <section class="pane">
                <div class="pane-header">
                    <div class="pane-headline">
                        <div class="pane-badge">Original</div>
                        <div class="pane-path" id="original-path"></div>
                    </div>
                    <div class="pane-meta" id="original-meta">Upper pane</div>
                </div>
                <div class="pane-scroll" id="original-scroll">
                    <div class="lines" id="original-lines"></div>
                </div>
            </section>

            <div class="splitter" id="splitter">
                <span class="splitter-label">Resize</span>
            </div>

            <section class="pane">
                <div class="pane-header">
                    <div class="pane-headline">
                        <div class="pane-badge">Modified</div>
                        <div class="pane-path" id="modified-path"></div>
                    </div>
                    <div class="pane-meta" id="modified-summary">Lower pane</div>
                </div>
                <div class="pane-scroll" id="modified-scroll">
                    <div class="lines" id="modified-lines"></div>
                </div>
            </section>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const persistedState = vscode.getState() || {};
        const CONTEXT_BEFORE_ROWS = 0;
        const CONTEXT_AFTER_ROWS = 0;
        const state = {
            model: undefined,
            activeHunkIndex: -1,
            syncingScroll: false,
            resizing: false,
            userAdjustedZoom: typeof persistedState.fontSize === 'number' && Number.isFinite(persistedState.fontSize),
            fontSize: 11,
            splitRatio: clampNumber(persistedState.splitRatio, 0.5, 0.22, 0.78)
        };

        const elements = {
            diffView: document.getElementById('diff-view'),
            diffTitle: document.getElementById('diff-title'),
            emptyState: document.getElementById('empty-state'),
            emptyTitle: document.getElementById('empty-title'),
            emptyDetail: document.getElementById('empty-detail'),
            hunkSummary: document.getElementById('hunk-summary'),
            modifiedSummary: document.getElementById('modified-summary'),
            originalMeta: document.getElementById('original-meta'),
            originalLines: document.getElementById('original-lines'),
            originalPath: document.getElementById('original-path'),
            originalScroll: document.getElementById('original-scroll'),
            modifiedLines: document.getElementById('modified-lines'),
            modifiedPath: document.getElementById('modified-path'),
            modifiedScroll: document.getElementById('modified-scroll'),
            splitter: document.getElementById('splitter'),
            surface: document.getElementById('surface'),
            zoomIndicator: document.getElementById('zoom-indicator')
        };

        window.addEventListener('message', (event) => {
            handleMessage(event.data);
        });

        elements.originalScroll.addEventListener('scroll', () => syncScroll(elements.originalScroll, elements.modifiedScroll));
        elements.modifiedScroll.addEventListener('scroll', () => syncScroll(elements.modifiedScroll, elements.originalScroll));
        elements.surface.addEventListener('wheel', handleSurfaceWheel, { passive: false });
        elements.splitter.addEventListener('wheel', handleSplitterWheel, { passive: false });
        elements.splitter.addEventListener('pointerdown', beginResize);
        window.addEventListener('pointermove', resizeFromPointer);
        window.addEventListener('pointerup', endResize);
        window.addEventListener('resize', handleWindowResize);
        elements.splitter.addEventListener('dblclick', () => {
            state.splitRatio = 0.5;
            applyUiPreferences();
        });

        state.fontSize = state.userAdjustedZoom
            ? clampNumber(persistedState.fontSize, 11, 9, 18)
            : getAutoFontSize();

        applyUiPreferences();

        vscode.postMessage({ type: 'ready' });

        /**
         * 拡張機能ホストから届いたメッセージを対応する処理へ振り分けます。
         * @param message 受信したメッセージです。
         */
        function handleMessage(message) {
            if (!message || typeof message.type !== 'string') {
                return;
            }

            if (message.type === 'placeholder') {
                renderPlaceholder(message.payload);
                return;
            }

            if (message.type === 'render') {
                renderDiff(message.payload);
                return;
            }

            if (message.type === 'navigate') {
                navigate(message.direction);
                return;
            }

            if (message.type === 'syncSelection') {
                syncSelection(message.payload);
                return;
            }

            if (message.type === 'syncViewport') {
                syncViewport(message.payload);
            }
        }

        /**
         * Webview をプレースホルダー表示へ切り替えます。
         * @param payload プレースホルダー表示に使うデータです。
         */
        function renderPlaceholder(payload) {
            state.model = undefined;
            state.activeHunkIndex = -1;
            elements.surface.classList.add('hidden');
            elements.emptyState.classList.remove('hidden');
            elements.emptyTitle.textContent = payload?.title || 'No Active Diff';
            elements.emptyDetail.textContent = payload?.detail || 'Open a diff editor to show it here.';
        }

        /**
         * 新しい差分モデルを Webview に読み込みます。
         * @param model 描画対象の差分モデルです。
         */
        function renderDiff(model) {
            state.model = model;
            state.activeHunkIndex = model.hunks.length ? 0 : -1;
            elements.emptyState.classList.add('hidden');
            elements.surface.classList.remove('hidden');
            elements.diffTitle.textContent = model.title;
            elements.originalPath.textContent = model.originalLabel;
            elements.modifiedPath.textContent = model.modifiedLabel;
            renderActiveWindow();
        }

        /**
         * 行配列を HTML の描画行へ変換します。
         * @param lines 描画対象の行配列です。
         * @returns 描画用の HTML 文字列です。
         */
        function renderLines(lines) {
            return lines.map((line, index) => {
                const rowIndex = typeof line.rowIndex === 'number' ? line.rowIndex : index;
                const lineNumber = line.lineNumber === null ? '' : String(line.lineNumber);
                const contentHtml = getLineContentHtml(line);

                return '<div class="line line--' + line.kind + '" data-row-index="' + rowIndex + '">' +
                    '<div class="line-number">' + lineNumber + '</div>' +
                    '<div class="line-content">' + contentHtml + '</div>' +
                    '</div>';
            }).join('');
        }

        /**
         * 1 行分の内容に対応する HTML を返します。
         * @param line 描画対象の行データです。
         * @returns 行内容の HTML 文字列です。
         */
        function getLineContentHtml(line) {
            if (line.kind === 'placeholder') {
                return '<span class="placeholder-marker">···</span>';
            }

            if (line.kind === 'insert-placeholder') {
                return '<span class="placeholder-marker placeholder-marker--insert">+</span>';
            }

            if (line.kind === 'delete-placeholder') {
                return '<span class="placeholder-marker placeholder-marker--delete">-</span>';
            }

            return line.html || '&nbsp;';
        }

        /**
         * 指定方向へアクティブなハンク選択を移動します。
         * @param direction 移動方向です。
         */
        function navigate(direction) {
            if (!state.model || !state.model.hunks.length) {
                return;
            }

            if (state.activeHunkIndex < 0) {
                state.activeHunkIndex = 0;
            } else if (direction === 'next') {
                state.activeHunkIndex = Math.min(state.model.hunks.length - 1, state.activeHunkIndex + 1);
            } else {
                state.activeHunkIndex = Math.max(0, state.activeHunkIndex - 1);
            }

            renderActiveWindow();
        }

        /**
         * アクティブエディターの行を含むハンクを選択します。
         * @param payload 選択同期に使う情報です。
         */
        function syncSelection(payload) {
            if (!state.model || !state.model.hunks.length || !payload) {
                return;
            }

            const side = payload.side;
            const line = payload.line;

            if ((side !== 'original' && side !== 'modified') || typeof line !== 'number') {
                return;
            }

            const nextIndex = findBestHunkIndexForLine(side, line);

            if (nextIndex < 0 || nextIndex === state.activeHunkIndex) {
                return;
            }

            state.activeHunkIndex = nextIndex;
            renderActiveWindow();
        }

        /**
         * 現在の可視範囲に重なっているハンクを選択します。
         * @param payload 可視範囲同期に使う情報です。
         */
        function syncViewport(payload) {
            if (!state.model || !state.model.hunks.length || !payload) {
                return;
            }

            const side = payload.side;
            const startLine = payload.startLine;
            const endLine = payload.endLine;

            if (
                (side !== 'original' && side !== 'modified')
                || typeof startLine !== 'number'
                || typeof endLine !== 'number'
            ) {
                return;
            }

            const normalizedStart = Math.min(startLine, endLine);
            const normalizedEnd = Math.max(startLine, endLine);
            const nextIndex = findBestHunkIndexForViewport(side, normalizedStart, normalizedEnd);

            if (nextIndex < 0 || nextIndex === state.activeHunkIndex) {
                return;
            }

            state.activeHunkIndex = nextIndex;
            renderActiveWindow();
        }

        /**
         * 指定行に最も適合するハンクを返します。
         * @param side 判定対象の差分側です。
         * @param line 行番号です。
         * @returns 一致したハンクインデックスです。
         */
        function findBestHunkIndexForLine(side, line) {
            if (!state.model) {
                return -1;
            }

            const directMatchIndex = state.model.hunks.findIndex((hunk) => {
                const range = getHunkLineRange(hunk, side);
                return range !== null && range.kind === 'direct' && line >= range.start && line <= range.end;
            });

            if (directMatchIndex >= 0) {
                return directMatchIndex;
            }

            return findBestHunkIndexForViewport(side, line, line);
        }

        /**
         * 可視範囲と最も近いハンクを返します。
         * @param side 判定対象の差分側です。
         * @param startLine 可視範囲の開始行です。
         * @param endLine 可視範囲の終了行です。
         * @returns 一致したハンクインデックスです。
         */
        function findBestHunkIndexForViewport(side, startLine, endLine) {
            if (!state.model) {
                return -1;
            }

            let bestIndex = -1;
            let bestScore = Number.POSITIVE_INFINITY;
            const viewportCenter = (startLine + endLine) / 2;

            for (let index = 0; index < state.model.hunks.length; index += 1) {
                const range = getHunkLineRange(state.model.hunks[index], side);

                if (!range || endLine < range.start || startLine > range.end) {
                    continue;
                }

                const rangeCenter = (range.start + range.end) / 2;
                const score = Math.abs(viewportCenter - rangeCenter) + (range.kind === 'anchor' ? 0.25 : 0);

                if (score < bestScore) {
                    bestScore = score;
                    bestIndex = index;
                }
            }

            return bestIndex;
        }

        /**
         * 指定したハンクの片側に対応する検索レンジを返します。
         * @param hunk 検索対象のハンクです。
         * @param side 判定対象の差分側です。
         * @returns 検索レンジ、または判定不能時は null です。
         */
        function getHunkLineRange(hunk, side) {
            if (!state.model) {
                return null;
            }

            const start = side === 'original' ? hunk.originalStartLine : hunk.modifiedStartLine;
            const end = side === 'original' ? hunk.originalEndLine : hunk.modifiedEndLine;

            if (start !== null && end !== null) {
                return {
                    kind: 'direct',
                    start,
                    end
                };
            }

            const lines = side === 'original' ? state.model.original : state.model.modified;
            const previousLine = findAdjacentLineNumber(lines, hunk.startRow - 1, -1);
            const nextLine = findAdjacentLineNumber(lines, hunk.endRow + 1, 1);

            if (previousLine === null && nextLine === null) {
                return null;
            }

            const anchorStart = previousLine ?? nextLine;
            const anchorEnd = nextLine ?? previousLine;

            return {
                kind: 'anchor',
                start: Math.min(anchorStart, anchorEnd),
                end: Math.max(anchorStart, anchorEnd)
            };
        }

        /**
         * 指定位置から近い側の実行行番号を探します。
         * @param lines 行配列です。
         * @param startIndex 探索開始インデックスです。
         * @param step 探索方向です。
         * @returns 見つかった行番号、または null です。
         */
        function findAdjacentLineNumber(lines, startIndex, step) {
            for (let index = startIndex; index >= 0 && index < lines.length; index += step) {
                const candidate = lines[index];

                if (candidate && candidate.lineNumber !== null) {
                    return candidate.lineNumber;
                }
            }

            return null;
        }

        /**
         * 2 つのペインの縦スクロール位置を揃えます。
         * @param source スクロール元の要素です。
         * @param target 同期先の要素です。
         */
        function syncScroll(source, target) {
            if (state.syncingScroll) {
                return;
            }

            state.syncingScroll = true;
            target.scrollTop = source.scrollTop;
            requestAnimationFrame(() => {
                state.syncingScroll = false;
            });
        }

        /**
         * パネル内での Ctrl または Cmd ホイールズームを処理します。
         * @param event ホイールイベントです。
         */
        function handleSurfaceWheel(event) {
            if (!event.ctrlKey && !event.metaKey) {
                return;
            }

            event.preventDefault();
            const direction = event.deltaY > 0 ? -1 : 1;
            state.userAdjustedZoom = true;
            state.fontSize = clampNumber(state.fontSize + direction, state.fontSize, 9, 18);
            applyUiPreferences();
        }

        /**
         * スプリッター上のホイール操作で分割比率を調整します。
         * @param event ホイールイベントです。
         */
        function handleSplitterWheel(event) {
            if (event.ctrlKey || event.metaKey) {
                return;
            }

            event.preventDefault();
            const delta = event.deltaY > 0 ? -0.035 : 0.035;
            state.splitRatio = clampNumber(state.splitRatio + delta, state.splitRatio, 0.22, 0.78);
            applyUiPreferences();
        }

        /**
         * ドラッグによるペインサイズ変更を開始します。
         * @param event ポインターイベントです。
         */
        function beginResize(event) {
            state.resizing = true;
            elements.splitter.setPointerCapture(event.pointerId);
        }

        /**
         * スプリッターのドラッグ中に分割比率を更新します。
         * @param event ポインターイベントです。
         */
        function resizeFromPointer(event) {
            if (!state.resizing) {
                return;
            }

            const rect = elements.diffView.getBoundingClientRect();
            const splitterOffset = 8;
            const relative = (event.clientY - rect.top) / Math.max(1, rect.height - splitterOffset);
            state.splitRatio = clampNumber(relative, state.splitRatio, 0.22, 0.78);
            applyUiPreferences();
        }

        /**
         * ドラッグによるペインサイズ変更を終了します。
         * @param event ポインターイベントです。
         */
        function endResize(event) {
            if (!state.resizing) {
                return;
            }

            state.resizing = false;

            if (event && typeof event.pointerId === 'number') {
                try {
                    elements.splitter.releasePointerCapture(event.pointerId);
                } catch {
                    // ポインターキャプチャ解放失敗は無視します。
                }
            }
        }

        /**
         * Webview のサイズ変更に応じて自動ズーム値を再計算します。
         */
        function handleWindowResize() {
            if (state.userAdjustedZoom) {
                return;
            }

            state.fontSize = getAutoFontSize();
            applyUiPreferences(false);
        }

        /**
         * 現在のパネル幅に収まるフォントサイズを選びます。
         * @returns 自動計算されたフォントサイズです。
         */
        function getAutoFontSize() {
            const width = elements.surface.clientWidth || window.innerWidth;

            if (width < 640) {
                return 9;
            }

            if (width < 960) {
                return 10;
            }

            return 11;
        }

        /**
         * 現在のフォントサイズとペイン比率を DOM に反映します。
         * @param shouldPersist 状態を保存する場合は true です。
         */
        function applyUiPreferences(shouldPersist = true) {
            const lineHeight = Math.max(16, Math.round(state.fontSize * 1.55));
            document.documentElement.style.setProperty('--vd-font-size', state.fontSize + 'px');
            document.documentElement.style.setProperty('--vd-line-height', lineHeight + 'px');
            elements.diffView.style.gridTemplateRows = state.splitRatio + 'fr 6px ' + (1 - state.splitRatio) + 'fr';
            if (shouldPersist) {
                persistUiPreferences();
            }
        }

        /**
         * パネルの UI 設定を再読み込み後も維持できるよう保存します。
         */
        function persistUiPreferences() {
            vscode.setState({
                fontSize: state.userAdjustedZoom ? state.fontSize : undefined,
                splitRatio: state.splitRatio
            });
        }

        /**
         * 現在選択されているハンクの表示範囲を描画します。
         */
        function renderActiveWindow() {
            if (!state.model) {
                return;
            }

            if (state.activeHunkIndex < 0 || !state.model.hunks.length) {
                const emptyLines = buildNoChangeLines();
                elements.originalLines.innerHTML = renderLines(emptyLines);
                elements.modifiedLines.innerHTML = renderLines(emptyLines);
                updateHunkSummary();
                elements.originalScroll.scrollTop = 0;
                elements.modifiedScroll.scrollTop = 0;
                elements.originalScroll.scrollLeft = 0;
                elements.modifiedScroll.scrollLeft = 0;
                return;
            }

            const windowModel = buildWindowModel(state.model, state.activeHunkIndex);
            elements.originalLines.innerHTML = renderLines(windowModel.original);
            elements.modifiedLines.innerHTML = renderLines(windowModel.modified);
            updateHunkSummary();
            highlightActiveHunk(windowModel.hunk);
            elements.originalScroll.scrollTop = 0;
            elements.modifiedScroll.scrollTop = 0;
            elements.originalScroll.scrollLeft = 0;
            elements.modifiedScroll.scrollLeft = 0;
        }

        /**
         * 現在選択されているハンクを両ペインで強調表示します。
         * @param hunk 強調対象のハンクです。
         */
        function highlightActiveHunk(hunk) {
            if (!hunk) {
                return;
            }

            for (let row = hunk.startRow; row <= hunk.endRow; row += 1) {
                const originalLine = elements.originalLines.querySelector('[data-row-index="' + row + '"]');
                const modifiedLine = elements.modifiedLines.querySelector('[data-row-index="' + row + '"]');

                if (originalLine) {
                    originalLine.classList.add('is-active-hunk');
                }

                if (modifiedLine) {
                    modifiedLine.classList.add('is-active-hunk');
                }
            }
        }

        /**
         * パネル上部に表示するハンク要約を更新します。
         */
        function updateHunkSummary() {
            if (!state.model || !state.model.hunks.length || state.activeHunkIndex < 0) {
                if (elements.hunkSummary) {
                    elements.hunkSummary.textContent = 'No changes';
                }
                if (elements.modifiedSummary) {
                    elements.modifiedSummary.textContent = '';
                }
                return;
            }

            const summary = 'Hunk ' + (state.activeHunkIndex + 1) + ' / ' + state.model.hunks.length;
            if (elements.hunkSummary) {
                elements.hunkSummary.textContent = summary;
            }
            if (elements.modifiedSummary) {
                elements.modifiedSummary.textContent = '';
            }
        }

        /**
         * 数値を安全な範囲へ丸め込みます。
         * @param value 入力値です。
         * @param fallbackValue 入力が不正な場合に使う値です。
         * @param min 許可する最小値です。
         * @param max 許可する最大値です。
         * @returns 範囲内へ補正した数値です。
         */
        function clampNumber(value, fallbackValue, min, max) {
            const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallbackValue;
            return Math.min(max, Math.max(min, candidate));
        }

        /**
         * アクティブなハンクの表示ウィンドウを構築します。
         * @param model 元になる差分モデルです。
         * @param activeHunkIndex 表示対象ハンクのインデックスです。
         * @returns 表示対象のウィンドウモデルです。
         */
        function buildWindowModel(model, activeHunkIndex) {
            const hunk = model.hunks[activeHunkIndex];
            const totalRows = model.original.length;
            const start = Math.max(0, hunk.startRow - CONTEXT_BEFORE_ROWS);
            const end = Math.min(totalRows - 1, hunk.endRow + CONTEXT_AFTER_ROWS);

            return {
                hunk,
                original: buildVisibleLines(model.original, start, end),
                modified: buildVisibleLines(model.modified, start, end)
            };
        }

        /**
         * 変更ハンクが存在しない場合の最小限の表示行を返します。
         * @returns 変更なし表示用の行配列です。
         */
        function buildNoChangeLines() {
            return [{
                rowIndex: 0,
                lineNumber: null,
                text: '',
                html: 'No changed lines in the active diff.',
                kind: 'collapsed'
            }];
        }

        /**
         * 指定範囲の行を展開し、前後に折りたたみ表示を追加します。
         * @param lines 元になる行配列です。
         * @param start 表示開始行のインデックスです。
         * @param end 表示終了行のインデックスです。
         * @param totalRows 全体の行数です。
         * @returns 表示用の行配列です。
         */
        function buildVisibleLines(lines, start, end) {
            const visible = [];

            for (let index = start; index <= end; index += 1) {
                visible.push({
                    ...lines[index],
                    rowIndex: index
                });
            }

            return visible;
        }
    </script>
</body>
</html>`;
    }
}

/**
 * Webview の Content Security Policy で使う nonce を生成します。
 * @returns 生成した nonce 文字列です。
 */
function getNonce(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';

    for (let index = 0; index < 32; index += 1) {
        nonce += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    return nonce;
}

/**
 * Webview メッセージが準備完了通知かどうかを判定します。
 * @param message 判定対象のメッセージです。
 * @returns 準備完了通知なら true、それ以外は false です。
 */
function isReadyMessage(message: unknown): message is { type: 'ready'; } {
    if (!message || typeof message !== 'object') {
        return false;
    }

    return (message as { type?: string; }).type === 'ready';
}

/**
 * 指定したエディター URI が差分のどちら側かを判定します。
 * @param activeDiff 現在追跡中の差分状態です。
 * @param uri 判定対象のエディター URI です。
 * @returns 対応する差分側です。該当しない場合は undefined です。
 */
function getDiffSideForEditor(
    activeDiff: ActiveDiffState | undefined,
    uri: vscode.Uri
): DiffSide | undefined {
    if (!activeDiff) {
        return undefined;
    }

    const value = uri.toString();

    if (value === activeDiff.original.toString()) {
        return 'original';
    }

    if (value === activeDiff.modified.toString()) {
        return 'modified';
    }

    return undefined;
}