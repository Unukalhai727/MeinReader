import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildChapterIndex } from './chapterParser';
import { decodeAndNormalize } from './textDecoder';
import {
  sanitizeReaderSettings,
  type BookRecord,
  type ReaderSettings,
  type ReadingProgress,
} from './types';

const LIBRARY_KEY = 'meinReader.library.v1';
const PROGRESS_KEY = 'meinReader.progress.v1';
const SETTINGS_KEY = 'meinReader.settings.v1';

export interface ReadingPayload {
  id: string;
  title: string;
  chapters: Array<{ title: string }>;
  currentChapter: number;
  content: string;
  scrollRatio: number;
}

export class ReaderStorage {
  private operationQueue: Promise<unknown> = Promise.resolve();
  private settingsQueue: Promise<unknown> = Promise.resolve();
  private contentCache?: { id: string; contentFileName: string; text: string };

  constructor(private readonly context: vscode.ExtensionContext) {}

  getBooks(): BookRecord[] {
    const records = this.context.globalState.get<BookRecord[]>(LIBRARY_KEY, []);
    return records
      .filter(isBookRecord)
      .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN', {
        numeric: false,
        sensitivity: 'base',
      }));
  }

  getSettings(): ReaderSettings {
    return sanitizeReaderSettings(this.context.globalState.get<Partial<ReaderSettings>>(SETTINGS_KEY, {}));
  }

  async importBook(uri: vscode.Uri): Promise<BookRecord> {
    return this.enqueue(async () => {
      const sourceFileName = path.basename(uri.fsPath);
      if (path.extname(sourceFileName).toLocaleLowerCase() !== '.txt') {
        throw new Error('只能导入 TXT 文件。');
      }

      const title = path.basename(sourceFileName, path.extname(sourceFileName)).normalize('NFC').trim();
      if (!title) {
        throw new Error('文件名不能作为有效书名。');
      }

      const id = createBookId(title);
      const records = this.getBooks();
      const existing = records.find((book) => book.id === id);
      if (existing) {
        throw new Error(`已存在同名书籍《${title}》，导入已取消。`);
      }

      const bytes = await vscode.workspace.fs.readFile(uri);
      const decoded = decodeAndNormalize(bytes);
      const chapters = buildChapterIndex(decoded);
      const bookDirectory = path.join(this.context.globalStorageUri.fsPath, 'books', id);
      const contentFileName = `content-${Date.now()}-${randomBytes(4).toString('hex')}.txt`;
      const contentPath = path.join(bookDirectory, contentFileName);

      await fs.mkdir(bookDirectory, { recursive: true });
      await atomicCreate(contentPath, decoded);

      const book: BookRecord = {
        id,
        title,
        contentFileName,
        chapters,
      };

      const nextRecords = records.filter((item) => item.id !== id);
      nextRecords.push(book);

      try {
        await this.context.globalState.update(LIBRARY_KEY, nextRecords);
      } catch (error) {
        await fs.rm(contentPath, { force: true });
        throw error;
      }

      // Orphan cleanup is best-effort: the manifest already points atomically
      // at the new unique content file, so a cleanup failure must not make a
      // successful import appear to have failed.
      await removeOldContentFiles(bookDirectory, contentFileName).catch(() => undefined);
      if (this.contentCache?.id === id) {
        this.contentCache = { id, contentFileName, text: decoded };
      }
      return book;
    });
  }

  async deleteBook(id: string): Promise<void> {
    return this.enqueue(async () => {
      const records = this.getBooks();
      const target = records.find((book) => book.id === id);
      if (!target) {
        return;
      }

      const bookDirectory = path.join(this.context.globalStorageUri.fsPath, 'books', target.id);
      await this.context.globalState.update(
        LIBRARY_KEY,
        records.filter((book) => book.id !== id),
      );

      let cleanupError: unknown;
      const progress = this.getProgressMap();
      delete progress[id];
      try {
        await this.context.globalState.update(PROGRESS_KEY, progress);
      } catch (error) {
        cleanupError = error;
      }
      try {
        await fs.rm(bookDirectory, { recursive: true, force: true });
      } catch (error) {
        cleanupError ??= error;
      }
      if (this.contentCache?.id === id) {
        this.contentCache = undefined;
      }
      if (cleanupError) {
        throw cleanupError;
      }
    });
  }

  async getReadingPayload(id: string, chapterIndex?: number, useSavedProgress = false): Promise<ReadingPayload> {
    await this.operationQueue;
    const book = this.getBooks().find((item) => item.id === id);
    if (!book) {
      throw new Error('这本书已不存在，请返回书库刷新。');
    }

    const progress = this.getProgress(book.id, book.chapters.length);
    const requestedIndex = chapterIndex ?? progress.chapterIndex;
    const safeIndex = clampInteger(requestedIndex, 0, book.chapters.length - 1);
    const chapter = book.chapters[safeIndex];
    const fullText = await this.loadBookContent(book);

    return {
      id: book.id,
      title: book.title,
      chapters: book.chapters.map((item) => ({ title: item.title })),
      currentChapter: safeIndex,
      content: fullText.slice(chapter.start, chapter.end),
      scrollRatio: useSavedProgress && safeIndex === progress.chapterIndex
        ? progress.scrollRatio
        : 0,
    };
  }

  async updateProgress(id: string, progress: ReadingProgress): Promise<void> {
    return this.enqueue(async () => {
      const target = this.getBooks().find((book) => book.id === id);
      if (!target) {
        return;
      }

      const progressMap = this.getProgressMap();
      progressMap[id] = sanitizeProgress(progress, target.chapters.length);
      await this.context.globalState.update(PROGRESS_KEY, progressMap);
    });
  }

  async updateSettings(settings: Partial<ReaderSettings>): Promise<ReaderSettings> {
    return this.enqueueSettings(async () => {
      const sanitized = sanitizeReaderSettings({ ...this.getSettings(), ...settings });
      await this.context.globalState.update(SETTINGS_KEY, sanitized);
      return sanitized;
    });
  }

  async resetSettings(): Promise<ReaderSettings> {
    return this.enqueueSettings(async () => {
      const settings = sanitizeReaderSettings({});
      await this.context.globalState.update(SETTINGS_KEY, settings);
      return settings;
    });
  }

  private getProgressMap(): Record<string, ReadingProgress> {
    const stored = this.context.globalState.get<Record<string, ReadingProgress>>(PROGRESS_KEY, {});
    return stored && typeof stored === 'object' ? { ...stored } : {};
  }

  private getProgress(id: string, chapterCount: number): ReadingProgress {
    return sanitizeProgress(this.getProgressMap()[id], chapterCount);
  }

  private async loadBookContent(book: BookRecord): Promise<string> {
    if (this.contentCache?.id === book.id
      && this.contentCache.contentFileName === book.contentFileName) {
      return this.contentCache.text;
    }

    const contentPath = resolveContentPath(this.context.globalStorageUri.fsPath, book);
    const text = await fs.readFile(contentPath, 'utf8');
    this.contentCache = { id: book.id, contentFileName: book.contentFileName, text };
    return text;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private enqueueSettings<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.settingsQueue.then(operation, operation);
    this.settingsQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

async function atomicCreate(finalPath: string, content: string): Promise<void> {
  const temporaryPath = `${finalPath}.${randomBytes(4).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporaryPath, finalPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function removeOldContentFiles(directory: string, retainedFileName: string): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('content-') && entry.name !== retainedFileName)
    .map((entry) => fs.rm(path.join(directory, entry.name), { force: true })));
}

function resolveContentPath(storageRoot: string, book: BookRecord): string {
  if (path.basename(book.contentFileName) !== book.contentFileName) {
    throw new Error('书籍存储记录无效。');
  }
  return path.join(storageRoot, 'books', book.id, book.contentFileName);
}

function createBookId(title: string): string {
  const normalized = title.normalize('NFC').toLocaleLowerCase('zh-CN');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

function sanitizeProgress(progress: ReadingProgress | undefined, chapterCount: number): ReadingProgress {
  return {
    chapterIndex: clampInteger(progress?.chapterIndex ?? 0, 0, chapterCount - 1),
    scrollRatio: clampNumber(progress?.scrollRatio ?? 0, 0, 1),
  };
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  const finiteValue = Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, finiteValue));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.round(clampNumber(value, minimum, maximum));
}

function isBookRecord(value: unknown): value is BookRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<BookRecord>;
  return typeof record.id === 'string'
    && /^[a-f0-9]{24}$/.test(record.id)
    && typeof record.title === 'string'
    && typeof record.contentFileName === 'string'
    && Array.isArray(record.chapters)
    && record.chapters.length > 0;
}
