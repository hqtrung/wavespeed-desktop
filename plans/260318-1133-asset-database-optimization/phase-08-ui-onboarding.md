---
title: "Phase 08: UI Implementation & Cloud Onboarding"
description: "Implement sync UI components and cloud onboarding flow"
status: pending
priority: P1
effort: 6h
tags: [ui, sync, onboarding, settings]
created: 2026-03-19
---

# Phase 08: UI Implementation & Cloud Onboarding

## Context Links
- Parent: [plan.md](./plan.md)
- Sync Implementation: [phase-06-sync-conflict.md](./phase-06-sync-conflict.md)
- D1 Integration: [phase-04-d1-integration.md](./phase-04-d1-integration.md)

## Overview

Implement the user-facing UI components for cloud sync configuration, status indicators, and first-run onboarding flow. The sync backend is complete (Phases 04-06) but needs frontend integration.

## Requirements

### Functional Requirements
1. Sync settings panel for configuring Cloudflare credentials
2. Sync status indicator in assets page header
3. First-run onboarding when user enables sync
4. Sync progress dialog with detailed progress
5. Conflict resolution UI (if manual intervention needed)

### Non-Functional Requirements
- UI must not block during sync operations
- Credentials stored securely (electron-store only)
- Clear error messages for configuration issues
- Responsive design for all window sizes

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ SettingsPage │  │ AssetsPage   │  │ OnboardingModal  │  │
│  │              │  │              │  │                  │  │
│  │ ┌────────────┼──┼──────────────┼──┤ CloudSetupForm   │  │
│  │ │SyncSettings│  │SyncIndicator│  │                  │  │
│  │ └────────────┘  └──────────────┘  │ ConnectionTest  │  │
│  └──────────────┘                       └──────────────────┘  │
│         │                                         │           │
│         └─────────────────┬───────────────────────┘         │
│                           │                                   │
│                    ┌──────▼────────┐                          │
│                    │ assetsStore.ts│                          │
│                    │ (sync methods)│                          │
│                    └──────┬────────┘                          │
└──────────────────────────┼─────────────────────────────────────┘
                           │ IPC
┌──────────────────────────┼─────────────────────────────────────┐
│                    Main Process │                             │
│                    ┌──────▼────────┐                          │
│                    │ ipc-handlers  │                          │
│                    │ (sync:* IPC)  │                          │
│                    └──────┬────────┘                          │
│                           │                                   │
│                    ┌──────▼────────┐                          │
│                    │ SyncManager   │                          │
│                    └───────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

## Implementation

### 1. Sync Settings Panel

**File:** `src/components/settings/SyncSettings.tsx`

```typescript
import { useState, useEffect } from "react";
import { Cloud, CloudOff, RefreshCw, Check, X, Loader2 } from "lucide-react";

interface SyncConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  userId?: string;
  deviceId?: string;
}

interface SyncStatus {
  enabled: boolean;
  lastSync: string | null;
  pending: number;
  isSyncing: boolean;
}

export function SyncSettings() {
  const [config, setConfig] = useState<Partial<SyncConfig>>({});
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    loadConfig();
    loadStatus();
  }, []);

  async function loadConfig() {
    const result = await window.electronAPI.syncGetConfig?.();
    if (result) setConfig(result);
  }

  async function loadStatus() {
    const result = await window.electronAPI.syncGetStatus?.();
    if (result) setStatus(result);
  }

  async function handleTestConnection() {
    if (!config.accountId || !config.databaseId || !config.apiToken) {
      setTestResult({ success: false, message: "Please fill in all required fields" });
      return;
    }

    setTesting(true);
    setTestResult(null);

    const result = await window.electronAPI.syncTestConnection?.(config);
    setTestResult(result);
    setTesting(false);
  }

  async function handleSave() {
    await window.electronAPI.syncConfigure?.(config);
    await loadStatus();
  }

  async function handleDisconnect() {
    await window.electronAPI.syncDisconnect?.();
    setConfig({});
    await loadStatus();
  }

  async function handleSyncNow() {
    await window.electronAPI.syncStart?.();
    await loadStatus();
  }

  const isConfigured = config.accountId && config.databaseId && config.apiToken;

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <div className="bg-muted rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status?.enabled ? (
              <Cloud className="h-8 w-8 text-green-500" />
            ) : (
              <CloudOff className="h-8 w-8 text-muted-foreground" />
            )}
            <div>
              <h3 className="font-semibold">
                {status?.enabled ? "Sync Enabled" : "Sync Not Configured"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {status?.enabled && status.lastSync
                  ? `Last synced: ${new Date(status.lastSync).toLocaleString()}`
                  : "Configure sync to enable cloud backup"}
              </p>
            </div>
          </div>
          {status?.enabled && (
            <button
              onClick={handleSyncNow}
              disabled={status.isSyncing}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {status.isSyncing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Sync Now
                </>
              )}
            </button>
          )}
        </div>

        {status?.enabled && status.pending > 0 && (
          <p className="text-sm text-orange-500 mt-2">
            {status.pending} items pending sync
          </p>
        )}
      </div>

      {/* Configuration Form */}
      {!status?.enabled ? (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Cloudflare Configuration</h3>

          {/* Account ID */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Account ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={config.accountId || ""}
              onChange={(e) => setConfig({ ...config, accountId: e.target.value })}
              placeholder="your-account-id"
              className="w-full px-3 py-2 bg-background border rounded-lg"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Found in Cloudflare dashboard URL
            </p>
          </div>

          {/* Database ID */}
          <div>
            <label className="block text-sm font-medium mb-1">
              D1 Database ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={config.databaseId || ""}
              onChange={(e) => setConfig({ ...config, databaseId: e.target.value })}
              placeholder="your-database-uuid"
              className="w-full px-3 py-2 bg-background border rounded-lg"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Create D1 database in Cloudflare dashboard
            </p>
          </div>

          {/* API Token */}
          <div>
            <label className="block text-sm font-medium mb-1">
              API Token <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={config.apiToken || ""}
              onChange={(e) => setConfig({ ...config, apiToken: e.target.value })}
              placeholder="your-api-token"
              className="w-full px-3 py-2 bg-background border rounded-lg"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Create token with D1:Edit permission
            </p>
          </div>

          {/* R2 Configuration (Optional) */}
          <details className="border rounded-lg">
            <summary className="px-4 py-2 cursor-pointer font-medium">
              R2 Storage Configuration (Optional)
            </summary>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Bucket Name</label>
                <input
                  type="text"
                  value={config.bucket || ""}
                  onChange={(e) => setConfig({ ...config, bucket: e.target.value })}
                  placeholder="your-bucket-name"
                  className="w-full px-3 py-2 bg-background border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Access Key ID</label>
                <input
                  type="text"
                  value={config.accessKeyId || ""}
                  onChange={(e) => setConfig({ ...config, accessKeyId: e.target.value })}
                  placeholder="r2-access-key-id"
                  className="w-full px-3 py-2 bg-background border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Secret Access Key</label>
                <input
                  type="password"
                  value={config.secretAccessKey || ""}
                  onChange={(e) => setConfig({ ...config, secretAccessKey: e.target.value })}
                  placeholder="r2-secret-access-key"
                  className="w-full px-3 py-2 bg-background border rounded-lg"
                />
              </div>
            </div>
          </details>

          {/* Test Connection */}
          <div className="flex gap-3">
            <button
              onClick={handleTestConnection}
              disabled={testing || !isConfigured}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border rounded-lg hover:bg-muted disabled:opacity-50"
            >
              {testing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>Test Connection</>
              )}
            </button>

            <button
              onClick={handleSave}
              disabled={!isConfigured || (!testResult?.success && testResult !== null)}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              Save & Enable Sync
            </button>
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`flex items-center gap-2 p-3 rounded-lg ${
              testResult.success ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
            }`}>
              {testResult.success ? (
                <Check className="h-5 w-5" />
              ) : (
                <X className="h-5 w-5" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Setup Guide Link */}
          <div className="bg-muted rounded-lg p-4 text-sm">
            <p className="font-medium mb-2">Need help setting up?</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Create a Cloudflare account</li>
              <li>Create a D1 database</li>
              <li>Create an API token with D1:Edit permission</li>
              <li>Optional: Create R2 bucket for file storage</li>
            </ol>
          </div>
        </div>
      ) : (
        /* Disconnect Section */
        <div className="space-y-4">
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <h4 className="font-medium text-green-500 mb-2">Sync is Active</h4>
            <p className="text-sm text-muted-foreground">
              Your assets are being synced to Cloudflare D1.
            </p>
          </div>

          <button
            onClick={handleDisconnect}
            className="px-4 py-2 border border-red-500 text-red-500 rounded-lg hover:bg-red-500/10"
          >
            Disable Sync
          </button>
        </div>
      )}

      {/* Sync Triggers Configuration */}
      {status?.enabled && (
        <details className="border rounded-lg">
          <summary className="px-4 py-2 cursor-pointer font-medium">
            Sync Triggers Configuration
          </summary>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Auto-Sync Timer</h4>
                <p className="text-sm text-muted-foreground">
                  Automatically sync at regular intervals
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  defaultChecked={false}
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Sync Interval (minutes)</label>
              <input
                type="number"
                min="5"
                max="120"
                defaultValue={15}
                className="w-32 px-3 py-2 bg-background border rounded-lg"
              />
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
```

### 2. Sync Status Indicator

**File:** `src/components/sync/SyncIndicator.tsx`

```typescript
import { useEffect, useState } from "react";
import { Cloud, CloudOff, RefreshCw, AlertCircle } from "lucide-react";

interface SyncStatus {
  enabled: boolean;
  lastSync: string | null;
  pending: number;
  isSyncing: boolean;
}

export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  async function loadStatus() {
    const result = await window.electronAPI.syncGetStatus?.();
    if (result) setStatus(result);
  }

  if (!status || !status.enabled) {
    return compact ? null : (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CloudOff className="h-4 w-4" />
        <span>Sync off</span>
      </div>
    );
  }

  if (status.isSyncing) {
    return (
      <div className="flex items-center gap-2 text-sm text-blue-500">
        <RefreshCw className="h-4 w-4 animate-spin" />
        {!compact && <span>Syncing...</span>}
      </div>
    );
  }

  if (status.pending > 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-orange-500">
        <RefreshCw className="h-4 w-4" />
        {!compact && <span>{status.pending} pending</span>}
      </div>
    );
  }

  const timeSinceSync = status.lastSync
    ? Math.floor((Date.now() - new Date(status.lastSync).getTime()) / 60000)
    : null;

  const showWarning = timeSinceSync !== null && timeSinceSync > 60; // 1 hour

  return (
    <div className={`flex items-center gap-2 text-sm ${showWarning ? 'text-orange-500' : 'text-green-500'}`}>
      <Cloud className="h-4 w-4" />
      {!compact && (
        <span>
          {showWarning ? `Synced ${timeSinceSync}m ago` : 'Synced'}
        </span>
      )}
      {showWarning && <AlertCircle className="h-3 w-3" />}
    </div>
  );
}
```

### 3. Sync Progress Dialog

**File:** `src/components/sync/SyncProgressDialog.tsx`

```typescript
import { useEffect, useState } from "react";
import { X, CloudDownload, CloudUpload, Check, AlertCircle } from "lucide-react";

interface SyncProgress {
  phase: "uploading" | "downloading" | "conflicts" | "complete";
  message: string;
  current: number;
  total: number;
}

interface SyncResult {
  success: boolean;
  uploaded: { assets: number; folders: number; categories: number };
  downloaded: { assets: number; folders: number; categories: number };
  deleted: number;
  conflicts: number;
  errors: string[];
  duration: number;
}

interface SyncProgressDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SyncProgressDialog({ open, onClose }: SyncProgressDialogProps) {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    if (open) {
      setProgress(null);
      setResult(null);
      // Listen for sync progress events
      window.electronAPI.onSyncProgress?.((p: SyncProgress) => setProgress(p));
      window.electronAPI.onSyncComplete?.((r: SyncResult) => setResult(r));
    }
  }, [open]);

  if (!open) return null;

  const percentage = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-lg w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Sync Progress</h2>
          {!result && (
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4">
          {result ? (
            /* Complete State */
            <div className="space-y-4">
              {result.success ? (
                <div className="flex items-center gap-3 text-green-500">
                  <Check className="h-8 w-8" />
                  <div>
                    <h3 className="font-semibold">Sync Complete</h3>
                    <p className="text-sm text-muted-foreground">
                      Completed in {Math.round(result.duration / 1000)}s
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-red-500">
                  <AlertCircle className="h-8 w-8" />
                  <div>
                    <h3 className="font-semibold">Sync Failed</h3>
                    <p className="text-sm text-muted-foreground">
                      {result.errors[0] || "Unknown error"}
                    </p>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-muted rounded-lg p-3">
                  <CloudDownload className="h-5 w-5 text-blue-500 mb-1" />
                  <p className="text-muted-foreground">Downloaded</p>
                  <p className="font-semibold">
                    {result.downloaded.assets + result.downloaded.folders + result.downloaded.categories} items
                  </p>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <CloudUpload className="h-5 w-5 text-green-500 mb-1" />
                  <p className="text-muted-foreground">Uploaded</p>
                  <p className="font-semibold">
                    {result.uploaded.assets + result.uploaded.folders + result.uploaded.categories} items
                  </p>
                </div>
              </div>

              {result.conflicts > 0 && (
                <p className="text-sm text-orange-500">
                  {result.conflicts} conflicts resolved automatically
                </p>
              )}

              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg"
              >
                Close
              </button>
            </div>
          ) : progress ? (
            /* Progress State */
            <div className="space-y-4">
              {/* Phase Indicator */}
              <div className="flex items-center justify-between text-sm">
                <span className="capitalize">{progress.phase}</span>
                <span className="text-muted-foreground">
                  {progress.current} / {progress.total}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${percentage}%` }}
                />
              </div>

              {/* Message */}
              <p className="text-sm text-center text-muted-foreground">
                {progress.message}
              </p>
            </div>
          ) : (
            /* Initial State */
            <div className="py-8 text-center text-muted-foreground">
              <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin" />
              <p>Starting sync...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 4. Onboarding Modal

**File:** `src/components/sync/CloudOnboardingModal.tsx`

```typescript
import { useState } from "react";
import { Cloud, ArrowRight, Check, Shield, Lock } from "lucide-react";

interface CloudOnboardingModalProps {
  open: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export function CloudOnboardingModal({ open, onComplete, onSkip }: CloudOnboardingModalProps) {
  const [step, setStep] = useState(0);

  if (!open) return null;

  const steps = [
    {
      title: "Welcome to Cloud Sync",
      icon: Cloud,
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Enable cloud sync to back up your assets and access them from multiple devices.
          </p>
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <Check className="h-5 w-5 text-green-500 mt-0.5" />
              <span>Automatic backup to Cloudflare D1</span>
            </div>
            <div className="flex items-start gap-3">
              <Check className="h-5 w-5 text-green-500 mt-0.5" />
              <span>Access from multiple devices</span>
            </div>
            <div className="flex items-start gap-3">
              <Check className="h-5 w-5 text-green-500 mt-0.5" />
              <span>Conflict-free sync with version tracking</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "What You'll Need",
      icon: Lock,
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            To set up cloud sync, you'll need a free Cloudflare account.
          </p>
          <div className="bg-muted rounded-lg p-4 space-y-3 text-sm">
            <div>
              <strong className="block">1. Cloudflare Account</strong>
              <p className="text-muted-foreground">Sign up at cloudflare.com (free)</p>
            </div>
            <div>
              <strong className="block">2. D1 Database</strong>
              <p className="text-muted-foreground">Create a D1 database in dashboard</p>
            </div>
            <div>
              <strong className="block">3. API Token</strong>
              <p className="text-muted-foreground">Create token with D1:Edit permission</p>
            </div>
          </div>
          <a
            href="https://dash.cloudflare.com/sign-up"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-4 py-2 border rounded-lg hover:bg-muted"
          >
            Create Cloudflare Account
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      ),
    },
    {
      title: "Privacy & Security",
      icon: Shield,
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Your data security is our priority.
          </p>
          <div className="bg-muted rounded-lg p-4 space-y-2 text-sm">
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-green-500 mt-0.5" />
              <div>
                <strong>Encrypted Storage</strong>
                <p className="text-muted-foreground">API token stored securely, never exposed</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-green-500 mt-0.5" />
              <div>
                <strong>Offline-First</strong>
                <p className="text-muted-foreground">Your data works without internet</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-green-500 mt-0.5" />
              <div>
                <strong>No Middleman</strong>
                <p className="text-muted-foreground">Direct connection to Cloudflare</p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
  ];

  const currentStep = steps[step];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-lg w-full max-w-lg">
        {/* Progress Dots */}
        <div className="flex justify-center gap-2 p-4">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === step ? 'w-8 bg-primary' : i < step ? 'w-2 bg-primary' : 'w-2 bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <currentStep.icon className="h-8 w-8 text-primary" />
            <h2 className="text-xl font-semibold">{currentStep.title}</h2>
          </div>
          {currentStep.content}
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-6 pt-0">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="px-4 py-2 border rounded-lg hover:bg-muted"
            >
              Back
            </button>
          )}
          <div className="flex-1" />
          {step < steps.length - 1 ? (
            <>
              <button
                onClick={() => setStep(step + 1)}
                className="px-4 py-2 border rounded-lg hover:bg-muted"
              >
                Skip
              </button>
              <button
                onClick={() => setStep(step + 1)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onSkip}
                className="px-4 py-2 border rounded-lg hover:bg-muted"
              >
                Set Up Later
              </button>
              <button
                onClick={onComplete}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
              >
                Get Started
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 5. Electron API Extensions

**File:** `src/types/electron.d.ts` (Add to existing)

```typescript
export interface ElectronAPI {
  // ... existing methods

  // Sync API
  syncGetStatus: () => Promise<{
    enabled: boolean;
    lastSync: string | null;
    pending: number;
    isSyncing: boolean;
  }>;
  syncStart: () => Promise<SyncResult>;
  syncConfigure: (config: SyncConfig) => Promise<{ success: boolean; deviceId?: string }>;
  syncDisconnect: () => Promise<{ success: boolean }>;
  syncTestConnection: (config: Partial<SyncConfig>) => Promise<{
    success: boolean;
    error?: string;
  }>;
  syncGetConfig: () => Promise<{
    accountId: string | null;
    databaseId: string | null;
    deviceId: string | null;
  }>;
  syncTriggersUpdate: (config: {
    timerEnabled?: boolean;
    intervalMinutes?: number;
  }) => Promise<TriggerConfig>;
  syncTriggersGet: () => Promise<TriggerConfig>;
  onSyncProgress?: (callback: (progress: {
    phase: "uploading" | "downloading" | "conflicts" | "complete";
    message: string;
    current: number;
    total: number;
  }) => void) => void;
  onSyncComplete?: (callback: (result: SyncResult) => void) => void;
}

interface SyncConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  userId?: string;
  deviceId?: string;
}

interface SyncResult {
  success: boolean;
  uploaded: { assets: number; folders: number; categories: number };
  downloaded: { assets: number; folders: number; categories: number };
  deleted: number;
  conflicts: number;
  errors: string[];
  duration: number;
}

interface TriggerConfig {
  timerEnabled: boolean;
  intervalMinutes: number;
  focusDebounceMs: number;
}
```

**File:** `electron/preload.ts` (Add to existing)

```typescript
import { ipcRenderer } from "electron";

// Add to existing preload script
const syncAPI = {
  getStatus: () => ipcRenderer.invoke("sync:get-status"),
  start: () => ipcRenderer.invoke("sync:start"),
  configure: (config: SyncConfig) => ipcRenderer.invoke("sync:configure", config),
  disconnect: () => ipcRenderer.invoke("sync:disconnect"),
  testConnection: (config: Partial<SyncConfig>) =>
    ipcRenderer.invoke("sync:test-connection", config),
  getConfig: () => ipcRenderer.invoke("sync:get-config"),
  triggersUpdate: (config: { timerEnabled?: boolean; intervalMinutes?: number }) =>
    ipcRenderer.invoke("sync:triggers-update", config),
  triggersGet: () => ipcRenderer.invoke("sync:triggers-get"),
  onSyncProgress: (callback: (progress: any) => void) => {
    const listener = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on("sync:progress", listener);
    return () => ipcRenderer.removeListener("sync:progress", listener);
  },
  onSyncComplete: (callback: (result: any) => void) => {
    const listener = (_event: any, result: any) => callback(result);
    ipcRenderer.on("sync:complete", listener);
    return () => ipcRenderer.removeListener("sync:complete", listener);
  },
};

// Add to contextBridge
contextBridge.exposeInMainWorld("electronAPI", {
  // ... existing
  syncGetStatus: syncAPI.getStatus,
  syncStart: syncAPI.start,
  syncConfigure: syncAPI.configure,
  syncDisconnect: syncAPI.disconnect,
  syncTestConnection: syncAPI.testConnection,
  syncGetConfig: syncAPI.getConfig,
  syncTriggersUpdate: syncAPI.triggersUpdate,
  syncTriggersGet: syncAPI.triggersGet,
  onSyncProgress: syncAPI.onSyncProgress,
  onSyncComplete: syncAPI.onSyncComplete,
});
```

### 6. IPC Progress Events

**File:** `electron/assets/sync/sync-manager.ts` (Add to existing)

```typescript
import { ipcMain, BrowserWindow } from "electron";

export class SyncManager {
  // ... existing code

  /**
   * Emit sync progress event to renderer.
   */
  private emitProgress(progress: {
    phase: "uploading" | "downloading" | "conflicts" | "complete";
    message: string;
    current: number;
    total: number;
  }): void {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send("sync:progress", progress);
    });
  }

  /**
   * Emit sync complete event to renderer.
   */
  private emitComplete(result: SyncResult): void {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send("sync:complete", result);
    });
  }

  async sync(onProgress?: SyncProgressCallback): Promise<SyncResult> {
    // ... existing code with onProgress calls

    // Add emitProgress calls at each stage
    onProgress?.({ phase: "uploading", message: "Uploading local changes...", current: 0, total: 1 });
    this.emitProgress({ phase: "uploading", message: "Uploading local changes...", current: 0, total: 1 });

    // ... when complete
    this.emitComplete(result);
    return result;
  }
}
```

## Implementation Steps

1. [ ] Create `SyncSettings.tsx` component
2. [ ] Create `SyncIndicator.tsx` component
3. [ ] Create `SyncProgressDialog.tsx` component
4. [ ] Create `CloudOnboardingModal.tsx` component
5. [ ] Add sync API to `electron.d.ts`
6. [ ] Add sync API to `preload.ts`
7. [ ] Add progress events to `sync-manager.ts`
8. [ ] Integrate `SyncIndicator` into `AssetsPage.tsx`
9. [ ] Integrate `SyncSettings` into `Settings.tsx`
10. [ ] Add first-run onboarding trigger
11. [ ] Test connection flow
12. [ ] Test sync flow with progress dialog

## Success Criteria

- Users can configure Cloudflare sync via Settings UI
- Connection test provides clear feedback
- Sync status visible in Assets page header
- Progress dialog shows real-time sync progress
- Onboarding modal guides new users through setup
- Error messages are clear and actionable
- No blocking UI operations during sync

## Security Considerations

- API token input uses password type
- Token never logged or exposed to renderer
- Clear warnings about required permissions
- Option to disable sync without losing local data

## Next Steps

[Phase 07: Testing & Validation](./phase-07-testing.md) — Complete sync tests before UI integration
