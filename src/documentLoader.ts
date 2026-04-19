import * as vscode from 'vscode';
import { TextDecoder } from 'node:util';
import { ActiveDiffState } from './activeDiffTracker';
import {
    buildDiffModel,
    DiffPaneMetadata,
    DiffRenderModel,
    RenderLimitError
} from './diffModel';

/**
 * パネル描画時に使う固定上限です。
 */
const MAX_FILE_SIZE_KB = 512;
const MAX_RENDERED_LINES = 8000;
const COMMON_DECODER_LABELS = [
    'utf-8',
    'utf-16le',
    'utf-16be',
    'shift_jis',
    'euc-jp',
    'iso-2022-jp',
    'gb18030',
    'big5',
    'euc-kr',
    'windows-1252'
] as const;

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
    encoding?: string;
    eol?: vscode.EndOfLine;
    lineCount: number;
    rawBytes?: Uint8Array;
}

/**
 * エンコーディング差吸収のために評価するテキスト候補です。
 */
interface TextCandidate {
    normalizedText: string;
    score: number;
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

    let [originalSide, modifiedSide] = await Promise.all([
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

    ({
        originalSide,
        modifiedSide
    } = harmonizeTextSidesForDiff(originalSide, modifiedSide));

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
                originalMeta: buildPaneMetadata(originalSide),
                modifiedMeta: buildPaneMetadata(modifiedSide),
                originalLanguage: originalSide.languageId,
                modifiedLanguage: modifiedSide.languageId,
                originalText: originalSide.text,
                modifiedText: modifiedSide.text,
                maxRenderedLines: MAX_RENDERED_LINES,
                renderWhitespace: getConfiguredRenderWhitespace()
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
        const [document, rawBytes] = await Promise.all([
            vscode.workspace.openTextDocument(uri),
            readRawBytes(uri)
        ]);

        return {
            label,
            languageId: document.languageId || 'plaintext',
            text: document.getText(),
            missing: false,
            encoding: document.encoding,
            eol: document.eol,
            lineCount: document.lineCount,
            rawBytes
        };
    } catch {
        return {
            label,
            languageId: 'plaintext',
            text: '',
            missing: true,
            encoding: undefined,
            eol: undefined,
            lineCount: 0,
            rawBytes: undefined
        };
    }
}

/**
 * 各ペインのヘッダーに表示するメタ情報を構築します。
 * @param side 差分片側の読み込み結果です。
 * @returns 表示用のメタ情報です。
 */
function buildPaneMetadata(side: TextSide): DiffPaneMetadata {
    if (side.missing) {
        return {
            encoding: 'N/A',
            lineEnding: 'N/A'
        };
    }

    return {
        encoding: formatEncodingLabel(side.encoding, side.rawBytes),
        lineEnding: formatLineEndingLabel(side)
    };
}

/**
 * 文字コード差や改行コード差だけで内容が一致する場合に、比較用テキストを同一内容へそろえます。
 * @param originalSide 元側の読み込み結果です。
 * @param modifiedSide 変更後側の読み込み結果です。
 * @returns 差分比較に使うテキストを調整した結果です。
 */
function harmonizeTextSidesForDiff(
    originalSide: TextSide,
    modifiedSide: TextSide
): { originalSide: TextSide; modifiedSide: TextSide; } {
    const sharedText = resolveSharedComparisonText(originalSide, modifiedSide);

    if (sharedText === undefined) {
        return {
            originalSide,
            modifiedSide
        };
    }

    return {
        originalSide: {
            ...originalSide,
            text: sharedText
        },
        modifiedSide: {
            ...modifiedSide,
            text: sharedText
        }
    };
}

/**
 * 2 つの入力に共通する比較用テキストを求めます。
 * @param originalSide 元側の読み込み結果です。
 * @param modifiedSide 変更後側の読み込み結果です。
 * @returns 共通テキストが見つかった場合はその文字列、見つからなければ undefined です。
 */
function resolveSharedComparisonText(originalSide: TextSide, modifiedSide: TextSide): string | undefined {
    const originalNormalized = normalizeComparisonText(originalSide.text);
    const modifiedNormalized = normalizeComparisonText(modifiedSide.text);

    if (originalNormalized === modifiedNormalized) {
        return originalNormalized;
    }

    if (!originalSide.rawBytes || !modifiedSide.rawBytes) {
        return undefined;
    }

    const originalCandidates = collectTextCandidates(originalSide);
    const modifiedCandidates = collectTextCandidates(modifiedSide);
    let bestMatch: { text: string; score: number; } | undefined;

    for (const originalCandidate of originalCandidates) {
        for (const modifiedCandidate of modifiedCandidates) {
            if (originalCandidate.normalizedText !== modifiedCandidate.normalizedText) {
                continue;
            }

            const score = originalCandidate.score + modifiedCandidate.score;

            if (!bestMatch || score > bestMatch.score) {
                bestMatch = {
                    text: originalCandidate.normalizedText,
                    score
                };
            }
        }
    }

    return bestMatch?.text;
}

/**
 * 現在のテキストと生バイトから比較候補を収集します。
 * @param side 差分片側の読み込み結果です。
 * @returns 評価対象のテキスト候補です。
 */
function collectTextCandidates(side: TextSide): TextCandidate[] {
    const candidateScores = new Map<string, number>();
    const preferredDecoderLabels = getDecoderLabelsForEncoding(side.encoding);
    const decoderLabels = new Set<string>([
        ...preferredDecoderLabels,
        ...COMMON_DECODER_LABELS
    ]);
    const bomDecoderLabel = detectBomDecoderLabel(side.rawBytes);

    addCandidateScore(candidateScores, side.text, 100);

    if (bomDecoderLabel) {
        decoderLabels.add(bomDecoderLabel);
    }

    for (const decoderLabel of decoderLabels) {
        const decoded = tryDecodeBytes(side.rawBytes, decoderLabel);

        if (decoded === undefined || !looksLikeText(decoded)) {
            continue;
        }

        let score = getDecoderBaseScore(decoderLabel);

        if (preferredDecoderLabels.includes(decoderLabel)) {
            score += 15;
        }

        if (bomDecoderLabel === decoderLabel) {
            score += 25;
        }

        addCandidateScore(candidateScores, decoded, score);
    }

    return Array.from(candidateScores.entries()).map(([normalizedText, score]) => ({
        normalizedText,
        score
    }));
}

/**
 * 比較候補へテキストを追加し、同値候補では高いスコアを保持します。
 * @param candidateScores 候補ごとのスコア表です。
 * @param value 追加する文字列です。
 * @param score 候補の優先度です。
 */
function addCandidateScore(candidateScores: Map<string, number>, value: string, score: number): void {
    const normalizedText = normalizeComparisonText(value);
    const currentScore = candidateScores.get(normalizedText);

    if (currentScore === undefined || score > currentScore) {
        candidateScores.set(normalizedText, score);
    }
}

/**
 * 比較時に無視する差異をならした文字列へ正規化します。
 * BOM、改行コード、Unicode 正規化差を吸収します。
 * @param value 正規化対象の文字列です。
 * @returns 比較用に正規化した文字列です。
 */
function normalizeComparisonText(value: string): string {
    const withoutBom = value.startsWith('\uFEFF') ? value.slice(1) : value;
    const normalizedLineEndings = withoutBom.replace(/\r\n?/g, '\n');
    return normalizedLineEndings.normalize('NFC');
}

/**
 * 表示用の文字コードラベルを返します。
 * @param encoding VS Code が報告するエンコーディング名です。
 * @param rawBytes 元の生バイト列です。
 * @returns 表示用ラベルです。
 */
function formatEncodingLabel(encoding: string | undefined, rawBytes: Uint8Array | undefined): string {
    switch ((encoding ?? '').toLowerCase()) {
        case 'utf8':
        case 'utf8bom':
            return 'UTF-8';
        case 'utf16le':
            return 'UTF-16 LE';
        case 'utf16be':
            return 'UTF-16 BE';
        case 'shiftjis':
            return 'Shift_JIS';
        case 'eucjp':
            return 'EUC-JP';
        case 'euckr':
            return 'EUC-KR';
        case 'gbk':
            return 'GBK';
        case 'gb18030':
        case 'gb2312':
            return 'GB18030';
        case 'cp950':
        case 'big5hkscs':
            return 'Big5';
        case 'windows1252':
            return 'Windows-1252';
        case 'iso88591':
            return 'ISO-8859-1';
        default: {
            const bomDecoderLabel = detectBomDecoderLabel(rawBytes);
            return bomDecoderLabel ? formatDecoderLabel(bomDecoderLabel) : 'Unknown';
        }
    }
}

/**
 * 表示用の改行コードラベルを返します。
 * @param side 差分片側の読み込み結果です。
 * @returns 表示用ラベルです。
 */
function formatLineEndingLabel(side: TextSide): string {
    if (side.lineCount <= 1) {
        return 'None';
    }

    if (side.eol === vscode.EndOfLine.CRLF) {
        return 'CRLF';
    }

    if (side.eol === vscode.EndOfLine.LF) {
        return 'LF';
    }

    return 'Unknown';
}

/**
 * TextDecoder ラベルを表示用の文字列へ変換します。
 * @param decoderLabel TextDecoder 用のラベルです。
 * @returns 表示用ラベルです。
 */
function formatDecoderLabel(decoderLabel: string): string {
    switch (decoderLabel) {
        case 'utf-8':
            return 'UTF-8';
        case 'utf-16le':
            return 'UTF-16 LE';
        case 'utf-16be':
            return 'UTF-16 BE';
        case 'shift_jis':
            return 'Shift_JIS';
        case 'euc-jp':
            return 'EUC-JP';
        case 'iso-2022-jp':
            return 'ISO-2022-JP';
        case 'gb18030':
            return 'GB18030';
        case 'big5':
            return 'Big5';
        case 'euc-kr':
            return 'EUC-KR';
        case 'windows-1252':
            return 'Windows-1252';
        case 'iso-8859-1':
            return 'ISO-8859-1';
        default:
            return decoderLabel;
    }
}

/**
 * VS Code のエンコーディング名を TextDecoder 用ラベルへ変換します。
 * @param encoding VS Code が報告するエンコーディング名です。
 * @returns TextDecoder に渡せる候補ラベルです。
 */
function getDecoderLabelsForEncoding(encoding: string | undefined): string[] {
    switch ((encoding ?? '').toLowerCase()) {
        case 'utf8':
        case 'utf8bom':
            return ['utf-8'];
        case 'utf16le':
            return ['utf-16le'];
        case 'utf16be':
            return ['utf-16be'];
        case 'shiftjis':
            return ['shift_jis'];
        case 'eucjp':
            return ['euc-jp'];
        case 'euckr':
            return ['euc-kr'];
        case 'gbk':
            return ['gbk'];
        case 'gb18030':
        case 'gb2312':
            return ['gb18030'];
        case 'cp950':
        case 'big5hkscs':
            return ['big5'];
        case 'windows1252':
            return ['windows-1252'];
        case 'iso88591':
            return ['iso-8859-1'];
        default:
            return [];
    }
}

/**
 * バイト列に付いている Unicode BOM を検出します。
 * @param rawBytes 判定対象のバイト列です。
 * @returns BOM に対応するデコーダー名です。
 */
function detectBomDecoderLabel(rawBytes: Uint8Array | undefined): string | undefined {
    if (!rawBytes || rawBytes.length < 2) {
        return undefined;
    }

    if (rawBytes.length >= 3
        && rawBytes[0] === 0xef
        && rawBytes[1] === 0xbb
        && rawBytes[2] === 0xbf) {
        return 'utf-8';
    }

    if (rawBytes[0] === 0xff && rawBytes[1] === 0xfe) {
        return 'utf-16le';
    }

    if (rawBytes[0] === 0xfe && rawBytes[1] === 0xff) {
        return 'utf-16be';
    }

    return undefined;
}

/**
 * 指定エンコーディングで生バイトをデコードします。
 * @param rawBytes デコード対象のバイト列です。
 * @param decoderLabel TextDecoder 用のラベルです。
 * @returns デコード済み文字列、失敗時は undefined です。
 */
function tryDecodeBytes(rawBytes: Uint8Array | undefined, decoderLabel: string): string | undefined {
    if (!rawBytes) {
        return undefined;
    }

    try {
        return new TextDecoder(decoderLabel, { fatal: true }).decode(rawBytes);
    } catch {
        return undefined;
    }
}

/**
 * 比較候補として扱って安全なテキストかどうかを判定します。
 * @param value 判定対象の文字列です。
 * @returns プレーンテキスト候補として妥当なら true、それ以外は false です。
 */
function looksLikeText(value: string): boolean {
    if (value.includes('\uFFFD') || containsNullByte(value)) {
        return false;
    }

    for (const character of value) {
        const codePoint = character.codePointAt(0);

        if (codePoint === undefined) {
            continue;
        }

        if (codePoint < 0x20
            && character !== '\n'
            && character !== '\r'
            && character !== '\t'
            && character !== '\f') {
            return false;
        }
    }

    return true;
}

/**
 * デコーダー候補の基準スコアを返します。
 * @param decoderLabel TextDecoder 用のラベルです。
 * @returns 候補スコアです。
 */
function getDecoderBaseScore(decoderLabel: string): number {
    switch (decoderLabel) {
        case 'utf-8':
            return 70;
        case 'utf-16le':
        case 'utf-16be':
            return 65;
        case 'shift_jis':
        case 'euc-jp':
        case 'iso-2022-jp':
        case 'gb18030':
        case 'big5':
        case 'euc-kr':
            return 50;
        case 'windows-1252':
        case 'iso-8859-1':
            return 35;
        default:
            return 30;
    }
}

/**
 * URI から生バイトを読み込みます。
 * @param uri 読み込み対象の URI です。
 * @returns 読み込めた場合は生バイト、未対応や失敗時は undefined です。
 */
async function readRawBytes(uri: vscode.Uri): Promise<Uint8Array | undefined> {
    try {
        return await vscode.workspace.fs.readFile(uri);
    } catch {
        return undefined;
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

/**
 * Vertical Diff の設定から空白可視化の有効状態を取得します。
 * @returns 可視化が有効な場合は true、それ以外は false です。
 */
function getConfiguredRenderWhitespace(): boolean {
    return vscode.workspace.getConfiguration('verticalDiff').get<boolean>('renderWhitespace') === true;
}