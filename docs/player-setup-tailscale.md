# Rune Forge: Player Network Setup Guide

This guide explains how to connect to Rune Forge multiplayer sessions using Tailscale.

## Why Tailscale?

Rune Forge uses Tailscale for secure, zero-trust networking:

- **No port forwarding** - Works through any NAT/firewall
- **Encrypted** - All traffic uses WireGuard encryption
- **Private** - Game server never exposed to public internet
- **Simple** - One-click authentication via SSO

## Prerequisites

1. A Tailscale account (free tier supports up to 100 devices)
2. A web browser (Chrome, Firefox, Safari, or Edge)
3. An invitation from the Dungeon Master (DM)

## Step 1: Install Tailscale

### Windows

1. Download from [tailscale.com/download](https://tailscale.com/download)
2. Run the installer
3. Click the Tailscale icon in system tray and sign in

### macOS

1. Download from the [App Store](https://apps.apple.com/app/tailscale/id1475387142) or [tailscale.com/download](https://tailscale.com/download)
2. Open the app
3. Click "Connect" and sign in

### Linux

```bash
# Debian/Ubuntu
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Fedora
sudo dnf install tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up
```

### iOS / Android

Download "Tailscale" from the App Store or Google Play.

## Step 2: Join the Tailnet

The DM will share one of these with you:

### Option A: Share Link (Recommended)

1. DM sends you a Tailscale share link
2. Click the link to add the game server to your network
3. Accept the share in your Tailscale app

### Option B: Invite to Tailnet

1. DM adds your email to the Tailnet
2. You'll receive an invitation email
3. Accept the invitation to join the network

## Step 3: Connect to Rune Forge

Once connected to the Tailnet:

1. Open your browser
2. Navigate to the game URL provided by the DM:
   ```
   http://runeforge.tailnet-name.ts.net
   ```
   or the direct Tailscale IP:
   ```
   http://100.x.y.z:3000
   ```

3. Log in with Pocket ID (passkey or password)
4. You're ready to play!

## Troubleshooting

### "Cannot reach server"

1. Verify Tailscale is connected (icon should show connected status)
2. Try `tailscale ping runeforge` in terminal
3. Ask DM to verify ACL permissions

### "Connection refused"

1. The game server may not be running
2. Contact the DM to start the server

### "Tailscale not connecting"

1. Check your internet connection
2. Try `tailscale down` then `tailscale up`
3. Restart the Tailscale service

### Slow connection

Tailscale uses DERP relays if direct connections fail. For better performance:

1. Ensure UDP port 41641 is not blocked
2. Try connecting from a different network

## Network Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     TAILSCALE MESH                          │
│                                                             │
│  ┌─────────────┐      WireGuard      ┌─────────────────┐   │
│  │   Player    │◄────────────────────►│  Game Server    │   │
│  │  (Client)   │     Encrypted        │  (Rune Forge)   │   │
│  │ 100.x.y.z   │                      │  100.a.b.c:3000 │   │
│  └─────────────┘                      └─────────────────┘   │
│         ▲                                      ▲            │
│         │                                      │            │
│         │         DERP Relay                   │            │
│         │     (if direct fails)                │            │
│         └──────────────┬───────────────────────┘            │
│                        │                                    │
│                 ┌──────▼──────┐                             │
│                 │  Tailscale  │                             │
│                 │   Control   │                             │
│                 │   Plane     │                             │
│                 └─────────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

## Security Notes

- Traffic between you and the game server is end-to-end encrypted
- The game server is not accessible from the public internet
- Your Tailscale identity is linked to your email address
- The DM can revoke access at any time via Tailscale admin console

## DM: Sharing Access

As a DM, you can share access to your game server:

### Using Tailscale Sharing

```bash
# Share a specific device
tailscale share --accept runeforge

# Or via admin console:
# 1. Go to admin.tailscale.com
# 2. Select your game server device
# 3. Click "Share" and enter player emails
```

### ACL Configuration (Advanced)

For more control, configure ACLs in `tailscale.com/admin/acls`:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:players"],
      "dst": ["tag:gameserver:3000"]
    }
  ],
  "tagOwners": {
    "tag:players": ["autogroup:members"],
    "tag:gameserver": ["admin@yourdomain.com"]
  }
}
```

## FAQ

**Q: Is Tailscale free?**
A: Yes, the free tier supports up to 100 devices and 3 users, which is plenty for personal gaming.

**Q: Can I use Tailscale for other games?**
A: Yes! Tailscale works for any peer-to-peer or client-server gaming.

**Q: Does Tailscale slow down my connection?**
A: Minimal overhead. WireGuard is highly optimized. Direct connections have near-zero latency added.

**Q: What if I don't want to install Tailscale?**
A: Tailscale is required for secure access. The alternative would be exposing the server to the internet, which is not recommended.
