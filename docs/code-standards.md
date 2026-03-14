# Code Standards

This document defines the coding standards and architectural patterns for WaveSpeed Desktop.

## File Structure & Organization

### Naming Conventions

#### Files
- **JavaScript/TypeScript**: kebab-case (e.g., `use-history-cache.ts`, `history-sync.ts`)
- **Components**: PascalCase for components (e.g., `HistoryPage.tsx`)
- **Utilities/Helpers**: kebab-case for functions, PascalCase for classes
- **CSS/Styles**: kebab-case (e.g., `workflow-panel.css`)
- **Tests**: mirror source file names with `.test.ts` or `.spec.ts`

#### Directories
- Lowercase with descriptive names: `src/components/ui/`, `src/lib/utils/`
- Group related functionality: `src/workflow/`, `src/hooks/`

### Project Structure

```
wavespeed-desktop/
├── src/
│   ├── api/                    # API client and types
│   │   ├── client.ts           # WaveSpeedAI API client
│   │   └── types.ts           # API response types
│   ├── components/             # UI components
│   │   ├── layout/            # Layout components
│   │   ├── playground/        # Playground-specific components
│   │   ├── shared/            # Shared utility components
│   │   └── ui/                # shadcn/ui base components
│   ├── hooks/                 # Custom React hooks
│   ├── lib/                   # Utility functions and constants
│   ├── pages/                 # Page components
│   ├── stores/                # Zustand state stores
│   ├── types/                 # TypeScript type definitions
│   ├── workers/               # Web Workers
│   └── workflow/             # Workflow feature
├── electron/                  # Electron main process
│   ├── main.ts               # Entry point and IPC handlers
│   ├── preload.ts            # Preload script
│   ├── workflow/             # Workflow main process code
│   ├── history/              # History cache functionality
│   └── lib/                  # Main process utilities
└── docs/                     # Documentation
```

## Code Quality Guidelines

### File Size Management

**Maximum 200 lines per file** - Split large files into smaller, focused components:

#### Before (Large File)
```typescript
// src/components/HistoryPage.tsx (300+ lines)
const HistoryPage: React.FC = () => {
  // Complex component with multiple responsibilities
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({});
  // ... many more hooks and logic
}
```

#### After (Split Components)
```typescript
// src/components/history/HistoryList.tsx
const HistoryList: React.FC<{ items: HistoryItem[] }> = ({ items }) => {
  return items.map(item => <HistoryItemRow key={item.id} item={item} />);
}

// src/components/history/HistoryFilters.tsx
const HistoryFilters: React.FC = () => {
  // Filter logic here
}

// src/pages/HistoryPage.tsx
const HistoryPage: React.FC = () => {
  const { items, loading } = useHistoryCache();
  return (
    <div>
      <HistoryFilters />
      <HistoryList items={items} />
    </div>
  );
}
```

### TypeScript Guidelines

#### Type Definitions
- Use interface for object shapes, type for unions/primitives
- Prefer `const assertions` for literal types
- Use `readonly` for immutable arrays
- Be specific about error types

```typescript
// ✅ Good
interface PredictionRequest {
  readonly model: string;
  inputs: Record<string, unknown>;
}

// ✅ Good
type PredictionStatus = "pending" | "processing" | "completed" | "failed";

// ✅ Good
type ApiError = {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
};
```

#### Function Types
- Use arrow functions for class components and hooks
- Use regular functions for pure utilities
- Always specify return types

```typescript
// ✅ Hook with arrow function
const useHistoryCache = (): HistoryCacheReturn => {
  const upsertToCache = useCallback((item: HistoryItem) => {
    // implementation
  }, []);

  return { upsertToCache };
};

// ✅ Utility with regular function
const formatDate = (date: string): string => {
  return new Date(date).toLocaleDateString();
};
```

### React Patterns

#### Hooks Usage
- Use hooks in this order: useState → useEffect → useCallback → useMemo
- Dependency arrays must be complete and accurate
- Avoid custom hooks with external state

```typescript
// ✅ Good order and dependencies
const UserProfile: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getUser();
      setUser(data);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []); // Empty dependency array - no external dependencies

  useEffect(() => {
    fetchData();
  }, [fetchData]); // Include fetchData in dependency array
}, []);
```

#### Component Patterns
- Use functional components with hooks
- Prefer composition over inheritance
- Keep props interface separate from component

```typescript
// ✅ Good component structure
interface HistoryItemRowProps {
  item: HistoryItem;
  onClick: (item: HistoryItem) => void;
}

const HistoryItemRow: React.FC<HistoryItemRowProps> = ({ item, onClick }) => {
  const handleClick = useCallback(() => {
    onClick(item);
  }, [item, onClick]);

  return (
    <div onClick={handleClick}>
      <h3>{item.model}</h3>
      <p>{formatDate(item.created_at)}</p>
    </div>
  );
};
```

### State Management (Zustand)

#### Store Patterns
- One store per logical domain
- Use selectors for derived state
- Keep actions simple and pure

```typescript
// ✅ Good store structure
interface HistoryStore {
  items: HistoryItem[];
  loading: boolean;
  error: Error | null;
  fetchHistory: (options?: HistoryFetchOptions) => Promise<void>;
  clearError: () => void;
}

const useHistoryStore = create<HistoryStore>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  fetchHistory: async (options = {}) => {
    set({ loading: true, error: null });
    try {
      const items = await api.getHistory(options);
      set({ items, loading: false });
    } catch (error) {
      set({ error: error as Error, loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
```

### API Patterns

#### Client Configuration
- Centralized configuration
- Consistent error handling
- Request/response interception

```typescript
// ✅ Good API client
export const apiClient = axios.create({
  baseURL: 'https://api.wavespeed.ai',
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ✅ Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    const token = apiKeyStore.getState().apiKey;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ✅ Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      apiKeyStore.getState().clearApiKey();
    }
    return Promise.reject(error);
  }
);
```

### Error Handling Patterns

#### API Errors
```typescript
// ✅ Good error handling
const runPrediction = async (model: string, inputs: unknown) => {
  try {
    const response = await apiClient.post(`/api/v3/${model}`, inputs);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded');
      }
      if (error.response?.status === 400) {
        throw new Error(`Validation error: ${error.response.data.message}`);
      }
    }
    throw error;
  }
};
```

#### Component Error Boundaries
```typescript
// ✅ Error boundary component
interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error: Error }>;
}

const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({
  children,
  fallback = DefaultErrorFallback
}) => {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setError(new Error(event.message));
    };

    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (error) {
    return <fallback error={error} />;
  }

  return <>{children}</>;
};
```

### Testing Standards

#### Component Testing
- Test user interactions, not implementation details
- Use proper cleanup for async operations
- Mock external dependencies

```typescript
// ✅ Good component test
describe('HistoryItemRow', () => {
  it('calls onClick when item is clicked', () => {
    const mockClick = jest.fn();
    const item: HistoryItem = { id: '1', model: 'test-model' };

    render(<HistoryItemRow item={item} onClick={mockClick} />);

    const row = screen.getByText('test-model');
    userEvent.click(row);

    expect(mockClick).toHaveBeenCalledWith(item);
  });
});
```

#### Hook Testing
```typescript
// ✅ Good hook test
describe('useHistoryCache', () => {
  it('upserts items to cache', async () => {
    const mockUpsert = jest.fn().mockResolvedValue({ success: true });

    mockIpcModule.historyCache.upsert = mockUpsert;

    renderHook(() => useHistoryCache());

    const item: HistoryItem = { id: '1', model: 'test' };
    await act(async () => {
      result.current.upsertToCache(item);
    });

    expect(mockUpsert).toHaveBeenCalledWith(item);
  });
});
```

### Web Worker Patterns

#### Worker Creation
```typescript
// ✅ Good worker pattern
interface WorkerMessage {
  type: 'process' | 'cancel';
  payload: unknown;
}

class BackgroundRemoverWorker {
  private worker: Worker | null = null;

  constructor() {
    this.worker = new Worker(
      new URL('./background-remover.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }

  processImage(image: ImageBitmap): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'result') {
          this.worker?.removeEventListener('message', handler);
          resolve(event.data.payload);
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage({ type: 'process', payload: image });
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
```

### IPC Patterns

#### Main Process
```typescript
// ✅ Good IPC handler
export function registerHistoryIpc(): void {
  ipcMain.handle(
    'history-cache:list',
    async (_event, options: HistoryCacheListOptions) => {
      try {
        return await predictionRepo.listPredictions(options);
      } catch (error) {
        console.error('[History Cache] List failed:', error);
        throw new Error('Failed to fetch history');
      }
    }
  );
}
```

#### Renderer Process
```typescript
// ✅ Good IPC client
export const historyCacheIpc = {
  list: (options: HistoryCacheListOptions): Promise<CachedPrediction[]> =>
    invoke('list', options).catch((error) => {
      console.error('[History Cache] List failed:', error);
      throw new Error('Failed to fetch history');
    }),
};
```

## Code Review Checklist

### Required Reviews
- **Security**: No sensitive data in logs or storage
- **Performance**: No memory leaks, proper cleanup
- **Type Safety**: TypeScript compilation passes, no `any` types
- **Testing**: New features include unit/integration tests
- **Documentation**: JSDoc comments for public APIs

### Review Criteria
- **Functionality**: Feature works as specified
- **Maintainability**: Code is clear and maintainable
- **Performance**: No performance regressions
- **Consistency**: Follows established patterns
- **Error Handling**: Proper error handling and user feedback

## Pre-commit Hooks

### Enabled Checks
- **Prettier**: Format code according to style guide
- **TypeScript**: Type checking compilation
- **ESLint**: Linting for common issues
- **Tests**: Unit test execution

### Commands
```bash
# Format code
npx prettier --write src/**/*.{ts,tsx,css}

# Type check
npx tsc --noEmit

# Lint code
npx eslint src/ --ext .ts,.tsx

# Run tests
npm test
```

## Documentation Standards

### Component Documentation
```typescript
/**
 * Displays a history item with preview and actions.
 * @param item - The history item to display
 * @param onPlaygroundClick - Callback to open in playground
 */
interface HistoryItemRowProps {
  item: HistoryItem;
  onPlaygroundClick: (item: HistoryItem) => void;
}
```

### API Documentation
```typescript
/**
 * Fetches prediction history from API or cache.
 * @param options - Filtering and pagination options
 * @returns Promise resolving to history items array
 */
export const getHistory = async (options?: HistoryFetchOptions): Promise<HistoryItem[]> => {
  // implementation
};
```

## Development Workflow

### Branch Strategy
- `main`: Production-ready code
- `develop`: Integration branch
- `feature/*`: Feature branches
- `hotfix/*`: Critical fixes

### Commit Messages
```bash
# Good commit messages
feat: add history cache with SQLite storage
fix: resolve memory leak in worker threads
docs: update API documentation
refactor: optimize image processing performance
test: add comprehensive test suite for history module
```

## Security Guidelines

### Data Protection
- Never log sensitive data (API keys, personal information)
- Validate all user inputs
- Use secure storage for credentials (electron-store with encryption)

### Network Security
- HTTPS only for API requests
- Request timeout handling
- Rate limiting awareness

## Performance Optimization

### Memory Management
- Clean up event listeners and intervals
- Cancel pending requests on unmount
- Use React.memo for expensive renders

### Bundle Optimization
- Lazy load heavy components
- Code splitting for routes
- Tree-shake unused dependencies

## Maintainer Notes

This document should be updated when:
- New patterns emerge that should be standardized
- Build tools or frameworks change
- Team processes evolve
- New security concerns arise

**Last Updated**: March 14, 2026
**Version**: 2.0.21