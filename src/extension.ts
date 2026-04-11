import * as vscode from 'vscode';
import { ActiveDiffTracker } from './activeDiffTracker';
import { VerticalDiffViewProvider } from './verticalDiffViewProvider';

/**
 * 拡張機能を有効化し、VS Code のイベントとパネルプロバイダーを接続します。
 * @param context 拡張機能の実行コンテキストです。
 * @returns 初期化完了を待機する Promise です。
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const tracker = new ActiveDiffTracker();
    const provider = new VerticalDiffViewProvider(context.extensionUri, tracker);

    context.subscriptions.push(
        tracker,
        provider,
        vscode.window.registerWebviewViewProvider(
            VerticalDiffViewProvider.viewId,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    const showCommand = vscode.commands.registerCommand(
        'verticalDiff.show',
        async () => {
            await provider.showCurrentDiff();
        }
    );

    const previousHunkCommand = vscode.commands.registerCommand(
        'verticalDiff.previousHunk',
        async () => {
            await provider.navigate('previous');
        }
    );

    const nextHunkCommand = vscode.commands.registerCommand(
        'verticalDiff.nextHunk',
        async () => {
            await provider.navigate('next');
        }
    );

    const selectionChangeSubscription = vscode.window.onDidChangeTextEditorSelection((event) => {
        void provider.syncToSelection(event.textEditor);
    });

    const visibleRangeChangeSubscription = vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        void provider.syncToVisibleRange(event.textEditor);
    });

    const activeEditorChangeSubscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) {
            return;
        }

        void provider.syncToSelection(editor);
        void provider.syncToVisibleRange(editor);
    });

    context.subscriptions.push(
        showCommand,
        previousHunkCommand,
        nextHunkCommand,
        selectionChangeSubscription,
        visibleRangeChangeSubscription,
        activeEditorChangeSubscription
    );
}

/**
 * 拡張機能を無効化します。
 */
export function deactivate(): void {
    // 現時点では後処理はありません。
}