import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock sql.js
vi.mock("sql.js", () => ({
  init: vi.fn().mockResolvedValue({
    Database: vi.fn(() => ({
      exec: vi.fn(),
      run: vi.fn(),
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        free: vi.fn(),
      }),
      close: vi.fn(),
      export: vi.fn(),
    })),
  }),
}));

// Mock Electron
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn().mockReturnValue("/mock/user/data"),
    whenReady: vi.fn().mockResolvedValue(),
  },
  ipcMain: {
    handle: vi.fn(),
    handleOnce: vi.fn(),
  },
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock path
vi.mock("path", () => ({
  join: vi.fn((...args) => args.join("/")),
  dirname: vi.fn((p) => p),
}));

// Mock console for test output
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

beforeAll(() => {
  // Suppress console errors during tests except for specific cases
  console.error = (...args: any[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("Warning:")
    ) {
      return; // Suppress React warnings
    }
    originalConsole.error(...args);
  };
});

afterAll(() => {
  // Restore console
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
});

// Mock localStorage for browser testing
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Mock window.matchMedia for theme detection
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});