import { describe, expect, it } from 'vitest';
import {
  isPathWithin,
  isSafeExternalUrl,
  isSafeRelativePath,
  isSafeShellArgument,
  parseDeeplink,
  validateManifest,
  validateSnippetInput,
  validateQuicklinkInput,
  isValidQuicklinkTarget,
} from './index.js';

const validManifest = {
  name: 'github-search',
  title: 'GitHub Search',
  description: 'Search repositories and issues on GitHub.',
  author: 'orbit-labs',
  version: '1.2.0',
  platforms: ['windows', 'macos'],
  permissions: ['network'],
  commands: [{ name: 'search-repos', title: 'Search Repositories', mode: 'list' }],
};

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    const r = validateManifest(validManifest);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.name).toBe('github-search');
  });

  it('rejects an invalid name with traversal/metacharacters', () => {
    const r = validateManifest({ ...validManifest, name: '../evil' });
    expect(r.ok).toBe(false);
  });

  it('rejects an icon path with traversal', () => {
    const r = validateManifest({ ...validManifest, icon: '../../etc/passwd' });
    expect(r.ok).toBe(false);
  });

  it('rejects an absolute icon path', () => {
    expect(validateManifest({ ...validManifest, icon: '/etc/passwd' }).ok).toBe(false);
    expect(validateManifest({ ...validManifest, icon: 'C:\\windows\\evil.ico' }).ok).toBe(false);
  });

  it('rejects unknown permissions', () => {
    const r = validateManifest({ ...validManifest, permissions: ['root.access'] });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-semver version', () => {
    expect(validateManifest({ ...validManifest, version: 'latest' }).ok).toBe(false);
  });

  it('requires at least one command and platform', () => {
    expect(validateManifest({ ...validManifest, commands: [] }).ok).toBe(false);
    expect(validateManifest({ ...validManifest, platforms: [] }).ok).toBe(false);
  });

  it('bounds oversized fields', () => {
    const r = validateManifest({ ...validManifest, description: 'x'.repeat(2000) });
    expect(r.ok).toBe(false);
  });
});

describe('parseDeeplink', () => {
  it('parses known routes', () => {
    expect(parseDeeplink('orbit://open')).toEqual({ kind: 'open' });
    expect(parseDeeplink('orbit://command/builtin.window.left')).toEqual({
      kind: 'command',
      id: 'builtin.window.left',
    });
    expect(parseDeeplink('orbit://extension/github-search/search-repos')).toEqual({
      kind: 'extension',
      name: 'github-search',
      command: 'search-repos',
    });
    expect(parseDeeplink('orbit://agent/atlas/run')).toEqual({ kind: 'agent-run', id: 'atlas' });
    expect(parseDeeplink('orbit://ai/new')).toEqual({ kind: 'ai-new' });
  });

  it('rejects foreign schemes', () => {
    expect(parseDeeplink('https://evil.com/command/x')).toBeNull();
    expect(parseDeeplink('javascript:alert(1)')).toBeNull();
  });

  it('rejects unknown routes and malformed ids', () => {
    expect(parseDeeplink('orbit://exec/rm-rf')).toBeNull();
    expect(parseDeeplink('orbit://command/..%2f..%2fetc')).toBeNull();
    expect(parseDeeplink('orbit://extension/Bad_Name/cmd')).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(parseDeeplink('not a url')).toBeNull();
    expect(parseDeeplink('')).toBeNull();
  });
});

describe('path safety', () => {
  it('confines child paths to a root', () => {
    expect(isPathWithin('/home/u/.orbit/ext/a', '/home/u/.orbit/ext/a/data.json')).toBe(true);
    expect(isPathWithin('/home/u/.orbit/ext/a', '/home/u/.orbit/ext/b/data.json')).toBe(false);
    expect(isPathWithin('/home/u/.orbit/ext/a', '/home/u/.orbit/ext/a/../b')).toBe(false);
  });

  it('handles windows separators', () => {
    expect(isPathWithin('C:\\Data\\ext\\a', 'C:\\Data\\ext\\a\\file.txt')).toBe(true);
    expect(isPathWithin('C:\\Data\\ext\\a', 'C:\\Data\\ext\\a\\..\\b')).toBe(false);
  });

  it('validates relative paths', () => {
    expect(isSafeRelativePath('icons/logo.png')).toBe(true);
    expect(isSafeRelativePath('../secret')).toBe(false);
    expect(isSafeRelativePath('/abs')).toBe(false);
    expect(isSafeRelativePath('C:\\x')).toBe(false);
    expect(isSafeRelativePath('a\0b')).toBe(false);
  });
});

describe('validateSnippetInput', () => {
  const valid = { name: 'Signature', keyword: 'sig', content: 'Best,\nSimon' };

  it('accepts a well-formed snippet', () => {
    const r = validateSnippetInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.keyword).toBe('sig');
  });

  it('allows an omitted or empty keyword', () => {
    expect(validateSnippetInput({ name: 'No KW', content: 'body' }).ok).toBe(true);
    expect(validateSnippetInput({ ...valid, keyword: '' }).ok).toBe(true);
  });

  it('requires a name and content', () => {
    expect(validateSnippetInput({ ...valid, name: '   ' }).ok).toBe(false);
    expect(validateSnippetInput({ ...valid, content: '' }).ok).toBe(false);
  });

  it('rejects a keyword containing spaces', () => {
    expect(validateSnippetInput({ ...valid, keyword: 'my sig' }).ok).toBe(false);
  });

  it('bounds oversized content', () => {
    expect(validateSnippetInput({ ...valid, content: 'x'.repeat(100_001) }).ok).toBe(false);
  });
});

describe('shell & url safety', () => {
  it('blocks shell metacharacters', () => {
    expect(isSafeShellArgument('myfile.txt')).toBe(true);
    expect(isSafeShellArgument('a; rm -rf /')).toBe(false);
    expect(isSafeShellArgument('$(whoami)')).toBe(false);
    expect(isSafeShellArgument('a && b')).toBe(false);
    expect(isSafeShellArgument('`id`')).toBe(false);
  });

  it('allows only safe external url schemes', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('mailto:a@b.com')).toBe(true);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>')).toBe(false);
  });
});

describe('quicklink validation', () => {
  it('accepts http(s)/mailto URLs, templates and bare paths', () => {
    expect(isValidQuicklinkTarget('https://github.com')).toBe(true);
    expect(isValidQuicklinkTarget('https://google.com/search?q={query}')).toBe(true);
    expect(isValidQuicklinkTarget('mailto:a@b.com')).toBe(true);
    expect(isValidQuicklinkTarget('C:\\Users\\me\\notes')).toBe(true);
    expect(isValidQuicklinkTarget('/home/me/notes')).toBe(true);
  });

  it('rejects dangerous schemes', () => {
    expect(isValidQuicklinkTarget('javascript:alert(1)')).toBe(false);
    expect(isValidQuicklinkTarget('file:///etc/passwd')).toBe(false);
    expect(isValidQuicklinkTarget('data:text/html,x')).toBe(false);
    expect(isValidQuicklinkTarget('vbscript:msgbox')).toBe(false);
    expect(isValidQuicklinkTarget('')).toBe(false);
  });

  it('validates full quicklink input', () => {
    expect(
      validateQuicklinkInput({ title: 'GitHub', target: 'https://github.com', alias: 'gh' }).ok,
    ).toBe(true);
    expect(validateQuicklinkInput({ title: '', target: 'https://x.com' }).ok).toBe(false);
    expect(validateQuicklinkInput({ title: 'Bad', target: 'javascript:x' }).ok).toBe(false);
  });
});
