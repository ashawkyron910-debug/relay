# Relay

Relay is a downloadable chat app for Linux and Windows. People share servers, talk in text channels, and send direct messages. One computer runs the server. Everyone else points the app at that address.

## Run it on this computer

```bash
npm run install:all
npm run dev
```

Open http://127.0.0.1:5173, create an account, then create a server. The API listens on port 4000.

To open the desktop window while developing:

```bash
npm run dev:desktop
```

Accounts and messages are stored in `server/data/`.

## Use it with other people

1. Start the server on one machine: `npm start` (after `npm run install:all`).
2. Note the “On your network” address printed in the terminal, such as `http://192.168.1.20:4000`.
3. On every app, type that address in the Server field before registering or logging in.

The server binds to all network interfaces. Your firewall has to allow port 4000.

Optional environment variables:

- `PORT` — API port, default `4000`
- `RELAY_DATA_DIR` — folder for the database
- `RELAY_SECRET` — signing key for login tokens. If unset, Relay creates `jwt.secret` beside the database and reuses it.

## Desktop downloads

Build the web UI first, then package the desktop shell. Finished files are written to `desktop/release/`:

- Linux: `Relay-0.1.0.AppImage` and `relay-desktop_0.1.0_amd64.deb`
- Windows: `Relay Setup 0.1.0.exe` and `Relay-0.1.0-win.zip`

The AppImage can be launched directly. The `.deb` installs a Relay menu entry. On Windows, run the setup file, or unzip the zip and start `relay.exe`.

Linux (AppImage and `.deb`):

```bash
npm run pack:linux
```

Windows installer and zip. On Windows this builds a setup wizard. From Linux it builds a Windows zip; the installer step needs Wine.

```bash
npm run pack:win
```

The packaged app still talks to a Relay server. It does not embed one. Start the server on a computer everyone can reach, then enter that address on the login screen.

## Checks

```bash
npm run check
npm --prefix server exec -- tsx scripts/smoke.ts
```
