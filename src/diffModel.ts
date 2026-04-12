import { diffLines } from 'diff';
import { highlightLine } from './highlight';

/**
 * 描画行の見た目上の種別です。
 */
export type RenderLineKind = 'equal' | 'insert' | 'delete' | 'placeholder' | 'insert-placeholder' | 'delete-placeholder';

/**
 * 縦積み差分ビューの片側に表示する 1 行分のデータです。
 */
export interface RenderLine {
    lineNumber: number | null;
    text: string;
    html: string;
    kind: RenderLineKind;
}

/**
 * 整列済み差分モデル内の連続した変更範囲です。
 */
export interface DiffHunk {
    id: number;
    startRow: number;
    endRow: number;
    originalStartLine: number | null;
    originalEndLine: number | null;
    modifiedStartLine: number | null;
    modifiedEndLine: number | null;
}

/**
 * Webview へ渡す整列済みの描画モデル全体です。
 */
export interface DiffRenderModel {
    title: string;
    originalLabel: string;
    modifiedLabel: string;
    original: RenderLine[];
    modified: RenderLine[];
    hunks: DiffHunk[];
}

/**
 * 差分描画モデルの構築方法を定義します。
 */
export interface BuildDiffModelOptions {
    title: string;
    originalLabel: string;
    modifiedLabel: string;
    originalLanguage: string;
    modifiedLanguage: string;
    originalText: string;
    modifiedText: string;
    maxRenderedLines: number;
    renderWhitespace: boolean;
}

/**
 * 整列済み差分の行数が上限を超えたときに送出されます。
 */
export class RenderLimitError extends Error {
    /**
     * 行数上限超過エラーを初期化します。
     * @param rowCount 実際に必要だった行数です。
     * @param maxRenderedLines 許可される最大行数です。
     */
    constructor(
        readonly rowCount: number,
        readonly maxRenderedLines: number
    ) {
        super(`The diff requires ${rowCount} rows but the limit is ${maxRenderedLines}.`);
    }
}

/**
 * 2 つの行テキストを比較し、変更部分を inline-removed / inline-added span でマークした
 * ハイライト済み HTML のペアを返します。
 * @param originalText 元の行の生テキストです。
 * @param modifiedText 変更後の行の生テキストです。
 * @param originalLanguageId 元の行に使う言語 ID です。
 * @param modifiedLanguageId 変更後の行に使う言語 ID です。
 * @returns 両側のインライン差分 HTML です。
 */
function buildInlineHighlightedDiffPair(
    originalText: string,
    modifiedText: string,
    originalLanguageId: string,
    modifiedLanguageId: string,
    renderWhitespace: boolean
): { originalHtml: string; modifiedHtml: string; } {
    let prefixLength = 0;
    const commonPrefixLimit = Math.min(originalText.length, modifiedText.length);

    while (prefixLength < commonPrefixLimit && originalText[prefixLength] === modifiedText[prefixLength]) {
        prefixLength += 1;
    }

    let suffixLength = 0;
    const originalRemaining = originalText.length - prefixLength;
    const modifiedRemaining = modifiedText.length - prefixLength;
    const commonSuffixLimit = Math.min(originalRemaining, modifiedRemaining);

    while (
        suffixLength < commonSuffixLimit
        && originalText[originalText.length - 1 - suffixLength] === modifiedText[modifiedText.length - 1 - suffixLength]
    ) {
        suffixLength += 1;
    }

    const originalMiddleEnd = originalText.length - suffixLength;
    const modifiedMiddleEnd = modifiedText.length - suffixLength;

    const originalPrefixHtml = highlightLine(originalText.slice(0, prefixLength), originalLanguageId, renderWhitespace);
    const originalMiddleHtml = highlightLine(originalText.slice(prefixLength, originalMiddleEnd), originalLanguageId, renderWhitespace);
    const originalSuffixHtml = highlightLine(originalText.slice(originalMiddleEnd), originalLanguageId, renderWhitespace);

    const modifiedPrefixHtml = highlightLine(modifiedText.slice(0, prefixLength), modifiedLanguageId, renderWhitespace);
    const modifiedMiddleHtml = highlightLine(modifiedText.slice(prefixLength, modifiedMiddleEnd), modifiedLanguageId, renderWhitespace);
    const modifiedSuffixHtml = highlightLine(modifiedText.slice(modifiedMiddleEnd), modifiedLanguageId, renderWhitespace);

    return {
        originalHtml: originalPrefixHtml + wrapInlineDiffSpan(originalMiddleHtml, 'inline-removed') + originalSuffixHtml,
        modifiedHtml: modifiedPrefixHtml + wrapInlineDiffSpan(modifiedMiddleHtml, 'inline-added') + modifiedSuffixHtml
    };
}

/**
 * インライン差分用のスパン HTML を生成します。
 * @param html ラップ対象の HTML 文字列です。
 * @param className 適用するクラス名です。
 * @returns ラップ後の HTML 文字列です。
 */
function wrapInlineDiffSpan(html: string, className: string): string {
    if (!html) {
        return '';
    }

    return `<span class="${className}">${html}</span>`;
}

/**
 * Webview レンダラー向けの整列済み差分モデルを構築します。
 * @param options 差分モデル構築の設定です。
 * @returns 描画用の差分モデルです。
 */
export function buildDiffModel(options: BuildDiffModelOptions): DiffRenderModel {
    const originalRows: RenderLine[] = [];
    const modifiedRows: RenderLine[] = [];
    const hunks: DiffHunk[] = [];
    const changes = diffLines(options.originalText, options.modifiedText);

    let rowCount = 0;
    let originalLineNumber = 1;
    let modifiedLineNumber = 1;

    /** 現在の行数が上限を超えていれば RenderLimitError を投げます。 */
    const ensureLimit = () => {
        if (rowCount > options.maxRenderedLines) {
            throw new RenderLimitError(rowCount, options.maxRenderedLines);
        }
    };

    /**
     * 両側へ equal 行を追加します。
     * @param lines 追加する行文字列の配列です。
     */
    const pushEqualLines = (lines: string[]) => {
        for (const line of lines) {
            originalRows.push(createLine(originalLineNumber++, line, 'equal', options.originalLanguage, options.renderWhitespace));
            modifiedRows.push(createLine(modifiedLineNumber++, line, 'equal', options.modifiedLanguage, options.renderWhitespace));
            rowCount += 1;
            ensureLimit();
        }
    };

    /**
     * 挿入行と対応するプレースホルダーを追加し、ハンクを記録します。
     * @param lines 挿入行文字列の配列です。
     */
    const pushInsertion = (lines: string[]) => {
        if (!lines.length) {
            return;
        }

        const startRow = rowCount;
        const modifiedStartLine = modifiedLineNumber;

        for (const line of lines) {
            originalRows.push(createPlaceholder('insert-placeholder'));
            modifiedRows.push(createLine(modifiedLineNumber++, line, 'insert', options.modifiedLanguage, options.renderWhitespace));
            rowCount += 1;
            ensureLimit();
        }

        hunks.push({
            id: hunks.length,
            startRow,
            endRow: rowCount - 1,
            originalStartLine: null,
            originalEndLine: null,
            modifiedStartLine,
            modifiedEndLine: modifiedLineNumber - 1
        });
    };

    /**
     * 削除行と対応するプレースホルダーを追加し、ハンクを記録します。
     * @param lines 削除行文字列の配列です。
     */
    const pushDeletion = (lines: string[]) => {
        if (!lines.length) {
            return;
        }

        const startRow = rowCount;
        const originalStartLine = originalLineNumber;

        for (const line of lines) {
            originalRows.push(createLine(originalLineNumber++, line, 'delete', options.originalLanguage, options.renderWhitespace));
            modifiedRows.push(createPlaceholder('delete-placeholder'));
            rowCount += 1;
            ensureLimit();
        }

        hunks.push({
            id: hunks.length,
            startRow,
            endRow: rowCount - 1,
            originalStartLine,
            originalEndLine: originalLineNumber - 1,
            modifiedStartLine: null,
            modifiedEndLine: null
        });
    };

    /**
     * 削除行と追加行を整列して配置し、ハンクを記録します。
     * @param removedLines 削除行文字列の配列です。
     * @param addedLines 追加行文字列の配列です。
     */
    const pushReplacement = (removedLines: string[], addedLines: string[]) => {
        const rowSpan = Math.max(removedLines.length, addedLines.length);

        if (!rowSpan) {
            return;
        }

        const startRow = rowCount;
        const originalStartLine = removedLines.length ? originalLineNumber : null;
        const modifiedStartLine = addedLines.length ? modifiedLineNumber : null;

        for (let index = 0; index < rowSpan; index += 1) {
            const removedLine = removedLines[index];
            const addedLine = addedLines[index];

            const originalRow = removedLine === undefined
                ? createPlaceholder('insert-placeholder')
                : createLine(originalLineNumber++, removedLine, 'delete', options.originalLanguage, options.renderWhitespace);

            const modifiedRow = addedLine === undefined
                ? createPlaceholder('delete-placeholder')
                : createLine(modifiedLineNumber++, addedLine, 'insert', options.modifiedLanguage, options.renderWhitespace);

            if (removedLine !== undefined && addedLine !== undefined) {
                const inlinePair = buildInlineHighlightedDiffPair(
                    removedLine,
                    addedLine,
                    options.originalLanguage,
                    options.modifiedLanguage,
                    options.renderWhitespace
                );
                originalRow.html = inlinePair.originalHtml;
                modifiedRow.html = inlinePair.modifiedHtml;
            }

            originalRows.push(originalRow);
            modifiedRows.push(modifiedRow);
            rowCount += 1;
            ensureLimit();
        }

        hunks.push({
            id: hunks.length,
            startRow,
            endRow: rowCount - 1,
            originalStartLine,
            originalEndLine: removedLines.length ? originalLineNumber - 1 : null,
            modifiedStartLine,
            modifiedEndLine: addedLines.length ? modifiedLineNumber - 1 : null
        });
    };

    for (let index = 0; index < changes.length; index += 1) {
        const part = changes[index];
        const lines = splitLines(part.value);

        if (part.removed && changes[index + 1]?.added) {
            const addedLines = splitLines(changes[index + 1].value);
            pushReplacement(lines, addedLines);
            index += 1;
            continue;
        }

        if (part.added) {
            pushInsertion(lines);
            continue;
        }

        if (part.removed) {
            pushDeletion(lines);
            continue;
        }

        pushEqualLines(lines);
    }

    const mergedHunks = mergeAdjacentHunks(hunks);

    return {
        title: options.title,
        originalLabel: options.originalLabel,
        modifiedLabel: options.modifiedLabel,
        original: originalRows,
        modified: modifiedRows,
        hunks: mergedHunks
    };
}

/**
 * 行が隣接しているハンクを 1 つにまとめます。
 * @param hunks マージ前のハンク配列です。
 * @returns マージ後のハンク配列です。
 */
function mergeAdjacentHunks(hunks: DiffHunk[]): DiffHunk[] {
    const merged: DiffHunk[] = [];

    for (const hunk of hunks) {
        if (merged.length > 0) {
            const prev = merged[merged.length - 1];

            if (prev.endRow + 1 === hunk.startRow) {
                prev.endRow = hunk.endRow;

                if (prev.originalStartLine === null) {
                    prev.originalStartLine = hunk.originalStartLine;
                }
                if (hunk.originalEndLine !== null) {
                    prev.originalEndLine = hunk.originalEndLine;
                }

                if (prev.modifiedStartLine === null) {
                    prev.modifiedStartLine = hunk.modifiedStartLine;
                }
                if (hunk.modifiedEndLine !== null) {
                    prev.modifiedEndLine = hunk.modifiedEndLine;
                }

                continue;
            }
        }

        merged.push({ ...hunk, id: merged.length });
    }

    return merged;
}

/**
 * 実際のソース行から描画用の行データを生成します。
 * @param lineNumber 元の行番号です。
 * @param value 行の文字列です。
 * @param kind 行の種別です。
 * @param languageId 構文ハイライトに使う言語 ID です。
 * @returns 描画用の行データです。
 */
function createLine(
    lineNumber: number,
    value: string,
    kind: RenderLineKind,
    languageId: string,
    renderWhitespace: boolean
): RenderLine {
    return {
        lineNumber,
        text: value,
        html: highlightLine(value, languageId, renderWhitespace),
        kind
    };
}

/**
 * 片側の差分を揃えるためのプレースホルダー行を生成します。
 * @param kind プレースホルダーの種別です。
 * @returns プレースホルダー行です。
 */
function createPlaceholder(kind: RenderLineKind = 'placeholder'): RenderLine {
    return {
        lineNumber: null,
        text: '',
        html: '',
        kind
    };
}

/**
 * 差分チャンクを正規化された論理行へ分割します。
 * @param value 分割対象の文字列です。
 * @returns 正規化済みの行配列です。
 */
function splitLines(value: string): string[] {
    if (!value.length) {
        return [];
    }

    const normalized = value.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    if (lines[lines.length - 1] === '') {
        lines.pop();
    }

    return lines;
}