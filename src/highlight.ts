import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import clojure from 'highlight.js/lib/languages/clojure';
import coffeescript from 'highlight.js/lib/languages/coffeescript';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import elixir from 'highlight.js/lib/languages/elixir';
import erlang from 'highlight.js/lib/languages/erlang';
import fsharp from 'highlight.js/lib/languages/fsharp';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import groovy from 'highlight.js/lib/languages/groovy';
import haskell from 'highlight.js/lib/languages/haskell';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import julia from 'highlight.js/lib/languages/julia';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import nginx from 'highlight.js/lib/languages/nginx';
import objectivec from 'highlight.js/lib/languages/objectivec';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import vbnet from 'highlight.js/lib/languages/vbnet';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('clojure', clojure);
hljs.registerLanguage('coffeescript', coffeescript);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('dart', dart);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('dos', dos);
hljs.registerLanguage('elixir', elixir);
hljs.registerLanguage('erlang', erlang);
hljs.registerLanguage('fsharp', fsharp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('graphql', graphql);
hljs.registerLanguage('groovy', groovy);
hljs.registerLanguage('haskell', haskell);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('julia', julia);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('latex', latex);
hljs.registerLanguage('less', less);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('makefile', makefile);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('nginx', nginx);
hljs.registerLanguage('objectivec', objectivec);
hljs.registerLanguage('perl', perl);
hljs.registerLanguage('php', php);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('r', r);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('vbnet', vbnet);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

const languageAliases: Record<string, string> = {
    bat: 'dos',
    c: 'c',
    clojure: 'clojure',
    coffeescript: 'coffeescript',
    cpp: 'cpp',
    csharp: 'csharp',
    css: 'css',
    dart: 'dart',
    dockerfile: 'dockerfile',
    elixir: 'elixir',
    erlang: 'erlang',
    fsharp: 'fsharp',
    go: 'go',
    graphql: 'graphql',
    groovy: 'groovy',
    handlebars: 'xml',
    haskell: 'haskell',
    html: 'xml',
    ini: 'ini',
    java: 'java',
    javascript: 'javascript',
    javascriptreact: 'javascript',
    json: 'json',
    jsonc: 'json',
    julia: 'julia',
    kotlin: 'kotlin',
    latex: 'latex',
    less: 'less',
    lua: 'lua',
    makefile: 'makefile',
    markdown: 'markdown',
    md: 'markdown',
    nginx: 'nginx',
    'objective-c': 'objectivec',
    perl: 'perl',
    php: 'php',
    plaintext: 'plaintext',
    powershell: 'powershell',
    properties: 'ini',
    python: 'python',
    r: 'r',
    ruby: 'ruby',
    rust: 'rust',
    scala: 'scala',
    scss: 'scss',
    shellscript: 'bash',
    sql: 'sql',
    svg: 'xml',
    swift: 'swift',
    toml: 'ini',
    typescript: 'typescript',
    typescriptreact: 'typescript',
    vb: 'vbnet',
    xml: 'xml',
    yaml: 'yaml'
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