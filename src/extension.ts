import * as vscode from 'vscode';
import { ReaderViewProvider } from './ReaderViewProvider';
import { ReaderStorage } from './storage';

export function activate(context: vscode.ExtensionContext): void {
  const storage = new ReaderStorage(context);
  const provider = new ReaderViewProvider(context, storage);

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(
    ReaderViewProvider.viewType,
    provider,
    { webviewOptions: { retainContextWhenHidden: true } },
  ));
}
