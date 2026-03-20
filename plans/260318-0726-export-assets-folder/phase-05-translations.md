---
title: "Phase 05: Translations - Internationalization"
description: "Add i18n translations for export feature"
priority: P2
status: pending
---

# Phase 05: Translations - Internationalization

## Context
- **File**: `src/i18n/locales/en.json`
- **Existing pattern**: Assets folders section at lines 600-627

## Requirements

### 1. Add English translations
**File**: `src/i18n/locales/en.json`

Add to `"assets"` → `"folders"` section:

```json
{
  "assets": {
    "folders": {
      // ... existing keys
      "exportFolder": "Export",
      "exportFolderDesc": "Export this folder to a directory",
      "exportingFolder": "Exporting Folder...",
      "exporting": "Exporting...",
      "exportComplete": "Export complete",
      "exportCompleteDesc": "{{count}} file(s) exported to {{path}}",
      "exportFailed": "Export failed",
      "selectExportDestination": "Select export destination",
      "exportProgress": "Exporting {{current}} of {{total}}..."
    }
  }
}
```

### 2. Add translations for other supported languages
**Files**:
- `src/i18n/locales/zh-CN.json`
- `src/i18n/locales/zh-TW.json`
- `src/i18n/locales/ja.json`
- `src/i18n/locales/ko.json`
- `src/i18n/locales/es.json`
- `src/i18n/locales/fr.json`
- `src/i18n/locales/de.json`
- `src/i18n/locales/ru.json`
- `src/i18n/locales/it.json`
- `src/i18n/locales/pt.json`
- `src/i18n/locales/tr.json`
- `src/i18n/locales/hi.json`
- `src/i18n/locales/id.json`
- `src/i18n/locales/ms.json`
- `src/i18n/locales/ar.json`
- `src/i18n/locales/vi.json`
- `src/i18n/locales/th.json`

**Example translations**:
- **zh-CN**: 导出, 导出文件夹..., 导出完成
- **ja**: エクスポート, フォルダーをエクスポート..., エクスポート完了
- **ko**: 내보내기, 폴더 내보내기..., 내보내기 완료
- **es**: Exportar, Exportar carpeta..., Exportación completa
- **fr**: Exporter, Exporter le dossier..., Exportation terminée

## Implementation Steps
1. Add all English keys to en.json
2. Translate for all 17 supported languages
3. Verify JSON syntax is valid for each file
4. Test language switching in app

## Success Criteria
- [ ] All keys added to en.json
- [ ] Translations added for all 17 languages
- [ ] JSON files are valid (no syntax errors)
- [ ] UI displays correct text when switching languages
