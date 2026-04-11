import * as vscode from 'vscode';
import { ActiveDiffState } from './activeDiffTracker';
import {
    buildDiffModel,
    DiffRenderModel,
    RenderLimitError
} from './diffModel';

/**
 * パネル描画時に使う固定上限です。
 */
const MAX_FILE_SIZE_KB = 512;
const MAX_RENDERED_LINES = 8000;

/**
 * プレースホルダー状態または差分描画状態を表します。
 */
export type ViewState =
    | {
        kind: 'placeholder';
        title: string;
        detail: string;
    }
    | {
        kind: 'diff';
        model: DiffRenderModel;
    };

/**
 * アクティブな差分の片側について読み込んだ内容を保持します。
 */
interface TextSide {
    label: string;
    languageId: string;
    text: string;
    missing: boolean;
}

/**
 * 現在追跡中の差分に対する表示状態を読み込み、検証します。
 * @param diffState 現在追跡中の差分状態です。
 * @returns 描画またはプレースホルダー用の表示状態です。
 */
export async function loadViewState(
    diffState: ActiveDiffState | undefined
): Promise<ViewState> {
    if (!diffState) {
        return {
            kind: 'placeholder',
            title: 'No Active Diff',
            detail: 'Open a text diff editor to mirror it in the panel.'
        };
    }

    const [originalSide, modifiedSide] = await Promise.all([
        readTextSide(diffState.original, 'Original'),
        readTextSide(diffState.modified, 'Modified')
    ]);

    if (originalSide.missing && modifiedSide.missing) {
        return {
            kind: 'placeholder',
            title: 'Unable To Read Diff',
            detail: 'Neither side of the active diff could be opened as text.'
        };
    }

    if (containsNullByte(originalSide.text) || containsNullByte(modifiedSide.text)) {
        return {
            kind: 'placeholder',
            title: 'Binary Or Unsupported Content',
            detail: 'The active diff contains content that cannot be rendered safely as text.'
        };
    }

    const maxFileSizeBytes = MAX_FILE_SIZE_KB * 1024;

    if (Buffer.byteLength(originalSide.text, 'utf8') > maxFileSizeBytes
        || Buffer.byteLength(modifiedSide.text, 'utf8') > maxFileSizeBytes) {
        return {
            kind: 'placeholder',
            title: 'Diff Too Large',
            detail: `Each side must be smaller than ${MAX_FILE_SIZE_KB} KB to render in the panel.`
        };
    }

    try {
        return {
            kind: 'diff',
            model: buildDiffModel({
                title: diffState.label,
                originalLabel: originalSide.missing ? `${originalSide.label} (empty)` : originalSide.label,
                modifiedLabel: modifiedSide.missing ? `${modifiedSide.label} (empty)` : modifiedSide.label,
                originalLanguage: originalSide.languageId,
                modifiedLanguage: modifiedSide.languageId,
                originalText: originalSide.text,
                modifiedText: modifiedSide.text,
                maxRenderedLines: MAX_RENDERED_LINES
            })
        };
    } catch (error) {
        if (error instanceof RenderLimitError) {
            return {
                kind: 'placeholder',
                title: 'Too Many Lines To Render',
                detail: `The active diff requires ${error.rowCount} aligned rows, which exceeds the fixed limit of ${error.maxRenderedLines}.`
            };
        }

        throw error;
    }
}

/**
 * 差分の片側をテキストとして開き、描画用のメタデータを返します。
 * @param uri 開く対象の URI です。
 * @param fallbackLabel ラベル生成時のフォールバック文字列です。
 * @returns 読み込み結果です。
 */
async function readTextSide(uri: vscode.Uri, fallbackLabel: string): Promise<TextSide> {
    const label = describeUri(uri, fallbackLabel);

    try {
        const document = await vscode.workspace.openTextDocument(uri);

        return {
            label,
            languageId: document.languageId || 'plaintext',
            text: document.getText(),
            missing: false
        };
    } catch {
        return {
            label,
            languageId: 'plaintext',
            text: '',
            missing: true
        };
    }
}

/**
 * パネルに表示する URI 用の読みやすいラベルを生成します。
 * @param uri 表示対象の URI です。
 * @param fallbackLabel フォールバック文字列です。
 * @returns 表示用ラベルです。
 */
function describeUri(uri: vscode.Uri, fallbackLabel: string): string {
    if (uri.scheme === 'file') {
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        return relativePath || uri.fsPath || fallbackLabel;
    }

    const segments = uri.path.split('/');
    const basename = segments[segments.length - 1] || fallbackLabel;
    return `${basename} [${uri.scheme}]`;
}

/**
 * プレーンテキストとして描画すべきでないバイナリ風の内容を検出します。
 * @param value 判定対象の文字列です。
 * @returns NULL バイトを含む場合は true、それ以外は false です。
 */
function containsNullByte(value: string): boolean {
    return value.includes('\u0000');
}