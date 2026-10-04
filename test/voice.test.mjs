import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sourceURL = new URL('../voice.ts', import.meta.url);
const source = stripTypeScriptTypes(readFileSync(sourceURL, 'utf8'))
  .replace(/import \{\s*getAgentDir\s*\} from [^;]+;/, 'const getAgentDir = () => globalThis.__voiceTestDir;')
  .replaceAll('import.meta.url', JSON.stringify(sourceURL.href));
const { default: voice } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function setup(t, state) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-voice-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  globalThis.__voiceTestDir = dir;
  if (state) writeFileSync(join(dir, state[0]), state[1]);
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
