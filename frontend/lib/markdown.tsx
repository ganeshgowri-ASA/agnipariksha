/**
 * Tiny zero-dep markdown renderer. We deliberately do not pull in
 * react-markdown / shiki — the assistant's output is narrow (headings,
 * bold, inline code, code fences, simple lists, citation tags) and a
 * compact in-house renderer keeps the bundle small and predictable.
 *
 * Supports:
 *   - fenced code blocks ```lang ... ``` (no syntax highlighting library,
 *     but classnames are emitted so callers can style by language)
 *   - inline code `x`
 *   - bold **x**, italic *x*
 *   - level 1-3 headings (#, ##, ###)
 *   - unordered lists (-, *)
 *   - bracketed clause refs [MQT18] -> rendered as a pill
 */
import React from 'react';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function inline(s: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[A-Z]{2,4}\s?\d{1,3}\]|https?:\/\/\S+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) tokens.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) {
      tokens.push(<code key={key++} className="px-1 py-0.5 rounded bg-gray-800 font-mono text-[12px] text-orange-200">{t.slice(1, -1)}</code>);
    } else if (t.startsWith('**')) {
      tokens.push(<strong key={key++} className="text-white">{t.slice(2, -2)}</strong>);
    } else if (t.startsWith('*')) {
      tokens.push(<em key={key++}>{t.slice(1, -1)}</em>);
    } else if (t.startsWith('[') && t.endsWith(']')) {
      tokens.push(
        <span key={key++} className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-orange-900/40 border border-orange-700/60 text-orange-200 text-[10px] font-mono">
          {t.slice(1, -1)}
        </span>,
      );
    } else if (t.startsWith('http')) {
      tokens.push(<a key={key++} href={t} className="text-blue-300 underline" target="_blank" rel="noreferrer">{t}</a>);
    }
    last = m.index + t.length;
  }
  if (last < s.length) tokens.push(s.slice(last));
  return tokens;
}

export function Markdown({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;
  let listBuf: React.ReactNode[] = [];

  const flushList = () => {
    if (listBuf.length) {
      out.push(<ul key={key++} className="list-disc pl-5 space-y-0.5">{listBuf}</ul>);
      listBuf = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flushList();
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i]);
        i++;
      }
      i++;
      out.push(
        <pre key={key++} className={`my-2 p-3 rounded bg-black/60 border border-gray-800 overflow-x-auto text-[12px] font-mono text-gray-200`} data-lang={lang || 'text'}>
          <code dangerouslySetInnerHTML={{ __html: escapeHtml(body.join('\n')) }} />
        </pre>,
      );
      continue;
    }
    if (line.startsWith('### ')) {
      flushList();
      out.push(<h3 key={key++} className="text-sm font-semibold text-white mt-3 mb-1">{inline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      flushList();
      out.push(<h2 key={key++} className="text-base font-bold text-white mt-3 mb-1">{inline(line.slice(3))}</h2>);
    } else if (line.startsWith('# ')) {
      flushList();
      out.push(<h1 key={key++} className="text-lg font-bold text-white mt-3 mb-1">{inline(line.slice(2))}</h1>);
    } else if (/^\s*[-*]\s+/.test(line)) {
      listBuf.push(<li key={key++}>{inline(line.replace(/^\s*[-*]\s+/, ''))}</li>);
    } else if (line.trim() === '') {
      flushList();
      out.push(<div key={key++} className="h-2" />);
    } else {
      flushList();
      out.push(<p key={key++} className="text-sm leading-relaxed">{inline(line)}</p>);
    }
    i++;
  }
  flushList();
  return <div className="prose-invert text-gray-200">{out}</div>;
}
