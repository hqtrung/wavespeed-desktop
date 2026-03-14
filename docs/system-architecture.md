# System Architecture

This document provides a comprehensive overview of WaveSpeed Desktop's architecture, including the new local history cache system.

## High-Level Architecture

### Multi-Process Architecture
WaveSpeed Desktop uses Electron's multi-process architecture with distinct responsibilities:

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │        App Management & IPC Handlers                   │  │
│  │  • App lifecycle (ready, windows, etc.)              │  │
│  │  • IPC registration for all modules                  │  │
│  │  • File system operations                            │  │
│  │  • Native integrations (auto-update, etc.)           │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                  Renderer Process(es)                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Browser View  │  │   DevTools     │  │   Other Views  │ │
│  │                 │  │                │  │                │ │
│  │ • React App    │  │ • Debug Tools  │  │ • Settings     │ │
│  │ • User UI      │  │                │  │ • History Page │ │
│  │ • State Mgmt   │  │                │  │ • Workflow     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Architecture

### Core Data Flow
```
User Action → Component State → IPC Message → Main Process → Data Layer → Response
```

### History Cache Data Flow
```
API Response → Cache Storage → Local Query → UI Display
            ↑
Background Sync ←── 5-min intervals
```

## Module Architecture

### 1. API Layer (`src/api/`)

#### Client Architecture
```typescript
// Centralized API client with consistent configuration
apiClient = axios.create({
  baseURL: 'https://api.wavespeed.ai',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' }
});

// Request/Response interceptors for auth and error handling
```

#### Endpoints
| Endpoint | Purpose | Response Type |
|----------|---------|---------------|
| `/api/v3/models` | List available models | `Model[]` |
| `/api/v3/{model}` | Run prediction | `PredictionResponse` |
| `/api/v3/predictions/{id}/result` | Poll result | `PredictionResult` |
| `/api/v3/predictions` | Get history | `HistoryResponse` |
| `/api/v3/balance` | Get account balance | `BalanceResponse` |

### 2. State Management (Zustand)

#### Store Architecture
```typescript
// Centralized state management with specific responsibilities
├── apiKeyStore.ts        // API key persistence & validation
├── modelsStore.ts        // Model list caching, filtering, sorting
├── playgroundStore.ts    // Multi-tab playground state
├── templateStore.ts      // Template CRUD (localStorage)
├── themeStore.ts        // Theme management (auto/dark/light)
├── assetsStore.ts       // Asset management (tags, favorites)
├── settingsStore.ts     // App settings (localStorage)
└── workflow.*           // Workflow, execution, UI state
```

#### State Persistence
- **Permanent**: electron-store (API keys, settings)
- **Session**: localStorage (templates, theme, language)
- **Volatile**: React component state (UI interactions)

### 3. History Cache System

#### Architecture Overview
The history cache system implements a **cache-first** pattern with automatic synchronization:

```
┌─────────────────────────────────────────────────────────────┐
│                    History Cache Layer                       │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │               SQLite Database                           │  │
│  │  • Local storage of prediction history                  │  │
│  │  • Full CRUD operations                               │  │
│  │  • Filtering and pagination                           │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │               Synchronization Layer                     │  │
│  │  • Background periodic sync (5-min intervals)        │  │
│  │  • Real-time sync on completion                       │  │
│  │  • Conflict resolution (API wins)                     │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                IPC Bridge                              │  │
│  │  • Main-Process communication                         │  │
│  │  • Type-safe API for renderer                         │  │
│  │  • Error handling and retry logic                     │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Database Schema
```sql
CREATE TABLE predictions (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  outputs TEXT NOT NULL,  -- JSON array
  inputs TEXT,            -- JSON object
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  execution_time INTEGER,
  has_nsfw_contents INTEGER,
  error TEXT,
  synced_at TEXT          -- Last sync timestamp
);
```

#### Cache Operations
| Operation | Purpose | Performance |
|-----------|---------|-------------|
| `upsert` | Insert/update prediction | O(1) with index |
| `list` | Get paginated predictions | O(n) with limit |
| `getById` | Get single prediction | O(1) with index |
| `delete` | Remove prediction | O(1) with index |
| `syncBulk` | Bulk API sync | O(n) batch |

### 4. Workflow System

#### Node-Based Architecture
```typescript
// Workflow execution follows this pattern:
User Input → Node Registry → Topological Sort → Execution
                               ↓
                          Browser Executor
                               ↓
                         Result Storage
```

#### Node Types
- **AI Task**: WaveSpeedAI model execution
- **Free Tool**: Local processing (enhancer, etc.)
- **I/O**: Input/output nodes
- **Annotation**: Documentation notes

### 5. Web Workers

#### Worker Architecture
Each worker runs in a separate thread for heavy processing:

| Worker | Purpose | Models/Technology |
|--------|---------|-------------------|
| `upscaler.worker` | Image/video upscaling | UpscalerJS + ESRGAN |
| `backgroundRemover.worker` | Background removal | @imgly/background-removal |
| `imageEraser.worker` | Object removal | LaMa onnxruntime-web |
| `faceEnhancer.worker` | Face enhancement | YOLO v8 + GFPGAN |
| `faceSwapper.worker` | Face swapping | InsightFace |
| `segmentAnything.worker` | Object segmentation | SlimSAM |
| `ffmpeg.worker` | Media operations | FFmpeg WASM |

## IPC Architecture

### Main Process Handlers
```typescript
// IPC channel structure:
ipcMain.handle('history-cache:*', async (_event, args) => {
  // Cache operations
});

ipcMain.handle('execution:*', async (_event, args) => {
  // Workflow execution
});

ipcMain.handle('models:*', async (_event, args) => {
  // Model operations
});
```

### Renderer Process Client
```typescript
// Type-safe IPC client:
export const historyCacheIpc = {
  list: (options: HistoryCacheListOptions) => invoke('list', options),
  upsert: (item: HistoryItem) => invoke('upsert', item),
  // ... other operations
};
```

## Storage Architecture

### Data Persistence Strategy
| Data Type | Storage | Persistence | Purpose |
|-----------|---------|-------------|---------|
| API Keys | electron-store | Permanent | Secure auth |
| Settings | electron-store | Permanent | App configuration |
| Templates | localStorage | Session | User configurations |
| History Cache | SQLite | Permanent | Offline access |
| Assets | File System + metadata | Permanent | User content |
| UI State | React State | Session | Runtime state |

## Offline Architecture

### Offline Mode Implementation
```typescript
// Graceful degradation pattern:
const fetchHistory = useCallback(async (options: HistoryFetchOptions) => {
  try {
    // Try API first (online)
    return await apiClient.getHistory(options);
  } catch (error) {
    if (isOfflineError(error)) {
      // Fallback to cache (offline)
      return await historyCacheIpc.list(options);
    }
    throw error;
  }
}, []);
```

### Network Resilience
- **API Retries**: Unlimited retry with exponential backoff
- **Cache Timeout**: 60s timeout for API requests
- **Offline Detection**: Graceful fallback to cached data
- **Sync Conflicts**: API data takes precedence over cache

## Performance Architecture

### Performance Optimizations
1. **Memory Management**: Web Workers prevent main thread blocking
2. **Caching**: Local storage reduces API calls
3. **Lazy Loading**: Component and route-level code splitting
4. **Virtualization**: Large lists use virtual scrolling
5. **WebAssembly**: Heavy processing via WASM workers

### Monitoring & Metrics
- **Performance API**: Track load times and interactions
- **Error Tracking**: Exception capture and reporting
- **Cache Metrics**: Hit rates, sync success rates
- **Resource Usage**: Memory and CPU monitoring

## Security Architecture

### Data Protection
- **API Keys**: Encrypted storage using electron-store
- **File Access**: Proper permissions for asset management
- **Input Validation**: All user inputs sanitized before processing
- **Network Security**: HTTPS only, request validation

### Code Security
- **Type Safety**: TypeScript strict mode enabled
- **Dependency Scanning**: Regular security audits
- **Sandboxing**: Web Workers run in isolated contexts

## Deployment Architecture

### Build Configuration
```typescript
// Multi-platform builds:
{
  "appId": "com.wavespeed.desktop",
  "productName": "WaveSpeed Desktop",
  "directories": {
    "output": "dist"
  },
  "mac": {
    "category": "public.app-category.developer-tools"
  },
  "win": {
    "target": "nsis"
  },
  "linux": {
    "target": "AppImage"
  }
}
```

### Update Strategy
- **Auto-Update**: electron-updater with stable/nightly channels
- **Update Server**: GitHub releases with digital signatures
- **Rollback Support**: Automatic downgrade on failure

## Testing Architecture

### Test Structure
```typescript
// Unit tests: Component and utility testing
// Integration tests: API and workflow testing
// E2E tests: Full user journey testing
```

### Coverage Requirements
- **Code Coverage**: >80% for new features
- **Component Testing**: All major components tested
- **API Testing**: Mock external dependencies
- **Performance Testing**: Load and stress testing

## Migration & Compatibility

### Version Compatibility
- **Electron**: 33.x with graceful degradation for older versions
- **Node.js**: LTS versions with polyfills where needed
- **Browsers**: Modern browsers with Progressive Enhancement
- **Platforms**: Windows 10+, macOS 10.15+, Ubuntu 18.04+

### Data Migration
- **Database Schema**: Versioned migrations for cache data
- **Settings**: Automatic migration between versions
- **Assets**: Backward compatibility for file formats

## Maintainer Notes

### Key Architecture Principles
1. **Separation of Concerns**: Each module has clear boundaries
2. **Error Resilience**: Graceful degradation for failures
3. **Performance First**: Non-blocking operations for heavy tasks
4. **Security by Default**: Secure storage and data handling
5. **Offline First**: Cache-first with sync capabilities

### Future Considerations
- **Mobile Integration**: Capacitor app planned for Q1 2025
- **Cloud Sync**: Background synchronization across devices
- **Advanced Analytics**: Performance and usage analytics
- **Team Features**: Collaboration and sharing workflows

This architecture documentation should be updated when:
- New major features are added
- Significant performance optimizations are made
- Security considerations change
- Platform requirements are updated
- Testing strategies evolve

**Last Updated**: March 14, 2026
**Version**: 2.0.21