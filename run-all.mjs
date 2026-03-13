import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LOG_DIR = path.join(ROOT, 'data', 'wrapper-logs');

fs.mkdirSync(LOG_DIR, { recursive: true });

const SERVICES = [
  { name: 'epic-games', command: 'node', args: ['epic-games.js'], enabled: true },
  { name: 'prime-gaming', command: 'node', args: ['prime-gaming.js'], enabled: false },
  { name: 'gog', command: 'node', args: ['gog.js'], enabled: false },
].filter(service => service.enabled);

function nowIso() {
  return new Date().toISOString();
}

function logFilePath(serviceName) {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${serviceName}-${date}.log`);
}

function appendLog(serviceName, text) {
  fs.appendFileSync(logFilePath(serviceName), text);
}

function runService(service) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const startStamp = nowIso();

    console.log(`\n[${startStamp}] Starting ${service.name}...`);
    appendLog(service.name, `\n\n=== ${startStamp} START ${service.name} ===\n`);

    const child = spawn(service.command, service.args, {
      cwd: ROOT,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
      },
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(`[${service.name}] ${text}`);
      appendLog(service.name, text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(`[${service.name}:err] ${text}`);
      appendLog(service.name, text);
    });

    child.on('error', (error) => {
      const finishedAt = nowIso();
      const durationMs = Date.now() - startedAt;
      const summary = {
        service: service.name,
        ok: false,
        code: null,
        signal: null,
        startedAt: startStamp,
        finishedAt,
        durationMs,
        stdout,
        stderr: `${stderr}\n${error.stack || error.message}`,
      };

      appendLog(
        service.name,
        `\n=== ${finishedAt} ERROR ${service.name} (${durationMs}ms) ===\n${error.stack || error.message}\n`
      );

      resolve(summary);
    });

    child.on('close', (code, signal) => {
      const finishedAt = nowIso();
      const durationMs = Date.now() - startedAt;
      const ok = code === 0;

      appendLog(
        service.name,
        `\n=== ${finishedAt} END ${service.name} code=${code} signal=${signal ?? 'null'} (${durationMs}ms) ===\n`
      );

      resolve({
        service: service.name,
        ok,
        code,
        signal,
        startedAt: startStamp,
        finishedAt,
        durationMs,
        stdout,
        stderr,
      });
    });
  });
}

function buildSummary(results) {
  const lines = [];
  lines.push(`\n[${nowIso()}] Wrapper summary`);
  for (const result of results) {
    lines.push(
      `- ${result.service}: ${result.ok ? 'OK' : 'FAILED'} (code=${result.code ?? 'null'}, ${result.durationMs}ms)`
    );
  }
  return lines.join('\n');
}

async function main() {
  const wrapperStartedAt = Date.now();
  const results = [];

  for (const service of SERVICES) {
    const result = await runService(service);
    results.push(result);
  }

  const summary = buildSummary(results);
  console.log(summary);

  const summaryPath = path.join(LOG_DIR, 'last-run-summary.json');
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        generatedAt: nowIso(),
        durationMs: Date.now() - wrapperStartedAt,
        results,
      },
      null,
      2
    )
  );

  const failed = results.filter((r) => !r.ok);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error('[wrapper] Fatal error:', error);
  process.exit(1);
});