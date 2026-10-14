import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { ReaderStorage } from './storage';
import {
  READER_SETTING_DEFINITIONS,
  type ReaderSettings,
  type ReadingProgress,
} from './types';
import { getWebviewHtml } from './webviewHtml';

interface WebviewMessage {
  type?: string;
  id?: string;
  chapterIndex?: number;
  progress?: ReadingProgress;
  settings?: Partial<ReaderSettings>;
}

export class ReaderViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'meinReader.reader';
  private static readonly sourceHanSansDownloadUrl = vscode.Uri.parse(
    'https://github.com/adobe-fonts/source-han-sans/raw/release/Variable/OTF/SourceHanSansSC-VF.otf',
  );
  private view?: vscode.WebviewView;
  private hasWarnedMissingSourceHanSans = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly storage: ReaderStorage,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'public')],
    };
    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.context.extensionUri);

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    }, undefined, this.context.subscriptions);

    webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      undefined,
      this.context.subscriptions,
    );

    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        void webviewView.webview.postMessage({ type: 'requestProgress' });
      }
    }, undefined, this.context.subscriptions);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          await this.sendLibrary();
          break;
        case 'sourceHanSansUnavailable':
          await this.warnMissingSourceHanSans();
          break;
        case 'importBook':
          await this.importBook();
          break;
        case 'deleteBook':
          if (typeof message.id === 'string') {
            try {
              await this.storage.deleteBook(message.id);
            } finally {
              await this.sendLibrary();
            }
          }
          break;
        case 'openBook':
          if (typeof message.id === 'string') {
            const payload = await this.storage.getReadingPayload(message.id, undefined, true);
            await this.postMessage({
              type: 'book',
              book: payload,
              settings: this.storage.getSettings(),
              settingDefinitions: READER_SETTING_DEFINITIONS,
            });
          }
          break;
        case 'openChapter':
          await this.openChapter(message);
          break;
        case 'saveProgress':
          await this.saveProgress(message);
          break;
        case 'updateSettings':
          if (message.settings) {
            const settings = await this.storage.updateSettings(message.settings);
            await this.postMessage({ type: 'settings', settings });
          }
          break;
        case 'resetSettings': {
          const settings = await this.storage.resetSettings();
          await this.postMessage({ type: 'settings', settings });
          break;
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(`梅茵阅读器：${detail}`);
      await this.postMessage({ type: 'operationFailed' });
    }
  }

  private async importBook(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.file(homedir()),
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { '文本文件': ['txt'] },
      openLabel: '导入书籍',
      title: '导入本地 TXT 书籍',
    });

    const source = selected?.[0];
    if (!source) {
      await this.postMessage({ type: 'operationFailed' });
      return;
    }

    await this.storage.importBook(source);
    await this.sendLibrary();
  }

  private async warnMissingSourceHanSans(): Promise<void> {
    if (this.hasWarnedMissingSourceHanSans) {
      return;
    }
    this.hasWarnedMissingSourceHanSans = true;

    const downloadAction = '下载思源黑体';
    const selected = await vscode.window.showInformationMessage(
      '未检测到思源黑体 VF，已回退至系统中文字体。',
      downloadAction,
    );
    if (selected === downloadAction) {
      await vscode.env.openExternal(ReaderViewProvider.sourceHanSansDownloadUrl);
      await vscode.window.showInformationMessage(
        '安装思源黑体后，请关闭所有 VS Code 窗口并重新打开，以刷新字体缓存。',
      );
    }
  }

  private async openChapter(message: WebviewMessage): Promise<void> {
    if (typeof message.id !== 'string' || !Number.isInteger(message.chapterIndex)) {
      return;
    }
    if (message.progress) {
      await this.storage.updateProgress(message.id, message.progress);
    }
    const payload = await this.storage.getReadingPayload(message.id, message.chapterIndex, false);
    await this.postMessage({
      type: 'chapter',
      currentChapter: payload.currentChapter,
      content: payload.content,
      scrollRatio: payload.scrollRatio,
    });
  }

  private async saveProgress(message: WebviewMessage): Promise<void> {
    if (typeof message.id === 'string' && message.progress) {
      await this.storage.updateProgress(message.id, message.progress);
    }
  }

  private async sendLibrary(): Promise<void> {
    const books = this.storage.getBooks().map((book) => ({ id: book.id, title: book.title }));
    await this.postMessage({
      type: 'library',
      books,
      settings: this.storage.getSettings(),
      settingDefinitions: READER_SETTING_DEFINITIONS,
    });
  }

  private async postMessage(message: unknown): Promise<void> {
    await this.view?.webview.postMessage(message);
  }
}
