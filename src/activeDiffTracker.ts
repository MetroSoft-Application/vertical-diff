import * as vscode from 'vscode';

/**
 * 拡張機能が現在追跡している差分エディターの状態です。
 */
export interface ActiveDiffState {
    label: string;
    original: vscode.Uri;
    modified: vscode.Uri;
}

/**
 * アクティブなテキスト差分タブを追跡し、変更時に通知します。
 */
export class ActiveDiffTracker implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<ActiveDiffState | undefined>();
    private readonly disposables: vscode.Disposable[] = [];
    private currentState: ActiveDiffState | undefined;

    readonly onDidChange = this.emitter.event;

    /**
     * トラッカーを初期化し、タブグループの変更を監視します。
     */
    constructor() {
        const refresh = () => this.refresh();

        this.disposables.push(
            vscode.window.tabGroups.onDidChangeTabs(refresh),
            vscode.window.tabGroups.onDidChangeTabGroups(refresh)
        );

        this.refresh();
    }

    /**
     * 現在追跡している差分状態を返します。
     * @returns 現在の差分状態です。
     */
    get value(): ActiveDiffState | undefined {
        return this.currentState;
    }

    /**
     * 差分状態を再計算し、変更があれば通知します。
     */
    refresh(): void {
        const nextState = this.computeState();

        if (this.isSameState(this.currentState, nextState)) {
            return;
        }

        this.currentState = nextState;
        this.emitter.fire(nextState);
    }

    /**
     * トラッカーが保持しているリソースを解放します。
     */
    dispose(): void {
        this.emitter.dispose();
        vscode.Disposable.from(...this.disposables).dispose();
    }

    /**
     * 現在フォーカスされているタブから差分状態を組み立てます。
     * @returns フォーカス中の差分状態です。
     */
    private computeState(): ActiveDiffState | undefined {
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

        if (!activeTab || !(activeTab.input instanceof vscode.TabInputTextDiff)) {
            return undefined;
        }

        return {
            label: activeTab.label || this.getFallbackLabel(activeTab.input.modified),
            original: activeTab.input.original,
            modified: activeTab.input.modified
        };
    }

    /**
     * タブに表示ラベルがない場合のフォールバックラベルを作成します。
     * @param uri ラベル生成の元になる URI です。
     * @returns 表示用のフォールバックラベルです。
     */
    private getFallbackLabel(uri: vscode.Uri): string {
        const segments = uri.path.split('/');
        return segments[segments.length - 1] || 'Active Diff';
    }

    /**
     * 2 つの差分状態が同一内容かどうかを判定します。
     * @param left 比較元の差分状態です。
     * @param right 比較先の差分状態です。
     * @returns 同一なら true、それ以外は false です。
     */
    private isSameState(
        left: ActiveDiffState | undefined,
        right: ActiveDiffState | undefined
    ): boolean {
        if (!left && !right) {
            return true;
        }

        if (!left || !right) {
            return false;
        }

        return left.original.toString() === right.original.toString()
            && left.modified.toString() === right.modified.toString()
            && left.label === right.label;
    }
}