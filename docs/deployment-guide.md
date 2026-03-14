# Deployment Guide

This guide covers the build process, distribution, and maintenance of WaveSpeed Desktop across all supported platforms.

## Build Overview

WaveSpeed Desktop uses electron-vite for development and electron-builder for production builds with support for Windows, macOS, and Linux platforms.

## Prerequisites

### System Requirements
- **Node.js**: 18.x or higher (LTS recommended)
- **npm**: 9.x or higher
- **Git**: 2.x or higher
- **Python**: 3.8+ (for Linux build dependencies)

### Platform-Specific Requirements

#### macOS
- macOS 10.15 or higher
- Xcode command line tools: `xcode-select --install`
- Apple Developer account for code signing

#### Windows
- Windows 10 or higher
- Visual Studio Build Tools (for native modules)
- Windows 10/11 SDK

#### Linux
- Ubuntu 18.04 or higher
- Build essentials: `sudo apt-get install build-essential`
- Wine (for Windows app testing)

## Build Commands

### Development Builds

```bash
# Start development server
npm run dev

# Start web-only development (no Electron)
npm run dev:web
```

### Production Builds

```bash
# Build for current platform
npm run build

# Build for all platforms
npm run build:all

# Platform-specific builds
npm run build:win   # Windows
npm run build:mac   # macOS
npm run build:linux # Linux
```

### Build Configuration

The build configuration is defined in `package.json`:

```json
{
  "build": {
    "appId": "com.wavespeed.desktop",
    "productName": "WaveSpeed Desktop",
    "directories": {
      "output": "dist"
    },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "node_modules/**/*"
    ],
    "mac": {
      "category": "public.app-category.developer-tools",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist",
      "target": [
        {
          "target": "dmg",
          "arch": ["x64", "arm64"]
        },
        {
          "target": "zip",
          "arch": ["x64", "arm64"]
        }
      ]
    },
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        },
        {
          "target": "zip",
          "arch": ["x64"]
        }
      ],
      "publisherName": "WaveSpeed",
      "verifyUpdateCodeSignature": false
    },
    "linux": {
      "target": [
        {
          "target": "AppImage",
          "arch": ["x64"]
        },
        {
          "target": "deb",
          "arch": ["x64"]
        }
      ],
      "category": "Development",
      "desktop": {
        "Name": "WaveSpeed Desktop",
        "Comment": "AI Model Playground Interface",
        "Categories": "Development;Development;AI",
        "Icon": "build/icon.png"
      }
    }
  }
}
```

## Code Signing & Notarization

### macOS Code Signing

```bash
# Generate code signing certificate
codesign --force --verify --verbose --sign "Developer ID Application: WaveSpeed" \
  --options runtime \
  --entitlements build/entitlements.mac.plist \
  dist/mac/WaveSpeed\ Desktop.app
```

#### macOS Notarization

```bash
# Submit to Apple for notarization
xcrun altool --notarize-app \
  --primary-bundle-id "com.wavespeed.desktop" \
  --username "apple-id@example.com" \
  --password "@env:APPLE_PASSWORD" \
  --file "dist/mac/WaveSpeed Desktop.app.zip"

# Staple the ticket to the app
xcrun stapler staple "dist/mac/WaveSpeed Desktop.app"
```

### Windows Code Signing

```bash
# Use signtool to sign the executable
signtool sign /f "path-to-certificate.pfx" /p "password" \
  /t http://timestamp.digicert.com \
  dist/win-unpacked/WaveSpeed\ Desktop.exe
```

## Distribution

### GitHub Releases

1. **Tag the Release**:
   ```bash
   git tag -a v2.0.21 -m "Release v2.0.21"
   git push origin v2.0.21
   ```

2. **GitHub Actions Build**:
   - Automatically triggers on tag push
   - Builds for all platforms
   - Creates GitHub Release with assets

3. **Release Assets**:
   - Windows: `.exe`, `.zip`
   - macOS: `.dmg`, `.zip`
   - Linux: `.AppImage`, `.deb`

### Update Management

#### Auto-Update Configuration

The app supports auto-updates with electron-updater:

```typescript
// Check for updates
ipcMain.handle('check-for-updates', () => {
  autoUpdater.checkForUpdates();
});

// Download and install update
ipcMain.handle('download-update', () => {
  autoUpdater.downloadUpdate();
});

// Set update channel
ipcMain.handle('set-update-channel', (_, channel: 'stable' | 'nightly') => {
  settings.updateChannel = channel;
});
```

#### Update Channels

- **Stable**: Released versions with full testing
- **Nightly**: Development builds for early adopters

### Update Process

```bash
# User update flow:
1. App checks for updates on startup
2. If update available: Download → Verify → Install → Restart
3. Silent updates for non-breaking changes
4. User-initiated updates via settings
```

## Platform-Specific Considerations

### macOS

#### Build Requirements
- **Apple Developer Account**: Required for code signing
- **Notarization**: Mandatory for App Store distribution
- **Gatekeeper**: Must pass notarization for Gatekeeper approval

#### Distribution Methods
- **DMG**: Standard distribution format
- **App Store**: Requires additional review process
- **Direct Download**: DMG + ZIP for developer website

#### Code Signing
```xml
<!-- build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

### Windows

#### Build Requirements
- **Certificate**: Code signing certificate required
- **Windows Defender**: App may trigger false positives
- **Windows Store**: Additional certification needed

#### Distribution Methods
- **NSIS Installer**: Standard installer with update capability
- **ZIP**: Direct download for advanced users
- **Windows Store**: Additional certification process

#### Manifest Configuration
```xml
<!-- build/winstaller.nsis -->
Unicode true
Name "WaveSpeed Desktop"
InstallDir "$LOCALAPPDIR\WaveSpeed Desktop"

Section "Main"
  SetOutPath $INSTDIR
  File /r "dist\win-unpacked\*"
SectionEnd

Section "Start Menu"
  CreateDirectory "$SMPROGRAMS\WaveSpeed Desktop"
  CreateShortcut "$SMPROGRAMS\WaveSpeed Desktop\WaveSpeed Desktop.lnk" "$INSTDIR\WaveSpeed Desktop.exe"
SectionEnd
```

### Linux

#### Build Requirements
- **Dependencies**: Must package system dependencies
- **AppImage**: Portable format that works on most distributions
- **Debian**: Package manager integration

#### Distribution Methods
- **AppImage**: Universal portable format
- **Debian Package**: Ubuntu/Debian integration
- **Snap**: Ubuntu Store distribution

#### AppImage Configuration
```yaml
# build/appimage.yml
appId: com.wavespeed.desktop
appImage: dist/linux-unpacked/WaveSpeed-*.AppImage
bin: /usr/bin/WaveSpeedDesktop
desktop: build/desktop.desktop
```

## Testing Before Release

### Automated Testing

```bash
# Run test suite
npm test

# Run linting
npm run lint

# Type checking
npm run type-check

# Build validation
npm run build:all
```

### Manual Testing Checklist

#### macOS
- [ ] Code signing verification
- [ ] Gatekeeper compatibility
- [ ] Notarization status
- [ ] DMG mounting and installation
- [ ] Update functionality

#### Windows
- [ ] Virus scan clearance
- [ ] Windows Defender compatibility
- [ ] Installer functionality
- [ ] Update process verification
- [ ] Registry cleanup

#### Linux
- [ ] AppImage execution
- [ ] File permissions
- [ ] Desktop integration
- [ ] Package manager compatibility
- [ ] System dependency resolution

## Release Process

### Pre-Release Checklist

1. **Code Quality**
   ```bash
   npm run lint          # Check for linting issues
   npm run test          # Run all tests
   npm run type-check    # Verify TypeScript types
   ```

2. **Build Validation**
   ```bash
   npm run build:all     # Build all platforms
   npm run test:build    # Validate builds
   ```

3. **Security Scan**
   - Scan binaries for malware
   - Verify code signatures
   - Check for dependency vulnerabilities

### Release Steps

1. **Update Version**
   ```bash
   # Update package.json version
   npm version 2.0.21

   # Update documentation
   sed -i 's/version: 2\.0\.20/version: 2.0.21/g' docs/*.md
   ```

2. **Create Release**
   ```bash
   # Tag the release
   git tag -a v2.0.21 -m "Release v2.0.21"

   # Push to remote
   git push origin main
   git push origin v2.0.21
   ```

3. **Monitor Build**
   - Check GitHub Actions for build status
   - Verify all platforms build successfully
   - Review build logs for errors

### Post-Release

1. **GitHub Release**
   - Review automatically created release
   - Update release notes
   - Verify assets are attached

2. **Distribution**
   - Update website with download links
   - Update package managers if applicable
   - Notify stakeholders

3. **Monitoring**
   - Monitor crash reports
   - Track update adoption
   - Collect user feedback

## Maintenance

### Update Channels

#### Stable Channel
- **Frequency**: Monthly releases
- **Testing**: Full regression testing
- **Features**: Stable, well-tested features
- **Audience**: General users

#### Nightly Channel
- **Frequency**: Daily builds
- **Testing**: Automated testing only
- **Features**: Latest development changes
- **Audience**: Developers, early adopters

### Rollback Procedures

#### Critical Issues
1. **Identify Problem**: Monitor crash reports and user feedback
2. **Confirm Issue**: Replicate and verify the problem
3. **Create Rollback**: Previous version build
4. **Release Rollback**: Push with emergency release
5. **Notify Users**: Communication about the rollback

#### Update Process
```bash
# Emergency rollback procedure
git checkout v2.0.20  # Previous stable version
npm run build:all
git tag -a v2.0.20.1 -m "Emergency rollback"
git push origin v2.0.20.1
```

### Performance Monitoring

#### Key Metrics
- **Update Success Rate**: >95% of users successfully update
- **Crash Rate**: <0.1% after updates
- **Load Time**: <5s cold start
- **Memory Usage**: <1GB during normal operation

#### Monitoring Tools
- **Sentry**: Crash reporting and error tracking
- **Google Analytics**: User behavior and usage patterns
- **Application Insights**: Performance metrics

## Troubleshooting

### Common Build Issues

#### macOS Build Failures
```bash
# Code signing issues
codesign --verify --verbose=4 "WaveSpeed Desktop.app"

# Notarization failures
xcrun altool --notarization-info --username "apple-id" --password "password"
```

#### Windows Build Failures
```bash
# Signature verification
signtool verify /v /pa "WaveSpeed Desktop.exe"

# Dependency issues
npm install --global windows-build-tools
```

#### Linux Build Failures
```bash
# AppImage creation
appimagetool "dist/linux-unpacked"

# Package dependencies
sudo apt-get install build-essential
```

### Distribution Issues

#### Update Problems
```bash
# Check update server
curl -I https://api.github.com/repos/user/repo/releases/latest

# Verify update configuration
cat package.json | jq '.build.publish'
```

## Environment Variables

### Build Variables
```bash
# GitHub repository
GITHUB_REPOSITORY=wavespeed/wavespeed-desktop

# GitHub token (for releases)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# Apple Developer credentials
APPLE_ID=apple-id@example.com
APPLE_PASSWORD=@env:APPLE_PASSWORD

# Code signing certificate path
MAC_CERTIFICATE_PATH=path/to/certificate.p12
WIN_CERTIFICATE_PATH=path/to/certificate.pfx
```

## Documentation Links

- [Electron Builder Documentation](https://www.electron.build/)
- [electron-updater Documentation](https://www.electronjs.org/docs/latest/api/auto-updater)
- [Apple Developer Code Signing](https://developer.apple.com/documentation/security)
- [Windows Code Signing](https://docs.microsoft.com/en-us/windows/win32/secgpg/code-signing)

## Maintainer Notes

This deployment guide should be updated when:
- Build tools or dependencies change
- New platforms are added
- Distribution methods change
- Update strategies evolve
- Security requirements change

**Last Updated**: March 14, 2026
**Version**: 2.0.21