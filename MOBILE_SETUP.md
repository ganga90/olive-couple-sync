# Mobile Setup Guide

This guide explains how to run the Olive Couple Sync app on mobile devices using Capacitor.

## Prerequisites

- **For iOS**: Mac with Xcode installed
- **For Android**: Android Studio installed
- Git installed on your machine
- Node.js and npm installed

## Setup Instructions

### 1. Export and Clone the Project

1. Click the "Export to Github" button in Lovable to transfer the project to your GitHub repository
2. Clone the project to your local machine:
   ```bash
   git clone <your-github-repo-url>
   cd olive-couple-sync
   ```

### 2. Install Dependencies

```bash
npm install
```

### 3. Add Mobile Platforms

Add the platform(s) you want to build for:

```bash
# For iOS (requires Mac with Xcode)
npx cap add ios

# For Android (requires Android Studio)
npx cap add android
```

### 4. Update Platform Dependencies

```bash
# For iOS
npx cap update ios

# For Android
npx cap update android
```

### 5. Build the Web App

```bash
npm run build
```

### 6. Sync Changes to Native Platforms

```bash
npx cap sync
```

### 7. Run on Device/Emulator

```bash
# For iOS (opens Xcode)
npx cap run ios

# For Android (opens Android Studio or runs on connected device)
npx cap run android
```

## Important Notes

### Microphone Permissions

The app includes comprehensive microphone permission handling for both web and mobile:

- **Web browsers**: Automatically requests microphone access when needed
- **Mobile devices**: Uses native permission systems through Capacitor

### Hot Reload for Development

The app is configured for hot reload during development. When running on a device/emulator, the app will connect to your Lovable sandbox for live updates.

### Production Build

For production builds, update the `capacitor.config.ts` file:

1. Remove or comment out the `server.url` configuration
2. Build and sync again:
   ```bash
   npm run build
   npx cap sync
   npx cap run [ios|android]
   ```

## Troubleshooting

### iOS Issues

- Ensure you have a valid Apple Developer account for device testing
- Check that your bundle ID is properly configured in Xcode
- Make sure microphone permissions are enabled in iOS Settings

### Android Issues

- Verify Android Studio is properly installed with required SDKs
- Check that USB debugging is enabled on your Android device
- Ensure microphone permissions are granted in Android Settings

### General Issues

- Always run `npx cap sync` after making changes to the web code
- Check the console logs in the native IDEs for detailed error information
- Ensure your development server is accessible from your mobile device's network

## Keeping Up with Updates

Whenever you pull updates from the Lovable project:

1. Pull the latest changes: `git pull`
2. Install any new dependencies: `npm install`
3. Sync to native platforms: `npx cap sync`

## Learn More

For detailed mobile development information and troubleshooting, read our comprehensive blog post: https://lovable.dev/blogs/TODO