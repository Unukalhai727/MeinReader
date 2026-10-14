(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const titlePattern = new RegExp(document.body.dataset.chapterPattern || 'a^');
  let books = [];
  let settings = null;
  let settingDefinitions = [];
  let currentBook = null;
  let armedDeleteId = null;
  let activeSidebar = null;
  let progressTimer = null;
  let settingsTimer = null;
  let isLoading = false;
  let renderVersion = 0;

  async function loadSourceHanSans() {
    if (typeof FontFace !== 'function' || !document.fonts) {
      vscode.postMessage({ type: 'sourceHanSansUnavailable' });
      return;
    }

    const sourceHanSans = new FontFace(
      'MeinReader Source Han Sans SC',
      'local("Source Han Sans SC VF")',
      { style: 'normal', weight: '250 900' },
    );

    try {
      const loadedFont = await sourceHanSans.load();
      document.fonts.add(loadedFont);
      document.documentElement.classList.add('source-han-available');
    } catch {
      vscode.postMessage({ type: 'sourceHanSansUnavailable' });
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'library':
        books = Array.isArray(message.books) ? message.books : [];
        settings = message.settings || settings;
        settingDefinitions = Array.isArray(message.settingDefinitions)
          ? message.settingDefinitions
          : settingDefinitions;
        isLoading = false;
        if (!currentBook) {
          renderLibrary();
        }
        break;
      case 'book':
        currentBook = message.book;
        settings = message.settings || settings;
        settingDefinitions = Array.isArray(message.settingDefinitions)
          ? message.settingDefinitions
          : settingDefinitions;
        activeSidebar = null;
        isLoading = false;
        renderReader(message.book.scrollRatio || 0);
        break;
      case 'chapter':
        if (!currentBook) {
          break;
        }
        currentBook.currentChapter = message.currentChapter;
        currentBook.content = message.content;
        activeSidebar = null;
        isLoading = false;
        updateRenderedChapter(message.scrollRatio || 0);
        break;
      case 'settings':
        settings = message.settings || settings;
        applyReaderSettings();
        syncSettingsControls();
        break;
      case 'requestProgress':
        saveProgressImmediately();
        break;
      case 'operationFailed':
        isLoading = false;
        app.classList.remove('loading');
        if (!currentBook) {
          renderLibrary();
        }
        break;
    }
  });

  document.addEventListener('click', (event) => {
    if (armedDeleteId && !event.target.closest('.delete-button')) {
      resetDeleteButtons();
    }
  });

  window.addEventListener('pagehide', saveProgressImmediately);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveProgressImmediately();
    }
  });

  function renderLibrary() {
    currentBook = null;
    activeSidebar = null;
    armedDeleteId = null;
    app.replaceChildren();

    const view = element('main', 'home-view');
    const header = element('header', 'home-header');
    const brand = element('div', 'brand');
    brand.append(icon('book'), textElement('span', '梅茵阅读器'));

    const importButton = textElement('button', '导入书籍', 'import-button');
    importButton.type = 'button';
    importButton.addEventListener('click', () => {
      importButton.disabled = true;
      vscode.postMessage({ type: 'importBook' });
    });
    header.append(brand, importButton);

    const list = element('div', 'book-list');
    books.forEach((book) => {
      const row = element('div', 'book-row');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `打开《${book.title}》`);
      row.addEventListener('click', () => openBook(book.id));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openBook(book.id);
        }
      });

      const title = textElement('span', book.title, 'book-title');
      title.title = book.title;
      const remove = iconButton('close', '删除书籍');
      remove.classList.add('delete-button');
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        if (armedDeleteId !== book.id) {
          resetDeleteButtons();
          armedDeleteId = book.id;
          remove.classList.add('armed');
          remove.setAttribute('aria-label', '再次点击确认删除');
          remove.title = '再次点击确认删除';
          return;
        }
        armedDeleteId = null;
        remove.disabled = true;
        vscode.postMessage({ type: 'deleteBook', id: book.id });
      });
      row.append(title, remove);
      list.append(row);
    });

    view.append(header, list);
    app.append(view);
  }

  function openBook(id) {
    if (isLoading) {
      return;
    }
    isLoading = true;
    app.classList.add('loading');
    vscode.postMessage({ type: 'openBook', id });
  }

  function renderReader(scrollRatio) {
    if (!currentBook) {
      return;
    }
    app.replaceChildren();
    app.classList.remove('loading');
    renderVersion += 1;
    const view = element('main', 'reader-view');
    view.append(createToolbar(), createReadingArea(), createTocSidebar(), createSettingsSidebar());
    app.append(view);
    applyReaderSettings();
    updateSidebarState();
    restoreScroll(scrollRatio, renderVersion);
  }

  function createToolbar() {
    const toolbar = element('header', 'toolbar');
    const left = element('div', 'toolbar-group');
    const home = iconButton('home', '返回主页');
    home.addEventListener('click', () => {
      saveProgressImmediately();
      renderLibrary();
    });
    const categories = iconButton('categories', '展开目录');
    categories.addEventListener('click', () => toggleSidebar('toc'));
    const title = textElement(
      'div',
      currentBook.chapters[currentBook.currentChapter].title,
      'toolbar-title',
    );
    title.id = 'toolbar-chapter-title';
    title.title = currentBook.chapters[currentBook.currentChapter].title;
    left.append(home, categories, title);

    const right = element('div', 'toolbar-group');
    const previous = iconButton('previous', '上一章');
    previous.id = 'previous-chapter';
    previous.disabled = currentBook.currentChapter <= 0;
    previous.addEventListener('click', () => changeChapter(currentBook.currentChapter - 1));
    const next = iconButton('next', '下一章');
    next.id = 'next-chapter';
    next.disabled = currentBook.currentChapter >= currentBook.chapters.length - 1;
    next.addEventListener('click', () => changeChapter(currentBook.currentChapter + 1));
    const settingButton = iconButton('settings', '展开设置');
    settingButton.addEventListener('click', () => toggleSidebar('settings'));
    right.append(previous, next, settingButton);
    toolbar.append(left, right);
    return toolbar;
  }

  function createReadingArea() {
    const scroller = element('div', 'reading-scroller');
    scroller.id = 'reading-scroller';
    const article = element('article', 'reading-content');
    renderReadingContent(article);
    scroller.append(article);
    scroller.addEventListener('scroll', scheduleProgressSave, { passive: true });
    scroller.addEventListener('click', () => {
      if (activeSidebar) {
        activeSidebar = null;
        updateSidebarState();
      }
    });
    scroller.addEventListener('dblclick', navigateByGutterDoubleClick);
    scroller.addEventListener('mousedown', preventNavigationGestureDefault);
    scroller.addEventListener('auxclick', navigateBySideButton);
    return scroller;
  }

  function navigateByGutterDoubleClick(event) {
    if (!currentBook) {
      return;
    }

    const direction = getGutterDirection(event.clientX);
    if (direction !== 0) {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      changeChapter(currentBook.currentChapter + direction);
    }
  }

  function preventNavigationGestureDefault(event) {
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
      return;
    }

    // Text selection starts on the second mousedown, before dblclick fires.
    if (event.button === 0 && event.detail >= 2 && getGutterDirection(event.clientX) !== 0) {
      event.preventDefault();
    }
  }

  function getGutterDirection(clientX) {
    const article = document.querySelector('.reading-content');
    if (!article) {
      return 0;
    }

    const bounds = article.getBoundingClientRect();
    const style = getComputedStyle(article);
    const contentLeft = bounds.left + Number.parseFloat(style.paddingLeft || '0');
    const contentRight = bounds.right - Number.parseFloat(style.paddingRight || '0');
    if (clientX < contentLeft) {
      return -1;
    }
    if (clientX > contentRight) {
      return 1;
    }
    return 0;
  }

  function navigateBySideButton(event) {
    if (!currentBook || (event.button !== 3 && event.button !== 4)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const offset = event.button === 3 ? -1 : 1;
    changeChapter(currentBook.currentChapter + offset);
  }

  function renderReadingContent(article) {
    article.replaceChildren();
    article.setAttribute('aria-label', currentBook.chapters[currentBook.currentChapter].title);
    const lines = currentBook.content.split('\n');
    // Chapter ranges normally end immediately before the next heading, which
    // leaves a trailing LF in the previous chapter. Do not turn trailing line
    // breaks or whitespace-only lines into visible empty paragraphs.
    while (lines.length > 1 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    lines.forEach((line) => {
      const paragraph = textElement('p', line);
      if (titlePattern.test(line)) {
        paragraph.classList.add('chapter-title-line');
      }
      article.append(paragraph);
    });
  }

  function updateRenderedChapter(scrollRatio) {
    const article = document.querySelector('.reading-content');
    const title = document.getElementById('toolbar-chapter-title');
    const previous = document.getElementById('previous-chapter');
    const next = document.getElementById('next-chapter');
    if (!article || !title || !previous || !next) {
      renderReader(scrollRatio);
      return;
    }

    renderVersion += 1;
    app.classList.remove('loading');
    const chapter = currentBook.chapters[currentBook.currentChapter];
    title.textContent = chapter.title;
    title.title = chapter.title;
    previous.disabled = currentBook.currentChapter <= 0;
    next.disabled = currentBook.currentChapter >= currentBook.chapters.length - 1;
    renderReadingContent(article);

    document.querySelectorAll('.toc-item').forEach((item) => {
      const isCurrent = Number(item.dataset.chapterIndex) === currentBook.currentChapter;
      item.classList.toggle('current', isCurrent);
      if (isCurrent) {
        item.setAttribute('aria-current', 'true');
      } else {
        item.removeAttribute('aria-current');
      }
    });

    updateSidebarState();
    applyReaderSettings();
    restoreScroll(scrollRatio, renderVersion);
  }

  function createTocSidebar() {
    const sidebar = element('aside', 'sidebar sidebar-left');
    sidebar.id = 'toc-sidebar';
    const body = element('div', 'sidebar-body');
    const list = element('nav', 'toc-list');
    list.setAttribute('aria-label', '章节目录');
    currentBook.chapters.forEach((chapter, index) => {
      const item = textElement('button', chapter.title, 'toc-item');
      item.type = 'button';
      item.title = chapter.title;
      item.dataset.chapterIndex = String(index);
      if (index === currentBook.currentChapter) {
        item.classList.add('current');
        item.setAttribute('aria-current', 'true');
      }
      item.addEventListener('click', () => changeChapter(index));
      list.append(item);
    });
    body.append(list);
    sidebar.append(body);
    return sidebar;
  }

  function createSettingsSidebar() {
    const sidebar = element('aside', 'sidebar sidebar-right');
    sidebar.id = 'settings-sidebar';
    const body = element('div', 'sidebar-body');
    const form = element('div', 'settings-form');
    form.append(...settingDefinitions.map((definition) => settingSlider(
      definition.label,
      definition.key,
      definition.minimum,
      definition.maximum,
      definition.step,
      definition.unit,
    )));
    const reset = textElement('button', '恢复初始设置', 'reset-button');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      clearTimeout(settingsTimer);
      settingsTimer = null;
      vscode.postMessage({ type: 'resetSettings' });
    });
    form.append(reset);
    body.append(form);
    sidebar.append(body);
    return sidebar;
  }

  function settingSlider(labelText, key, minimum, maximum, step, unit) {
    const row = element('div', 'setting-row');
    const label = textElement('label', labelText);
    label.htmlFor = `setting-${key}`;
    const range = document.createElement('input');
    range.type = 'range';
    range.id = `setting-${key}`;
    range.min = String(minimum);
    range.max = String(maximum);
    range.step = String(step);
    range.value = String(settings[key]);
    range.dataset.setting = key;
    range.dataset.unit = unit;
    const value = textElement('output', formatSetting(settings[key], unit), 'setting-value');
    value.htmlFor = range.id;
    value.dataset.output = key;
    range.addEventListener('input', () => {
      settings[key] = Number(range.value);
      value.textContent = formatSetting(settings[key], unit);
      applyReaderSettings();
      scheduleSettingsSave();
    });
    row.append(label, range, value);
    return row;
  }

  function changeChapter(index) {
    if (!currentBook || isLoading || index < 0 || index >= currentBook.chapters.length || index === currentBook.currentChapter) {
      activeSidebar = null;
      updateSidebarState();
      return;
    }
    isLoading = true;
    app.classList.add('loading');
    vscode.postMessage({
      type: 'openChapter',
      id: currentBook.id,
      chapterIndex: index,
      progress: readProgress(),
    });
  }

  function toggleSidebar(sidebar) {
    activeSidebar = activeSidebar === sidebar ? null : sidebar;
    updateSidebarState();
    if (activeSidebar === 'toc') {
      requestAnimationFrame(() => {
        document.querySelector('.toc-item.current')?.scrollIntoView({ block: 'center' });
      });
    }
  }

  function updateSidebarState() {
    document.getElementById('toc-sidebar')?.classList.toggle('open', activeSidebar === 'toc');
    document.getElementById('settings-sidebar')?.classList.toggle('open', activeSidebar === 'settings');
  }

  function applyReaderSettings() {
    const article = document.querySelector('.reading-content');
    if (!article || !settings) {
      return;
    }
    article.style.setProperty('--reader-font-size', `${settings.fontSize}px`);
    article.style.setProperty('--reader-font-weight', String(settings.fontWeight));
    article.style.setProperty('--reader-max-page-width', `${settings.maxPageWidth}px`);
    article.style.setProperty('--reader-letter-spacing', `${settings.letterSpacing}px`);
    article.style.setProperty('--reader-line-height', String(settings.lineHeight));
    article.style.setProperty('--reader-paragraph-spacing', `${settings.paragraphSpacing}px`);
  }

  function syncSettingsControls() {
    document.querySelectorAll('[data-setting]').forEach((control) => {
      const key = control.dataset.setting;
      control.value = String(settings[key]);
      const output = document.querySelector(`[data-output="${key}"]`);
      if (output) {
        output.textContent = formatSetting(settings[key], control.dataset.unit || '');
      }
    });
  }

  function scheduleSettingsSave() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      vscode.postMessage({ type: 'updateSettings', settings: { ...settings } });
    }, 180);
  }

  function scheduleProgressSave() {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(saveProgressImmediately, 1000);
  }

  function saveProgressImmediately() {
    clearTimeout(progressTimer);
    if (!currentBook) {
      return;
    }
    vscode.postMessage({ type: 'saveProgress', id: currentBook.id, progress: readProgress() });
  }

  function readProgress() {
    const scroller = document.getElementById('reading-scroller');
    const maximum = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
    return {
      chapterIndex: currentBook.currentChapter,
      scrollRatio: maximum > 0 ? scroller.scrollTop / maximum : 0,
    };
  }

  async function restoreScroll(ratio, version) {
    try {
      await document.fonts?.ready;
    } catch {
      // Continue with the available fallback font.
    }
    if (version !== renderVersion) {
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (version !== renderVersion) {
        return;
      }
      const scroller = document.getElementById('reading-scroller');
      if (!scroller) {
        return;
      }
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = maximum * Math.min(1, Math.max(0, Number(ratio) || 0));
    }));
  }

  function iconButton(name, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(icon(name));
    return button;
  }

  function icon(name) {
    const node = element('span', `icon icon-${name}`);
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function textElement(tag, text, className) {
    const node = element(tag, className);
    node.textContent = text;
    return node;
  }

  function element(tag, className) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    return node;
  }

  function formatSetting(value, unit) {
    const numericValue = Number(value);
    const formatted = Number.isInteger(numericValue)
      ? String(numericValue)
      : numericValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${formatted}${unit}`;
  }

  function resetDeleteButtons() {
    armedDeleteId = null;
    document.querySelectorAll('.delete-button.armed').forEach((button) => {
      button.classList.remove('armed');
      button.setAttribute('aria-label', '删除书籍');
      button.title = '删除书籍';
    });
  }

  async function initialize() {
    await loadSourceHanSans();
    vscode.postMessage({ type: 'ready' });
  }

  void initialize();
})();
