import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { z } from 'zod';

export const DATA_DIR = join(process.cwd(), 'data');

export async function readData<T extends z.ZodType>(file: string, schema: T): Promise<z.infer<T> | null> {
  try {
    const text = await readFile(join(DATA_DIR, file), 'utf8');
    return schema.parse(JSON.parse(text));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Validates before writing so broken data never gets committed,
 * and only touches the file when the content actually changed.
 * Returns true when the file was written.
 */
export async function writeData<T extends z.ZodType>(file: string, schema: T, value: z.infer<T>): Promise<boolean> {
  const validated = schema.parse(value);
  const text = `${JSON.stringify(validated, null, 2)}\n`;
  const path = join(DATA_DIR, file);
  try {
    if ((await readFile(path, 'utf8')) === text) return false;
  } catch {
    // file doesn't exist yet
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return true;
}

export async function listSeasonDirs(): Promise<number[]> {
  try {
    const entries = await readdir(DATA_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
      .map((e) => Number(e.name))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}
