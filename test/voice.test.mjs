import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sourceURL = new URL('../voice.ts', import.meta.url);
const piURL = import.meta.resolve('@earendil-works/pi-coding-agent');
const source = stripTypeScriptTypes(readFileSync(sourceURL, 'utf8'))
  .replace(/import \{[^}]*\} from "@earendil-works\/pi-coding-agent";/,
    `import { parseFrontmatter } from ${JSON.stringify(piURL)};\nconst getAgentDir = () => globalThis.__voiceTestDir;`)
  .replaceAll('import.meta.url', JSON.stringify(sourceURL.href));
const { default: voice } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function markdown(description, prompt) {
  return `---\ndescription: ${JSON.stringify(description)}\n---\n\n${prompt}\n`;
}

function setup(t, state, personal = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-voice-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  globalThis.__voiceTestDir = dir;
  if (state) writeFileSync(join(dir, state[0]), state[1]);
  if (Object.keys(personal).length) {
    mkdirSync(join(dir, 'voices'));
    for (const [name, contents] of Object.entries(personal)) writeFileSync(join(dir, 'voices', name), contents);
  }
  const handlers = {}, commands = {}, notices = [];
  const ctx = { hasUI: false, ui: { notify: (...args) => notices.push(args) } };
  voice({ on: (name, handler) => handlers[name] = handler, registerCommand: (name, command) => commands[name] = command });
  handlers.session_start({}, ctx);
  const sections = () => {
    const event = { systemPromptOptions: { sections: { unrelated: 'keep' } } };
    handlers.before_agent_start(event);
    return event.systemPromptOptions.sections;
  };
  return { dir, handlers, commands, notices, ctx, sections };
}

test('aliases, completions, default, and noninteractive usage', (t) => {
  const s = setup(t);
  assert.equal(s.commands.voice, s.commands['output-style']);
  assert.equal(s.commands.voice, s.commands['output-styles']);
  assert.deepEqual(s.sections(), { unrelated: 'keep' });
  assert.deepEqual(s.notices, []);
  assert.equal(s.commands.voice.getArgumentCompletions('con')[0].value, 'concise');
  assert.equal(s.commands.voice.getArgumentCompletions('missing'), null);
  return s.commands.voice.handler('', s.ctx).then(() => assert.match(s.notices.at(-1)[0], /Use \/voice/));
});

test('legacy state, selection persistence, invalid input, and reset', async (t) => {
  const s = setup(t, ['output-style.json', '{"style":"concise"}']);
  assert.match(s.sections().voice, /Lead with the result/);
  await s.commands.voice.handler('proactive', s.ctx);
  assert.deepEqual(JSON.parse(readFileSync(join(s.dir, 'voice.json'))), { voice: 'proactive' });
  assert.match(s.sections().voice, /Work autonomously/);
  await s.commands.voice.handler('unknown', s.ctx);
  assert.match(s.sections().voice, /Work autonomously/);
  assert.equal(s.notices.at(-1)[1], 'error');
  assert.equal(readdirSync(s.dir).some(name => name.endsWith('.tmp')), false);
  await s.commands.voice.handler('default', s.ctx);
  assert.deepEqual(s.sections(), { unrelated: 'keep' });
});

test('new state takes precedence and malformed state warns', (t) => {
  const s = setup(t, ['voice.json', '{"voice":"learning"}']);
  writeFileSync(join(s.dir, 'output-style.json'), '{"style":"concise"}');
  s.handlers.session_start({}, s.ctx);
  assert.match(s.sections().voice, /TODO\(human\)/);
  writeFileSync(join(s.dir, 'voice.json'), 'invalid');
  s.handlers.session_start({}, s.ctx);
  assert.deepEqual(s.sections(), { unrelated: 'keep' });
  assert.equal(s.notices.at(-1)[1], 'warning');
});

test('picker cancellation leaves state unchanged', async (t) => {
  const s = setup(t);
  s.ctx.hasUI = true;
  s.ctx.ui.select = async (title) => { assert.equal(title, 'Voice'); return undefined; };
  await s.commands.voice.handler('', s.ctx);
  assert.deepEqual(s.sections(), { unrelated: 'keep' });
  assert.deepEqual(readdirSync(s.dir), []);
});

test('failed persistence does not change active selection', async (t) => {
  const s = setup(t, ['voice.json', '{"voice":"concise"}']);
  rmSync(s.dir, { recursive: true });
  writeFileSync(s.dir, 'not a directory');
  await s.commands.voice.handler('proactive', s.ctx);
  assert.match(s.sections().voice, /Lead with the result/);
  assert.equal(s.notices.at(-1)[1], 'error');
});

test('personal additions and overrides load before restoring state', async (t) => {
  const s = setup(t, ['voice.json', '{"voice":"warm"}'], {
    'warm.md': '\uFEFF' + markdown('Warm and conversational', 'Be warm.').replaceAll('\n', '\r\n'),
    'concise.md': markdown('My concise voice', 'Keep it tiny.'),
    'ignored.txt': 'Ignored\nDo not load',
    '__proto__.md': markdown('Unusual name', 'Still a voice.'),
  });
  assert.equal(s.sections().voice, 'Be warm.');
  assert.match(s.commands.voice.getArgumentCompletions('warm')[0].label, /Warm and conversational/);
  assert.equal(s.commands.voice.getArgumentCompletions('ignored'), null);
  await s.commands.voice.handler('concise', s.ctx);
  assert.equal(s.sections().voice, 'Keep it tiny.');
  await s.commands.voice.handler('__proto__', s.ctx);
  assert.equal(s.sections().voice, 'Still a voice.');
  assert.deepEqual(s.notices.filter(([, level]) => level === 'warning'), []);
});

test('refresh sees additions, edits, deletion, and resets removed overrides', async (t) => {
  const s = setup(t, ['voice.json', '{"voice":"concise"}'], { 'concise.md': markdown('Custom', 'Custom prompt') });
  assert.equal(s.sections().voice, 'Custom prompt');
  writeFileSync(join(s.dir, 'voices', 'concise.md'), markdown('Edited', 'Edited prompt'));
  writeFileSync(join(s.dir, 'voices', 'warm.md'), markdown('Warm', 'Warm prompt'));
  s.handlers.session_start({}, s.ctx);
  assert.equal(s.sections().voice, 'Edited prompt');
  assert.match(s.commands.voice.getArgumentCompletions('con')[0].label, /Edited/);
  await s.commands.voice.handler('warm', s.ctx);
  rmSync(join(s.dir, 'voices', 'warm.md'));
  rmSync(join(s.dir, 'voices', 'concise.md'));
  s.handlers.session_start({}, s.ctx);
  assert.deepEqual(s.sections(), { unrelated: 'keep' });
  assert.equal(s.commands.voice.getArgumentCompletions('warm'), null);
  assert.equal(s.notices.at(-1)[1], 'warning');
  await s.commands.voice.handler('concise', s.ctx);
  assert.match(s.sections().voice, /Lead with the result/);
});

test('invalid files warn without replacing built-ins or reserved default', async (t) => {
  const s = setup(t, ['voice.json', '{"voice":"concise"}'], {
    'concise.md': markdown('Description only', '  '),
    'default.md': markdown('Attempted override', 'Do something'),
    'empty.md': '',
    'no-description.md': markdown('', 'Some prompt'),
  });
  assert.match(s.sections().voice, /Lead with the result/);
  for (const name of ['concise', 'default', 'empty', 'no-description']) {
    assert.ok(s.notices.some(([message, level]) => level === 'warning' && message.includes(`${name}.md`)));
  }
  assert.equal(s.commands.voice.getArgumentCompletions('empty'), null);
  await s.commands.voice.handler('default', s.ctx);
  assert.deepEqual(s.sections(), { unrelated: 'keep' });
});

test('directory and file read failures preserve built-ins', (t) => {
  const s = setup(t, ['voice.json', '{"voice":"concise"}']);
  const directory = join(s.dir, 'voices');
  writeFileSync(directory, 'not a directory');
  s.handlers.session_start({}, s.ctx);
  assert.match(s.sections().voice, /Lead with the result/);
  assert.ok(s.notices.some(([message]) => message.includes(directory)));
  rmSync(directory);
  mkdirSync(directory);
  // A self-referencing symlink reliably fails even when tests run as root.
  symlinkSync('concise.md', join(directory, 'concise.md'));
  writeFileSync(join(directory, 'warm.md'), markdown('Warm', 'Warm prompt'));
  s.handlers.session_start({}, s.ctx);
  assert.equal(s.commands.voice.getArgumentCompletions('warm')[0].value, 'warm');
  assert.match(s.sections().voice, /Lead with the result/);
  assert.ok(s.notices.some(([message]) => message.includes('concise.md')));
});

test('removing a saved override automatically restores the bundled voice', (t) => {
  const s = setup(t, ['voice.json', '{"voice":"concise"}'], { 'concise.md': markdown('Custom', 'Custom prompt') });
  assert.equal(s.sections().voice, 'Custom prompt');
  rmSync(join(s.dir, 'voices', 'concise.md'));
  s.handlers.session_start({}, s.ctx);
  assert.match(s.sections().voice, /Lead with the result/);
  assert.deepEqual(s.notices, []);
});

test('standard YAML descriptions and body separators are preserved', async (t) => {
  for (const [metadata, description] of [
    ['description: Plain description', 'Plain description'],
    ['description: "Quoted: description"', 'Quoted: description'],
    ['description: >\n  Folded\n  description', 'Folded description'],
    ['description: |\n  Two\n  lines', 'Two\nlines'],
  ]) {
    const s = setup(t, undefined, { 'custom.md': `---\n${metadata}\n---\n\nFirst paragraph\n\n---\n\nLast paragraph` });
    assert.deepEqual(s.notices, []);
    assert.ok(s.commands.voice.getArgumentCompletions('custom')[0].label.endsWith(description));
    await s.commands.voice.handler('custom', s.ctx);
    assert.equal(s.sections().voice, 'First paragraph\n\n---\n\nLast paragraph');
  }
});

test('invalid frontmatter and old syntax are rejected with per-file isolation', (t) => {
  const invalid = [
    'Old description\nOld prompt',
    '---\ndescription: Missing closing delimiter\nPrompt',
    '---\ndescription: [\n---\nPrompt',
    '---\ndescription: One\ndescription: Two\n---\nPrompt',
    '---\nother: Missing description\n---\nPrompt',
    ...['null', '42', 'true', '[]', '{}', '""', '"   "'].map(value => `---\ndescription: ${value}\n---\nPrompt`),
    markdown('Empty body', ''),
  ];
  for (const contents of invalid) {
    const s = setup(t, ['voice.json', '{"voice":"concise"}'], {
      'concise.md': contents,
      'warm.md': markdown('Warm', 'Be warm'),
    });
    assert.match(s.sections().voice, /Lead with the result/);
    assert.ok(s.notices.some(([message, level]) => level === 'warning' && message.includes('concise.md')));
    assert.equal(s.commands.voice.getArgumentCompletions('warm')[0].value, 'warm');
  }
});

test('old-format personal-only selection falls back to default', (t) => {
  const s = setup(t, ['voice.json', '{"voice":"warm"}'], { 'warm.md': 'Warm\nBe warm' });
  assert.deepEqual(s.sections(), { unrelated: 'keep' });
  assert.equal(s.commands.voice.getArgumentCompletions('warm'), null);
  assert.equal(s.notices.filter(([, level]) => level === 'warning').length, 2);
});

test('extension instances keep independent catalogs', async (t) => {
  const a = setup(t, undefined, { 'warm.md': markdown('Warm', 'Be warm') });
  const b = setup(t);
  assert.equal(b.commands.voice.getArgumentCompletions('warm'), null);
  await a.commands.voice.handler('warm', a.ctx);
  assert.equal(a.sections().voice, 'Be warm');
  assert.deepEqual(b.sections(), { unrelated: 'keep' });
});
