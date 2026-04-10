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
 * @returns HTML 化されたハイライト結果です。
 */
export function highlightLine(line: string, languageId: string): string {
    if (!line.length) {
        return '';
    }

    const resolvedLanguage = languageAliases[languageId] || 'plaintext';

    try {
        return hljs.highlight(line, {
            language: resolvedLanguage,
            ignoreIllegals: true
        }).value;
    } catch {
        return escapeHtml(line);
    }
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