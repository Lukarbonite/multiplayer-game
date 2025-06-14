# 🎮 Multiplayer Cell Eater Game

A real-time multiplayer game inspired by Agar.io, built with Node.js, Socket.IO, and HTML5 Canvas. Features advanced cell mechanics, cross-platform controls, and Xbox controller support.

## 🚀 Features

### 🎯 Core Gameplay
- **Real-time multiplayer** - Play with others in real-time
- **Cell mechanics** - Grow by eating food, split to move faster, merge back together
- **Virus system** - Large spiky cells that can split players when consumed
- **Mass ejection** - Eject mass to feed allies or escape danger
- **Leaderboard** - See top players and your ranking
- **Minimap** - Navigate the world with a real-time minimap

### 🎨 Customization
- **Custom colors** - Choose your cell color
- **Custom images** - Upload an image to represent your cell
- **Nicknames** - Set a custom nickname visible to other players

### 🎮 Multi-Platform Controls
- **Desktop** - Mouse and keyboard controls
- **Mobile** - Touch controls with virtual joystick
- **Xbox Controller** - Full Xbox 360/One controller support with haptic feedback

### 💬 Communication
- **Real-time chat** - Chat with other players
- **System messages** - Get notified of player joins/leaves
- **Chat commands** - Use special commands for game control

### 🛠️ Advanced Features
- **Debug mode** - View technical information and cell states
- **Custom zoom** - Adjust zoom levels for better gameplay
- **Responsive design** - Works on desktop, tablet, and mobile
- **Image compression** - Automatic image optimization for better performance

## 🎮 Controls

### 🖥️ Desktop (Mouse & Keyboard)
| Input | Action |
|-------|--------|
| **Mouse** | Move cell toward cursor |
| **Space** | Split cell |
| **W** | Eject mass |
| **Enter** | Open chat |
| **Ctrl + C** | Toggle chat visibility |

### 📱 Mobile (Touch)
| Input | Action |
|-------|--------|
| **Virtual Joystick** | Move cell |
| **Split Button** | Split cell |
| **Eject Button** | Eject mass |
| **Chat Input** | Opens virtual keyboard |

### 🎮 Xbox Controller
| Input | Action |
|-------|--------|
| **Left Stick** | Move cell |
| **Right Stick** | Aim for split/eject |
| **A Button** | Split cell |
| **B Button** | Eject mass |
| **Y Button** | Toggle chat |
| **Start Button** | Open chat |
| **Back Button** | Toggle debug mode |
| **LB/RB** | Zoom out/in (discrete) |
| **Triggers** | Fine zoom control |
| **D-Pad Up/Down** | Adjust controller sensitivity |
| **D-Pad Left/Right** | Quick mass set (100/1000) |

## 💬 Chat Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/help` | Show all available commands | `/help` |
| `/debug` | Toggle debug information display | `/debug` |
| `/mass <number>` | Set your mass (1-1,000,000) | `/mass 500` |
| `/zoom <number>` | Set zoom multiplier (0.1-10) | `/zoom 1.5` |
| `/controller` | Show controller status and controls | `/controller` |

## 🛠️ Installation & Setup

### Prerequisites
- **Node.js** (v14 or higher)
- **npm** (usually comes with Node.js)

### Quick Start
1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd multiplayer-game
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   node server.js
   ```

4. **Open your browser**
   ```
   http://localhost:3000
   ```

### Dependencies
```json
{
  "express": "^4.x.x",
  "socket.io": "^4.x.x"
}
```

## 🏗️ Project Structure

```
multiplayer-game/
├── server.js              # Main server file
├── public/
│   ├── index.html         # Game HTML
│   ├── game.js           # Client-side game logic
│   ├── style.css         # Styling and responsive design
└── package.json          # Project dependencies
```

## 🎯 Game Mechanics

### Cell Growth
- Eat **food pellets** to grow slowly
- Consume **other players** to grow quickly
- Larger cells move slower than smaller ones

### Splitting
- Split your cell to move faster
- Each split creates two smaller cells
- Cells can merge back together after a cooldown
- Maximum of 16 cells per player

### Viruses
- Large green spiky cells scattered around the map
- Small players that touch viruses get consumed
- Large players that consume viruses split into multiple pieces
- Viruses respawn automatically

### Mass Ejection
- Eject small amounts of mass to move faster
- Use ejected mass to feed teammates
- Ejected mass can be consumed by any player

## 🌐 Network Features

### Real-time Synchronization
- **60 FPS** server simulation
- **30 FPS** network updates for optimal performance
- Client-side prediction for smooth movement
- Position interpolation for lag compensation

### Optimized Performance
- Delta compression for network updates
- Image compression for custom avatars
- Efficient collision detection
- Mobile-optimized rendering

## 📱 Mobile Optimization

### Responsive Design
- Adaptive UI scaling for different screen sizes
- Touch-friendly controls
- Virtual keyboard for chat
- Optimized performance for mobile devices

### Mobile-Specific Features
- Reduced graphic quality for better performance
- Simplified UI elements
- Touch gesture support
- Battery usage optimization

## 🎮 Xbox Controller Integration

### Automatic Detection
- Controllers detected automatically when connected
- Works with Xbox 360, Xbox One, and generic XInput controllers
- Visual feedback for connection status

### Advanced Features
- **Haptic feedback** for game actions
- **Configurable deadzone** for stick sensitivity
- **Dual-stick control** for movement and aiming
- **Full button mapping** for all game functions

## 🔧 Configuration

### Server Settings
Located in `server.js`:
```javascript
const PORT = 3000;                    // Server port
const WORLD_WIDTH = 4000;            // Game world width
const WORLD_HEIGHT = 4000;           // Game world height
const PELLET_COUNT = 1000;           // Number of food pellets
const VIRUS_COUNT = 50;              // Number of viruses
```

### Game Balance
```javascript
const PLAYER_START_SCORE = 10;       // Starting player mass
const PLAYER_MERGE_TIME = 15000;     // Merge cooldown (ms)
const VIRUS_SCORE = 100;             // Virus mass
```

## 🚀 Deployment

### Local Development
```bash
npm start
# or
node server.js
```

### Production Deployment
1. Set up your production server
2. Install Node.js and dependencies
3. Configure firewall for the chosen port
4. Use a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start server.js --name "multiplayer-game"
   ```

### Environment Variables
```bash
PORT=3000                    # Server port
NODE_ENV=production         # Environment mode
```

## 🐛 Troubleshooting

### Common Issues

**Controller not detected?**
- Make sure your browser supports the Gamepad API
- Try refreshing the page after connecting the controller
- Check if the controller works in other games/applications

**High latency/lag?**
- Check your internet connection
- Try connecting to a server closer to your location
- Close other bandwidth-heavy applications

**Mobile controls not working?**
- Make sure you're touching within the control areas
- Try refreshing the page
- Check if touch events are being blocked by other elements

**Can't connect to server?**
- Verify the server is running (`node server.js`)
- Check if the port is accessible
- Look for firewall or antivirus blocking

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow existing code style
- Test on multiple devices/browsers
- Update documentation for new features
- Ensure backward compatibility

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by the original Agar.io game
- Built with [Socket.IO](https://socket.io/) for real-time communication
- Uses [Express.js](https://expressjs.com/) for the web server
- Mobile touch controls inspired by modern mobile games
- Xbox controller integration using the Gamepad API

## 📊 Performance

### Recommended System Requirements
- **Desktop**: Any modern browser with JavaScript enabled
- **Mobile**: iOS 12+ or Android 8+ with modern browser
- **Controller**: Xbox 360, Xbox One, or generic XInput controller
- **Network**: Broadband internet connection for optimal experience

### Browser Compatibility
- ✅ Chrome 60+
- ✅ Firefox 55+
- ✅ Safari 12+
- ✅ Edge 79+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

---

**🎮 Ready to play? Run `node server.js` and visit `http://localhost:3000`!**