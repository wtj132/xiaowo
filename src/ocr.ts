import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HEIC = /\.(heic|heif)$/i;

function missing(err: unknown, tool: string, hint: string): never {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`找不到 ${tool}，请先安装：${hint}`);
  throw err;
}

async function toPng(path: string): Promise<string> {
  const out = join(tmpdir(), `ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  try {
    if (process.platform === 'darwin') await run('sips', ['-s', 'format', 'png', path, '--out', out]);
    else await run('heif-convert', [path, out]);
  } catch (e) {
    missing(e, process.platform === 'darwin' ? 'sips' : 'heif-convert', 'libheif-examples');
  }
  return out;
}

export async function ocrImage(path: string, langs: string): Promise<string> {
  await fs.access(path);
  const converted = HEIC.test(extname(path)) ? await toPng(path) : null;
  try {
    const { stdout } = await run('tesseract', [converted ?? path, 'stdout', '-l', langs], { timeout: 60_000 });
    return stdout.trim();
  } catch (e) {
    return missing(e, 'tesseract', 'brew install tesseract tesseract-lang / apt install tesseract-ocr tesseract-ocr-chi-sim');
  } finally {
    if (converted) await fs.rm(converted, { force: true });
  }
}
