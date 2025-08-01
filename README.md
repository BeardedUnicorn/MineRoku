# Roku Controller

A modern Tauri-based desktop application for controlling Roku devices with a beautiful Material-UI interface.

## Features

### Core Functionality
- **Device Discovery**: Automatic discovery of Roku devices on your network via SSDP
- **Remote Control**: Full remote control with navigation, playback, and system controls
- **App Management**: View, browse, and launch installed apps on your Roku device
- **Multiple Device Support**: Switch between multiple Roku devices seamlessly

### Enhanced UI/UX
- **Material-UI Design**: Modern, responsive interface with dark theme
- **Tabbed Interface**: Clean separation between remote control and app management
- **App Grid Layout**: Visual app browser with icons and metadata
- **Real-time Feedback**: Success/error notifications for all actions
- **Auto-refresh**: Automatic device discovery and app list updates

### Technical Features
- **Rust Backend**: High-performance Rust backend using the Roku ECP API
- **React Frontend**: Modern React frontend with TypeScript
- **Tauri Framework**: Cross-platform desktop application
- **XML Parsing**: Robust XML parsing for Roku API responses
- **Error Handling**: Comprehensive error handling and user feedback

## Installation & Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

### Installation Steps
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd mine-roku
   ```

2. Install frontend dependencies:
   ```bash
   npm install
   ```

3. Install Tauri CLI (if not already installed):
   ```bash
   npm install -g @tauri-apps/cli
   ```

4. Run in development mode:
   ```bash
   npm run tauri dev
   ```

5. Build for production:
   ```bash
   npm run tauri build
   ```

## Usage Guide

### Device Discovery
1. Launch the application
2. The app will automatically search for Roku devices on your network
3. Available devices will appear as chips at the top of the interface
4. Click on a device chip to select it

### Remote Control
1. Select a device from the device list
2. Use the "Remote Control" tab for navigation and playback controls:
   - **Navigation Pad**: Use arrow buttons and OK button for menu navigation
   - **Control Buttons**: Home, Back, and Info buttons
   - **Playback Controls**: Play/Pause, Rewind, Fast Forward
   - **Additional Controls**: Search and Enter buttons

### App Management
1. Select a device from the device list
2. Switch to the "Apps" tab
3. Browse installed apps in a visual grid layout
4. Click "Launch" on any app to open it on your Roku device
5. Use the "Refresh" button to update the app list

## API Reference

### Tauri Commands

The application exposes the following Tauri commands:

#### `discover_roku_devices()`
- **Purpose**: Discovers Roku devices on the network
- **Returns**: `Vec<RokuDevice>`
- **Usage**: Automatically called on app startup and refresh

#### `list_roku_apps(ip: String, port: u16)`
- **Purpose**: Lists all installed apps on a specific Roku device
- **Parameters**:
  - `ip`: Device IP address
  - `port`: Device port (usually 8060)
- **Returns**: `Vec<RokuApp>`

#### `send_roku_command(ip: String, port: u16, command: String)`
- **Purpose**: Sends a remote control command to a Roku device
- **Parameters**:
  - `ip`: Device IP address
  - `port`: Device port
  - `command`: Command name (e.g., "home", "play", "up", "down", etc.)
- **Returns**: `String` (success message)

#### `launch_roku_app(ip: String, port: u16, app_id: String)`
- **Purpose**: Launches a specific app on a Roku device
- **Parameters**:
  - `ip`: Device IP address
  - `port`: Device port
  - `app_id`: Roku app ID
- **Returns**: `String` (success message)

## Project Structure

```
mine-roku/
├── src/                          # React frontend
│   ├── components/
│   │   ├── AppLauncher.tsx      # App management component
│   │   ├── DeviceTabs.tsx       # Device selection component
│   │   └── RemoteControl.tsx    # Remote control component
│   ├── App.tsx                  # Main app component
│   ├── main.tsx                 # React entry point
│   └── theme.ts                 # Material-UI theme
├── src-tauri/                   # Rust backend
│   ├── src/
│   │   ├── commands.rs          # Tauri command implementations
│   │   ├── lib.rs               # Library exports
│   │   └── main.rs              # Main application entry
│   ├── Cargo.toml              # Rust dependencies
│   └── tauri.conf.json         # Tauri configuration
├── public/                      # Static assets
├── package.json                 # npm configuration
└── README.md                   # This file
```

## Development

### Frontend Development
- The frontend is built with React + TypeScript + Material-UI
- Uses Tauri's `invoke` API to communicate with the Rust backend
- Styled with Material-UI components and custom CSS

### Backend Development
- Rust backend using Tauri framework
- HTTP client for Roku ECP API communication
- XML parsing for Roku API responses
- SSDP client for device discovery

### Adding New Features
1. Add new Tauri commands in `src-tauri/src/commands.rs`
2. Export commands in `src-tauri/src/lib.rs`
3. Register commands in `src-tauri/src/main.rs`
4. Use commands in React components with `invoke()`

## Troubleshooting

### Device Discovery Issues
- Ensure your computer and Roku devices are on the same network
- Check firewall settings - SSDP uses UDP port 1900
- Try refreshing the device list manually

### Connection Issues
- Verify Roku device is powered on and connected to network
- Check if Roku's ECP (External Control Protocol) is enabled
- Some older Roku models may have limited ECP support

### App Launch Issues
- Ensure the app is properly installed on the Roku device
- Some apps may require specific parameters or may not support ECP launch
- Check the app ID is correct (visible in the app details)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Tauri](https://tauri.app/) - For the excellent cross-platform framework
- [Material-UI](https://mui.com/) - For the beautiful UI components
- [Roku ECP API](https://developer.roku.com/docs/app-development/ecp) - For the device control protocol
