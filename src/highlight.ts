import hljs from 'highlight.js/lib/core';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);

const languageAliases: Record<string, string> = {
    css: 'css',
    html: 'xml',
    javascript: 'javascript',
    javascriptreact: 'javascript',
    json: 'json',
    jsonc: 'json',
    markdown: 'markdown',
    md: 'markdown',
    plaintext: 'plaintext',
    svg: 'xml',
    typescript: 'typescript',
    typescriptreact: 'typescript',
    xml: 'xml'
};

/**
 * 登録済みの言語から最適なものを選び、1 行分の構文ハイライトを生成します。
 * @param line ハイライト対象の行文字列です。
 * @param languageId VS Code の言語 ID です。
 * @param renderWhitespace 半角スペースとタブを可視化する場合は true です。
 * @returns HTML 化されたハイライト結果です。
 */
export function highlightLine(line: string, languageId: string, renderWhitespace = false): string {
    if (!line.length) {
        return '';
    }

    const resolvedLanguage = languageAliases[languageId] || 'plaintext';
    let highlightedLine: string;

    try {
        highlightedLine = hljs.highlight(line, {
            language: resolvedLanguage,
            ignoreIllegals: true
        }).value;
    } catch {
        highlightedLine = escapeHtml(line);
    }

    return renderWhitespace ? visualizeWhitespace(highlightedLine) : highlightedLine;
}

/**
 * HTML タグを壊さないようにしながら、テキストノード内の空白文字を可視化します。
 * @param value ハイライト済み HTML 文字列です。
 * @returns 空白可視化用の HTML を含む文字列です。
 */
function visualizeWhitespace(value: string): string {
    if (!/[ \t]/.test(value)) {
        return value;
    }

    let result = '';
    let insideTag = false;
    let insideEntity = false;

    for (const character of value) {
        if (insideTag) {
            result += character;

            if (character === '>') {
                insideTag = false;
            }

            continue;
        }

        if (insideEntity) {
            result += character;

            if (character === ';') {
                insideEntity = false;
            }

            continue;
        }

        if (character === '<') {
            insideTag = true;
            result += character;
            continue;
        }

        if (character === '&') {
            insideEntity = true;
            result += character;
            continue;
        }

        if (character === ' ') {
            result += '<span class="vd-ws vd-ws-space"> </span>';
            continue;
        }

        if (character === '\t') {
            result += '<span class="vd-ws vd-ws-tab">\t</span>';
            continue;
        }

        result += character;
    }

    return result;
}

/**
 * HTML へ埋め込む前に文字列をエスケープします。
 * @param value エスケープ対象の文字列です。
 * @returns エスケープ済みの文字列です。
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}