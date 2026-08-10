export interface ChapterIndex {
  title: string;
  start: number;
  end: number;
}

export interface ReadingProgress {
  chapterIndex: number;
  scrollRatio: number;
}

export interface BookRecord {
  id: string;
  title: string;
  contentFileName: string;
  chapters: ChapterIndex[];
}

export interface ReaderSettings {
  fontSize: number;
  fontWeight: number;
  maxPageWidth: number;
  letterSpacing: number;
  lineHeight: number;
  paragraphSpacing: number;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  fontWeight: 400,
  maxPageWidth: 1000,
  letterSpacing: 0.4,
  lineHeight: 1.85,
  paragraphSpacing: 10,
};

export interface ReaderSettingDefinition {
  key: keyof ReaderSettings;
  label: string;
  minimum: number;
  maximum: number;
  step: number;
  unit: string;
}

export const READER_SETTING_DEFINITIONS: readonly ReaderSettingDefinition[] = [
  { key: 'fontSize', label: '字号', minimum: 12, maximum: 32, step: 1, unit: 'px' },
  { key: 'fontWeight', label: '字重', minimum: 250, maximum: 900, step: 10, unit: '' },
  { key: 'maxPageWidth', label: '最大页宽', minimum: 480, maximum: 1600, step: 20, unit: 'px' },
  { key: 'letterSpacing', label: '字间距', minimum: 0, maximum: 3, step: 0.1, unit: 'px' },
  { key: 'lineHeight', label: '行间距', minimum: 1.2, maximum: 2.6, step: 0.05, unit: '' },
  { key: 'paragraphSpacing', label: '段间距', minimum: 0, maximum: 24, step: 1, unit: 'px' },
];

export function sanitizeReaderSettings(settings: Partial<ReaderSettings>): ReaderSettings {
  const sanitized = { ...DEFAULT_SETTINGS };
  for (const definition of READER_SETTING_DEFINITIONS) {
    const value = settings[definition.key];
    const finiteValue = typeof value === 'number' && Number.isFinite(value)
      ? value
      : DEFAULT_SETTINGS[definition.key];
    sanitized[definition.key] = Math.min(
      definition.maximum,
      Math.max(definition.minimum, finiteValue),
    );
  }
  return sanitized;
}
