import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { CHAPTER_PATTERN } from './chapterParser';

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const resourceVersion = randomBytes(8).toString('hex');
  const publicUri = vscode.Uri.joinPath(extensionUri, 'public');
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(publicUri, 'main.js').with({ query: `v=${resourceVersion}` }),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(publicUri, 'main.css').with({ query: `v=${resourceVersion}` }),
  );
  const iconUris = {
    home: webview.asWebviewUri(vscode.Uri.joinPath(publicUri, 'Home.svg')),
    categories: webview.asWebviewUri(vscode.Uri.joinPath(publicUri, 'ExpandCategories.svg')),
    previous: webview.asWebviewUri(vscode.Uri.joinPath(publicUri, 'ArrowLeft.svg')),
    next: webview.asWebviewUri(vscode.Uri.joinPath(publicUri, 'ArrowRight.svg')),
    settings: webview.asWebviewUri(vscode.Uri.joinPath(publicUri, 'Settings.svg')),
    close: webview.asWebviewUri(vscode.Uri.joinPath(publicUri, 'Close.svg')),
    book: webview.asWebviewUri(vscode.Uri.joinPath(publicUri, 'Book.svg')),
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <style>
    .icon-home { --icon-uri: url('${iconUris.home}'); }
    .icon-categories { --icon-uri: url('${iconUris.categories}'); }
    .icon-previous { --icon-uri: url('${iconUris.previous}'); }
    .icon-next { --icon-uri: url('${iconUris.next}'); }
    .icon-settings { --icon-uri: url('${iconUris.settings}'); }
    .icon-close { --icon-uri: url('${iconUris.close}'); }
    .icon-book { --icon-uri: url('${iconUris.book}'); }
  </style>
  <title>梅茵阅读器</title>
</head>
<body data-chapter-pattern="${escapeAttribute(CHAPTER_PATTERN.source)}">
  <div id="app" aria-live="polite"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
