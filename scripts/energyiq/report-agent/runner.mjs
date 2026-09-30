import { checkReportBrowser } from './report-browser.mjs';
import { reviewReport } from './report-review.mjs';
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager, DefaultResourceLoader } from '/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const pending = new Map();
const pendingTools = new Map();
let configure;
const configPromise = new Promise(resolve => { configure = resolve; });
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'config') configure(message);
  const request = pending.get(message.id);
  if (message.type === 'response' && request) { request.res.writeHead(message.status, { 'content-type': message.contentType }).end(message.body); request.resolve(); pending.delete(message.id); }
  if (message.type === 'response_start' && request) request.res.writeHead(200, { 'content-type': message.contentType });
  if (message.type === 'response_chunk' && request) request.res.write(Buffer.from(message.body, 'base64'));
  if (message.type === 'response_end' && request) { request.res.end(); request.resolve(); pending.delete(message.id); }
  if (message.type === 'tool_response') { pendingTools.get(message.id)?.(message); pendingTools.delete(message.id); }
  if (message.type === 'shutdown') process.exit(0);
});
for (const path of ['inputs', 'outputs', 'restore', 'work', 'state/agent', 'state/sessions']) mkdirSync('/workspace/' + path, { recursive: true });
process.chdir('/workspace/work');
emit({ type: 'ready', projectToolsVersion: 1, reportReviewVersion: 1, textStreamingVersion: 1, browserReviewVersion: 1, anthropicMessagesVersion: 1 });
const config = await configPromise;
const anthropic = config.apiProtocol === 'anthropic-messages';
if (config.apiProtocol && !['anthropic-messages', 'openai-completions'].includes(config.apiProtocol)) throw Error('REPORT_MODEL_PROTOCOL_UNSUPPORTED');
for (const file of config.files ?? []) {
  if (!['inputs', 'state'].includes(file.area) || /[\\:\x00]/.test(file.path) || file.path.split('/').some(part => part === '..') || file.path.startsWith('/')) throw Error('INVALID_INPUT_PATH');
  const path = join('/workspace', file.area, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(file.content, 'base64'));
}
let requests = 0;
const bridge = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== (anthropic ? '/v1/messages' : '/v1/chat/completions')) { res.writeHead(404).end(); return; }
  try {
    const chunks = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw Error('REQUEST_LIMIT'); chunks.push(chunk); }
    const id = String(++requests);
    const response = new Promise(resolve => pending.set(id, { resolve, res }));
    emit({ type: 'request', id, body: JSON.parse(Buffer.concat(chunks).toString()) });
    await response;
  } catch { res.writeHead(502).end('{"error":"REPORT_MODEL_REQUEST_FAILED"}'); }
});
await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
const agentDir = '/workspace/state/agent';
writeFileSync(agentDir + '/models.json', JSON.stringify({ providers: { energyiq: {
  baseUrl: `http://127.0.0.1:${bridge.address().port}${anthropic ? '' : '/v1'}`, api: anthropic ? 'anthropic-messages' : 'openai-completions', apiKey: 'local-stdio-bridge',
  models: [{ id: config.model, contextWindow: config.contextWindow ?? 131072, maxTokens: config.maxTokens ?? 16384, reasoning: false, input: ['text'],
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } }]
} } }));
const runtime = await ModelRuntime.create({ modelsPath: agentDir + '/models.json', authPath: agentDir + '/auth.json', allowModelNetwork: false });
const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 1 } });
const loader = new DefaultResourceLoader({ cwd: '/workspace/work', agentDir, settingsManager, noExtensions: true, noPromptTemplates: true, noThemes: true });
await loader.reload();
const pointer = '/workspace/state/session-path.txt';
const manager = existsSync(pointer) ? SessionManager.open(readFileSync(pointer, 'utf8')) : SessionManager.create('/workspace/work', '/workspace/state/sessions');
let toolRequests = 0;
const customTools = (config.tools ?? []).map(tool => ({
  name: tool.name, label: tool.name, description: tool.description, parameters: tool.parameters,
  promptSnippet: tool.description, executionMode: 'sequential',
  execute: async (_id, args, signal) => {
    if (signal?.aborted) throw Error('REPORT_CANCELLED');
    const id = 'project-tool-' + (++toolRequests);
    const response = new Promise(resolve => pendingTools.set(id, resolve));
    emit({ type: 'tool_request', id, name: tool.name, args });
    const reply = await response;
    if (reply.error) throw Error(reply.error);
    return { content: [{ type: 'text', text: JSON.stringify(reply.value ?? null) }], details: {} };
  },
}));
const { session } = await createAgentSession({ cwd: '/workspace/work', agentDir, modelRuntime: runtime, model: runtime.getModel('energyiq', config.model),
  thinkingLevel: 'off', sessionManager: manager, settingsManager, resourceLoader: loader, customTools, tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', ...customTools.map(tool => tool.name)] });
writeFileSync(pointer, session.sessionFile);
let count = 0;
let reviewing = false, visibleText = '', lastTextEvent = 0;
const flushText = () => { if (!reviewing && visibleText) { emit({ type: 'event', event: 'answer_progress', text: visibleText }); lastTextEvent = Date.now(); } };
session.subscribe(event => {
  if (!reviewing && event.type === 'message_start' && event.message?.role === 'assistant') visibleText = '';
  if (!reviewing && event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
    visibleText = (visibleText + event.assistantMessageEvent.delta).slice(0, 30000);
    if (Date.now() - lastTextEvent >= 250) flushText();
  }
  if (event.type === 'message_end') flushText();
  if (['agent_start', 'agent_end', 'tool_execution_start', 'tool_execution_end'].includes(event.type)) {
    emit({ type: 'event', event: event.type, tool: event.toolName, isError: event.isError });
    if (event.type === 'tool_execution_start' && ++count > 160) void session.abort();
  }
});
let collectionAttempted = false;
function collectArtifacts() {
  if (collectionAttempted) return;
  collectionAttempted = true;
  let bytes = 0, files = 0;
  const collect = (area, path = '') => {
    for (const entry of readdirSync(join('/workspace', area, path))) {
      const relative = path ? path + '/' + entry : entry;
      const absolute = join('/workspace', area, relative), stat = lstatSync(absolute);
      if (++files > 2000 || relative.split('/').length > 12 || stat.isSymbolicLink()) throw Error('OUTPUT_LIMIT');
      if (stat.isDirectory()) collect(area, relative);
      else {
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024 || (bytes += stat.size) > 48 * 1024 * 1024) throw Error('OUTPUT_LIMIT');
        emit({ type: 'file', area, path: relative, content: readFileSync(absolute).toString('base64') });
      }
    }
  };
  collect('outputs'); collect('state');
}
try {
  await session.prompt(config.prompt);
  const draftReply = [...session.state.messages].reverse().find(message => message.role === 'assistant');
  if (!draftReply || draftReply.stopReason !== 'stop') throw Error('REPORT_PI_FAILED');
  reviewing = true;
  await reviewReport({ browserCheck: checkReportBrowser, directory: '/workspace/outputs', method: config.reviewMethod, prompt: async text => {
    await session.prompt(text);
    const reply = [...session.state.messages].reverse().find(message => message.role === 'assistant');
    if (!reply || reply.stopReason !== 'stop') throw Error('REPORT_REVIEW_FAILED');
  }, event: type => emit({ type: 'event', event: type }) });
  const last = [...session.state.messages].reverse().find(message => message.role === 'assistant');
  if (!last || last.stopReason !== 'stop' || count > 160) throw Error('REPORT_PI_FAILED');
  const answer = last.content.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, 30000);
  collectArtifacts();
  emit({ type: 'result', answer, sessionId: session.sessionId });
} catch { try { collectArtifacts(); } catch {} emit({ type: 'failure' }); }
finally { session.dispose(); bridge.close(); }
// Keep tmpfs alive until the host has copied and validated the result.
