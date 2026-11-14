# Mellow Community Chat

A responsive community chat built with Node.js, Express, and Socket.IO.

## Run locally

1. Install [Node.js](https://nodejs.org/) 18 or newer.
2. From the project folder, install dependencies and start the server:

   ```sh
   npm install
   npm start
   ```

3. Open [http://localhost:3000](http://localhost:3000).

The server listens on `127.0.0.1` and uses port `3000` by default. Set the `PORT` environment variable to use another port.

## Preview a time theme

By default, the theme follows the computer's local time and updates automatically. To preview a specific theme, set `TEST_TIME` before starting the server; supported values are `morning`, `afternoon`, `evening`, and `night`.

PowerShell:

```powershell
$env:TEST_TIME = "afternoon"
npm start
```

In Command Prompt:

```bat
set TEST_TIME=night&& npm start
```

In macOS/Linux shells:

```sh
TEST_TIME=evening npm start
```

Restart with a different value to preview another theme. Clear the override to return to automatic local-time switching (PowerShell: `Remove-Item Env:TEST_TIME`).

## Features

- Username and profile-icon or photo setup on first visit; the browser remembers the profile.
- Change your username or profile photo from the community menu. Name changes update existing chat messages and status comments.
- Real-time community messages and online/registered-user counts.
- Expandable sidebar, responsive phone/tablet/desktop layouts, and a separate SVG tree background.
- Automatic local-time themes: light green in the morning, yellow in the afternoon, orange in the evening, and light blue at night, using the same tree illustration with a matching palette.
- Community menu with a searchable member list, copy-link, sidebar, and scroll-to-latest actions.
- Searchable Status Page with inline video playback, likes, comments, uploader profiles, and shareable status cards in chat. Open a shared card to jump to that status.
- Server Status dashboard with live service health, app and host uptime, Node.js runtime, platform, CPU core count, and memory usage. Metrics refresh every 30 seconds.
- Up to five attachments per message, 10 MB each. Images, audio, video, and PDFs can be previewed; attachments also have download controls and common file types use distinct icons.
- Profile pictures accept JPEG, PNG, GIF, WebP, or AVIF files up to 5 MB. Status videos accept MP4, WebM, or Ogg up to 50 MB; captions and comments are limited to 500 characters.
- Messages, profiles, uploaded files, and statuses are stored locally in the `data/` directory.

## Using Statuses

1. Select **Status Page** in the sidebar.
2. Choose an MP4, WebM, or Ogg video, preview it, and optionally add a caption.
3. Post the status. Community members can play the video, like it, comment, or share a link card in chat.
4. Use the search field to filter posts by caption or uploader.

Videos are stored as uploaded; the server does not transcode them. Playback depends on browser codec support.

## Server Status

Select **Server Status** in the sidebar to view current host and application metrics. The dashboard reads The `/api/server-status` endpoint and refreshes automatically while open.