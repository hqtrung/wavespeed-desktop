# Codebase Summary

## Project Overview

**WaveSpeed Desktop** (v2.0.21) is a cross-platform Electron desktop application providing a playground interface for [WaveSpeedAI](https://wavespeed.ai) models. It enables users to browse models, run predictions, manage history, and use free AI tools without API keys.

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Electron 33.x with electron-vite |
| **Frontend** | React 18 + TypeScript |
| **Styling** | Tailwind CSS + shadcn/ui (Radix UI primitives) |
| **State** | Zustand |
| **Routing** | React Router DOM 6 |
| **HTTP** | Axios |
| **Build** | electron-vite, electron-builder |
| **AI/ML** | onnxruntime-web, @huggingface/transformers, UpscalerJS |
| **i18n** | react-i18next (18 languages) |

## Project Architecture

### Directory Structure

```
wavespeed-desktop/
├── electron/                    # Electron main process
│   ├── main.ts                 # Entry point, IPC handlers
│   ├── preload.ts              # Preload script for IPC bridge
│   ├── workflow/               # Workflow module (sql.js DB, node registry, IPC)
│   └── lib/                    # sdGenerator.ts (stable-diffusion.cpp wrapper)
│
├── src/
│   ├── api/                    # WaveSpeedAI API client
│   ├── components/
│   │   ├── layout/             # Layout, Sidebar, UpdateBanner
│   │   ├── playground/         # DynamicForm, FileUpload, MaskEditor, etc.
│   │   ├── shared/             # ApiKeyRequired, ProcessingProgress, etc.
│   │   ├── templates/          # Template browser/gallery/dialog
│   │   └── ui/                 # shadcn/ui components (Button, Dialog, etc.)
│   ├── hooks/                  # Custom React hooks (workers, progress, etc.)
│   ├── i18n/                   # 18 language locales
│   ├── lib/                    # Utilities (schemaToForm, fuzzySearch, etc.)
│   ├── pages/                  # Page components (ModelsPage, PlaygroundPage, etc.)
│   ├── stores/                 # Zustand stores (apiKey, models, settings, etc.)
│   ├── types/                  # TypeScript type definitions
│   ├── workers/                # Web Workers (upscaler, ffmpeg, etc.)
│   └── workflow/               # Workflow feature (node-based editor)
│       ├── WorkflowPage.tsx
│       ├── components/         # Canvas, panels, nodes
│       ├── stores/             # workflow, execution, ui stores
│       ├── ipc/                # IPC client
│       ├── browser/            # Browser execution, storage, API
│       └── lib/                # free-tool-runner, topological, etc.
│
│   ├── hooks/                  # Custom React hooks
│   │   ├── use-history-cache.ts # Local history cache management
│   │   └── history-sync.ts    # Background sync service
│   │
│   ├── ipc/                   # IPC clients and types
│   │   └── history.ts         # History cache IPC client
│   │
│   ├── types/                  # TypeScript type definitions
│   │   ├── history-cache.ts   # History cache types
│   │   └── prediction.ts       # Prediction types
│   │
│   └── lib/                    # Utilities
│       └── history-sync.ts    # Background synchronization
│
├── electron/                   # Electron main process
│   ├── history/              # Local history cache implementation
│   │   ├── index.ts          # Cache module initialization
│   │   ├── ipc/              # IPC handlers
│   │   │   └── history-ipc.ts # History cache IPC handlers
│   │   └── db/               # Database layer
│   │       ├── connection.ts # SQLite connection
│   │       └── prediction-repo.ts # CRUD operations
│   │
├── mobile/                     # Capacitor mobile app (shared codebase)
│
├── build/                      # Build resources (icons, entitlements)
├── docs/                       # Documentation
└── plans/                      # Implementation plans
```

## Key Features

### 1. AI Model Playground
- Browse and search WaveSpeedAI models
- Run predictions with dynamic form generation
- Batch processing (2-16 variations)
- Multi-tab playground with state persistence
- Template system for saving/loading configurations

### 2. Workflow Editor
- Node-based visual editor (React Flow)
- AI Task nodes, free-tool nodes, I/O nodes
- Execution Monitor with per-node history
- Browser-only execution (no main process)
- sql.js persistence in Electron

### 3. Free Tools (No API Key Required)
- **Image/Video Enhancer**: Upscaling with UpscalerJS ESRGAN
- **Background Remover**: @imgly/background-removal (3 outputs)
- **Face Enhancer**: YOLO v8 + GFPGAN v1.4
- **Face Swapper**: InsightFace (SCRFD, ArcFace, Inswapper)
- **Image Eraser**: LaMa inpainting with inline mask editor
- **Segment Anything**: SlimSAM with interactive point prompts
- **FFmpeg Tools**: Video/Audio/Image converter, trimmer, merger

### 4. History Cache System
- **Local SQLite Storage**: Predictions cached locally for offline access
- **Cache-First Loading**: Local history with API fallback for fresh data
- **Real-time Sync**: Immediate caching of new predictions
- **Background Sync**: Periodic updates (5-minute intervals) without user interruption
- **Offline Mode**: Graceful degradation when network unavailable
- **Filter & Pagination**: Advanced filtering and pagination capabilities

### 5. Z-Image (Local Generation)
- stable-diffusion.cpp integration
- Binary/model download with progress
- Log streaming and cancellation

### 6. Asset Management
- Auto-save to Documents/WaveSpeed/
- Tagging and favorites
- Bulk operations
- Metadata persistence

### 7. Additional Features
- 18-language i18n support
- Dark/light/auto theme
- Auto-updates (stable/nightly channels)
- History with 24h retention
- Account balance display

## Core Components

### API Client (`src/api/client.ts`)
- Base URL: `https://api.wavespeed.ai`
- Methods: models, predictions, upload, balance
- Unlimited retry on connection errors during polling

### State Management (Zustand Stores)
| Store | Purpose |
|-------|---------|
| `apiKeyStore` | API key persistence & validation |
| `modelsStore` | Model list caching, filtering, sorting |
| `playgroundStore` | Multi-tab playground state |
| `templateStore` | Template CRUD (localStorage) |
| `themeStore` | Theme management (auto/dark/light) |
| `assetsStore` | Asset management (tags, favorites) |
| `settingsStore` | App settings (localStorage) |
| `workflow.*` | Workflow, execution, UI state |

### Web Workers
| Worker | Purpose |
|--------|---------|
| `upscaler.worker` | Image/video upscaling (UpscalerJS) |
| `backgroundRemover.worker` | Background removal (@imgly) |
| `imageEraser.worker` | LaMa inpainting (onnxruntime-web) |
| `faceEnhancer.worker` | YOLO detection + GFPGAN |
| `faceSwapper.worker` | InsightFace models |
| `segmentAnything.worker` | SlimSAM (@huggingface/transformers) |
| `ffmpeg.worker` | FFmpeg WASM operations |

### IPC Handlers (Electron Main)
- `history-cache:*` - Local history cache operations
  - `list` - Retrieve cached predictions with filters
  - `upsert/upsert-bulk` - Insert/update predictions
  - `get` - Fetch single prediction by ID
  - `delete` - Remove prediction from cache
  - `stats` - Cache statistics and sync status
  - `clear` - Clear all cached data
- `workflow:*` - CRUD operations
- `execution:*` - Run, cancel, retry
- `models:*` - List, search, schema
- `cost:*` - Budget tracking (informational)
- `get-api-key`, `set-api-key`
- `save-asset`, `delete-asset`
- `download-file`, `open-external`
- Updates: `check-for-updates`, `download-update`, `install-update`

## Routing

| Path | Component | Persistent |
|------|-----------|------------|
| `/` | WelcomePage | No |
| `/models` | ModelsPage | No |
| `/playground/*` | PlaygroundPage | **Yes** |
| `/templates` | TemplatesPage | No |
| `/history` | HistoryPage | **Yes** (cache-first, offline support) |
| `/assets` | AssetsPage | **Yes** |
| `/workflow` | WorkflowPage | **Yes** |
| `/free-tools` | FreeToolsPage | **Yes** |
| `/free-tools/*` | Tool-specific pages | **Yes** |
| `/z-image` | ZImagePage | **Yes** |
| `/settings` | SettingsPage | No (public) |

## Build Configuration

### Platforms
- **macOS**: DMG + ZIP (x64, arm64), signed, notarized
- **Windows**: NSIS + ZIP (x64)
- **Linux**: AppImage + deb (x64)

### Scripts
```bash
npm run dev          # Electron dev (port 5173)
npm run dev:web      # Web-only dev (port 8989)
npm run build        # Build for current platform
npm run build:all    # Build for all platforms
```

## Key Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| electron | ^33.4.11 | Desktop framework |
| react | ^18.3.1 | UI framework |
| zustand | ^4.5.7 | State management |
| reactflow | ^11.11.4 | Workflow canvas |
| onnxruntime-web | 1.21.0 | Model runtime |
| @huggingface/transformers | ^3.8.1 | AI models |
| @imgly/background-removal | ^1.7.0 | Background removal |
| upscaler | ^1.0.0-beta.19 | Upscaling |
| sql.js | ^1.13.0 | In-browser DB (history cache) |
| i18next | ^25.7.1 | i18n |
| axios | ^1.7.7 | HTTP client |

## Development Notes

- **File naming**: kebab-case, descriptive
- **Max file size**: 200 lines (modularize large files)
- **Pre-commit**: Prettier check on `src/**/*.{ts,tsx,css}`
- **Docs location**: `./docs/`
- **Plans location**: `./plans/`
- **Mobile**: Capacitor app in `mobile/` (shared codebase)
- **Cache patterns**: Cache-first with background sync for history
