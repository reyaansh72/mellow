const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_PROFILE_PICTURE_SIZE = 5 * 1024 * 1024;
const MAX_STATUS_VIDEO_SIZE = 50 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const AVATARS = ["🌙", "🌿", "☀️", "🌊", "🪻", "🦊", "🐻", "🐱", "🐼", "🦋", "🍄", "✨", "🌸", "🌻", "🍀", "⭐", "🐸", "🐰", "🐧", "🐨", "🐯", "🦄", "🐢", "🐬", "🍓", "🍒", "🍉", "🍑", "🍕", "🍩", "🧁", "🎀", "🧸", "🎧", "🎮", "🔮", "💎", "🪐", "🔥", "💜"];
const INLINE_TYPES = new Set(["image/avif", "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "audio/mpeg", "audio/ogg", "audio/wav", "video/mp4", "video/ogg", "video/webm"]);
const STATUS_VIDEO_EXTENSIONS = new Map([
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/ogg", ".ogv"]
]);
const PROFILE_PICTURE_EXTENSIONS = new Map([
  ["image/avif", ".avif"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);
const MIME_TYPES = {
  ".avif": "image/avif",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".webp": "image/webp"
};

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function start() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  const users = await readJson(path.join(DATA_DIR, "users.json"), []);
  const messages = await readJson(path.join(DATA_DIR, "messages.json"), []);
  const files = await readJson(path.join(DATA_DIR, "files.json"), []);
  const statuses = await readJson(path.join(DATA_DIR, "statuses.json"), []);
  if (![users, messages, files, statuses].every(Array.isArray)) {
    throw new Error("Chat data files must contain JSON arrays.");
  }

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const onlineSockets = new Map();
  let writeQueue = Promise.resolve();

  function serialize(task) {
    const operation = writeQueue.then(task);
    writeQueue = operation.catch((error) => console.error("Could not save chat data:", error));
    return operation;
  }

  function publicFile(file) {
    const { id, name, size, mime } = file;
    return { id, name, size, mime, url: `/api/files/${id}` };
  }

  function publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      avatarUrl: user.avatarUrl || null,
      createdAt: user.createdAt
    };
  }

  function publicStatus(status) {
    const uploader = findUser(status.userId);
    const video = files.find((file) => file.id === status.videoId);
    const comments = (Array.isArray(status.comments) ? status.comments : []).map((comment) => {
      const author = findUser(comment.userId);
      return {
        id: comment.id,
        userId: comment.userId,
        username: author ? author.username : "Community member",
        avatar: author ? author.avatar : "🌙",
        avatarUrl: author ? author.avatarUrl || null : null,
        text: comment.text,
        createdAt: comment.createdAt
      };
    });
    return {
      id: status.id,
      uploader: uploader ? publicUser(uploader) : null,
      caption: status.caption,
      video: video ? publicFile(video) : null,
      likes: Array.isArray(status.likes) ? status.likes : [],
      comments,
      createdAt: status.createdAt
    };
  }

  function stats() {
    return { registered: users.length, online: new Set(onlineSockets.values()).size };
  }

  function broadcastStats() {
    io.emit("community:stats", stats());
  }

  function findUser(id) {
    return users.find((user) => user.id === id);
  }

  app.use(express.json({ limit: "256kb" }));

  app.post("/api/join", async (req, res, next) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const avatar = typeof req.body?.avatar === "string" && AVATARS.includes(req.body.avatar) ? req.body.avatar : AVATARS[0];
    if (!username || username.length > 24 || /[\u0000-\u001f\u007f]/.test(username)) {
      return res.status(400).json({ error: "Choose a username between 1 and 24 characters." });
    }

    try {
      const user = await serialize(async () => {
        const existing = users.find((candidate) => candidate.username.toLocaleLowerCase() === username.toLocaleLowerCase());
        if (existing) {
          existing.avatar = avatar;
          await writeJson(path.join(DATA_DIR, "users.json"), users);
          return existing;
        }
        const created = { id: crypto.randomUUID(), username, avatar, createdAt: new Date().toISOString() };
        users.push(created);
        await writeJson(path.join(DATA_DIR, "users.json"), users);
        return created;
      });
      broadcastStats();
      res.json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/session/:id", (req, res) => {
    const user = findUser(req.params.id);
    if (!user) return res.status(404).json({ error: "This profile was not found. Please join again." });
    res.json({ user: publicUser(user) });
  });

  app.get("/api/stats", (req, res) => res.json(stats()));

  app.get("/api/members", (req, res) => {
    const onlineUsers = new Set(onlineSockets.values());
    const members = users
      .map((user) => ({ ...publicUser(user), online: onlineUsers.has(user.id) }))
      .sort((left, right) => Number(right.online) - Number(left.online) || left.username.localeCompare(right.username));
    res.json({ members });
  });

  app.get("/api/messages", (req, res) => {
    res.json(messages.slice(-300));
  });

  function requireUser(req, res, next) {
    const user = findUser(req.get("x-user-id"));
    if (!user) return res.status(401).json({ error: "Join the community before continuing." });
    req.user = user;
    next();
  }

  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, UPLOADS_DIR),
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID())
  });
  const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_ATTACHMENTS }
  });
  const profilePictureUpload = multer({
    storage,
    limits: { fileSize: MAX_PROFILE_PICTURE_SIZE, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, PROFILE_PICTURE_EXTENSIONS.has(file.mimetype))
  });
  const statusVideoUpload = multer({
    storage,
    limits: { fileSize: MAX_STATUS_VIDEO_SIZE, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, STATUS_VIDEO_EXTENSIONS.has(file.mimetype))
  });

  app.patch("/api/profile", requireUser, async (req, res, next) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    if (!username || username.length > 24 || /[\u0000-\u001f\u007f]/.test(username)) {
      return res.status(400).json({ error: "Choose a username between 1 and 24 characters." });
    }

    try {
      const conflict = await serialize(async () => {
        if (users.some((user) => user.id !== req.user.id && user.username.toLocaleLowerCase() === username.toLocaleLowerCase())) {
          return true;
        }
        req.user.username = username;
        messages.forEach((message) => {
          if (message.userId === req.user.id) message.username = username;
          if (message.status) {
            if (message.status.uploader?.id === req.user.id) message.status.uploader = publicUser(req.user);
            message.status.comments?.forEach((comment) => {
              if (comment.userId === req.user.id) comment.username = username;
            });
          }
        });
        await writeJson(path.join(DATA_DIR, "messages.json"), messages);
        await writeJson(path.join(DATA_DIR, "users.json"), users);
        return false;
      });
      if (conflict) return res.status(409).json({ error: "That username is already in use." });
      const user = publicUser(req.user);
      io.emit("community:user-updated", user);
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/uploads", requireUser, upload.array("files", MAX_ATTACHMENTS), async (req, res, next) => {
    try {
      const uploaded = (req.files || []).map((file) => {
        const id = file.filename;
        const name = path.basename(file.originalname).replace(/[\r\n]/g, "").slice(0, 180) || "attachment";
        const extension = path.extname(name).toLowerCase();
        return {
          id,
          name,
          size: file.size,
          mime: MIME_TYPES[extension] || "application/octet-stream",
          ownerId: req.user.id,
          createdAt: new Date().toISOString()
        };
      });
      await serialize(async () => {
        files.push(...uploaded);
        await writeJson(path.join(DATA_DIR, "files.json"), files);
      });
      res.json({ files: uploaded.map(publicFile) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/statuses", (_req, res) => {
    res.json({
      statuses: statuses
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(publicStatus)
    });
  });

  app.post("/api/statuses", requireUser, statusVideoUpload.single("video"), async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ error: "Choose an MP4, WebM, or Ogg video up to 50 MB." });
    }
    const caption = typeof req.body?.caption === "string" ? req.body.caption.trim() : "";
    if (caption.length > 500) {
      try {
        await fs.unlink(req.file.path);
      } catch (error) {
        return next(error);
      }
      return res.status(400).json({ error: "Status captions must be 500 characters or fewer." });
    }

    const id = req.file.filename;
    const extension = STATUS_VIDEO_EXTENSIONS.get(req.file.mimetype);
    const originalName = path.basename(req.file.originalname).replace(/[\r\n]/g, "").slice(0, 180);
    const video = {
      id,
      name: path.extname(originalName) ? originalName : `status-video${extension}`,
      size: req.file.size,
      mime: req.file.mimetype,
      ownerId: req.user.id,
      createdAt: new Date().toISOString()
    };
    const status = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      videoId: id,
      caption,
      likes: [],
      comments: [],
      createdAt: new Date().toISOString()
    };

    try {
      await serialize(async () => {
        files.push(video);
        statuses.push(status);
        try {
          await writeJson(path.join(DATA_DIR, "files.json"), files);
          await writeJson(path.join(DATA_DIR, "statuses.json"), statuses);
        } catch (error) {
          files.splice(files.findIndex((file) => file.id === id), 1);
          statuses.splice(statuses.findIndex((candidate) => candidate.id === status.id), 1);
          try {
            await writeJson(path.join(DATA_DIR, "files.json"), files);
            await writeJson(path.join(DATA_DIR, "statuses.json"), statuses);
          } catch (rollbackError) {
            console.error("Could not roll back a failed status upload:", rollbackError);
          }
          throw error;
        }
      });
      const result = publicStatus(status);
      io.emit("status:created", result);
      res.status(201).json({ status: result });
    } catch (error) {
      const fileIndex = files.findIndex((file) => file.id === id);
      if (fileIndex !== -1) files.splice(fileIndex, 1);
      const statusIndex = statuses.findIndex((candidate) => candidate.id === status.id);
      if (statusIndex !== -1) statuses.splice(statusIndex, 1);
      await fs.unlink(req.file.path).catch((cleanupError) => {
        if (cleanupError.code !== "ENOENT") console.error("Could not remove a failed status upload:", cleanupError);
      });
      next(error);
    }
  });

  app.post("/api/statuses/:id/like", requireUser, async (req, res, next) => {
    const status = statuses.find((candidate) => candidate.id === req.params.id);
    if (!status) return res.status(404).json({ error: "That status could not be found." });

    try {
      await serialize(async () => {
        if (!Array.isArray(status.likes)) status.likes = [];
        const index = status.likes.indexOf(req.user.id);
        if (index === -1) status.likes.push(req.user.id);
        else status.likes.splice(index, 1);
        await writeJson(path.join(DATA_DIR, "statuses.json"), statuses);
      });
      const result = publicStatus(status);
      io.emit("status:updated", result);
      res.json({ status: result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/statuses/:id/comments", requireUser, async (req, res, next) => {
    const status = statuses.find((candidate) => candidate.id === req.params.id);
    if (!status) return res.status(404).json({ error: "That status could not be found." });
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 500) {
      return res.status(400).json({ error: "Comments must be between 1 and 500 characters." });
    }

    try {
      await serialize(async () => {
        status.comments.push({
          id: crypto.randomUUID(),
          userId: req.user.id,
          text,
          createdAt: new Date().toISOString()
        });
        await writeJson(path.join(DATA_DIR, "statuses.json"), statuses);
      });
      const result = publicStatus(status);
      io.emit("status:updated", result);
      res.status(201).json({ status: result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/profile-picture", requireUser, profilePictureUpload.single("picture"), async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ error: "Choose a JPEG, PNG, GIF, WebP, or AVIF image up to 5 MB." });
    }

    const id = req.file.filename;
    const extension = PROFILE_PICTURE_EXTENSIONS.get(req.file.mimetype);
    const previousPictureId = req.user.avatarFileId;
    const picture = {
      id,
      name: `profile-picture${extension}`,
      size: req.file.size,
      mime: req.file.mimetype,
      ownerId: req.user.id,
      createdAt: new Date().toISOString()
    };

    try {
      await serialize(async () => {
        files.push(picture);
        req.user.avatarFileId = id;
        req.user.avatarUrl = `/api/files/${id}`;
        if (previousPictureId) {
          const previousIndex = files.findIndex((file) => file.id === previousPictureId);
          if (previousIndex !== -1) files.splice(previousIndex, 1);
        }
        await writeJson(path.join(DATA_DIR, "files.json"), files);
        await writeJson(path.join(DATA_DIR, "users.json"), users);
      });

      if (previousPictureId) {
        try {
          await fs.unlink(path.join(UPLOADS_DIR, previousPictureId));
        } catch (error) {
          if (error.code !== "ENOENT") console.error("Could not remove the previous profile picture:", error);
        }
      }
      res.json({ user: publicUser(req.user) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/files/:id", async (req, res, next) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.sendStatus(404);
    const file = files.find((candidate) => candidate.id === req.params.id);
    if (!file) return res.sendStatus(404);
    const filePath = path.join(UPLOADS_DIR, file.id);
    try {
      await fs.access(filePath);
      const extension = path.extname(file.name).toLowerCase();
      const mime = file.mime || MIME_TYPES[extension] || "application/octet-stream";
      res.set("X-Content-Type-Options", "nosniff");
      if (INLINE_TYPES.has(mime)) {
        res.type(mime);
        res.set("Content-Disposition", "inline");
        return res.sendFile(filePath);
      }
      return res.download(filePath, file.name, { headers: { "X-Content-Type-Options": "nosniff" } });
    } catch (error) {
      if (error.code === "ENOENT") return res.sendStatus(404);
      next(error);
    }
  });

  app.use(express.static(PUBLIC_DIR));

  io.use((socket, next) => {
    const user = findUser(socket.handshake.auth && socket.handshake.auth.userId);
    if (!user) return next(new Error("Join the community to connect."));
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    onlineSockets.set(socket.id, user.id);
    socket.emit("chat:history", messages.slice(-300));
    broadcastStats();

    socket.on("chat:send", (payload, acknowledge) => {
      const reply = typeof acknowledge === "function" ? acknowledge : () => {};
      serialize(async () => {
        const text = typeof payload?.text === "string" ? payload.text.trim() : "";
        const attachmentIds = Array.isArray(payload?.attachmentIds) ? payload.attachmentIds.slice(0, MAX_ATTACHMENTS) : [];
        const statusId = typeof payload?.statusId === "string" ? payload.statusId : "";
        const sharedStatus = statusId ? statuses.find((candidate) => candidate.id === statusId) : null;
        if (text.length > 2000) throw new Error("Messages must be 2,000 characters or fewer.");
        if (statusId && !sharedStatus) throw new Error("That status could not be found.");
        if (!text && attachmentIds.length === 0 && !sharedStatus) throw new Error("Write a message or attach a file first.");

        const attachments = attachmentIds.map((id) => {
          const file = files.find((candidate) => candidate.id === id && candidate.ownerId === user.id);
          if (!file) throw new Error("An attachment could not be found. Please attach it again.");
          return publicFile(file);
        });
        const message = {
          id: crypto.randomUUID(),
          userId: user.id,
          username: user.username,
          avatar: user.avatar,
          avatarUrl: user.avatarUrl || null,
          text,
          attachments,
          status: sharedStatus ? publicStatus(sharedStatus) : null,
          sentAt: new Date().toISOString()
        };
        messages.push(message);
        if (messages.length > 500) messages.splice(0, messages.length - 500);
        await writeJson(path.join(DATA_DIR, "messages.json"), messages);
        io.emit("chat:message", message);
        reply({ ok: true, id: message.id });
      }).catch((error) => {
        console.error("Could not send chat message:", error);
        reply({ ok: false, error: error.message || "Message could not be sent." });
      });
    });

    socket.on("disconnect", () => {
      onlineSockets.delete(socket.id);
      broadcastStats();
    });
  });

  app.use((error, _req, res, _next) => {
    console.error("Request failed:", error);
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? error.field === "picture"
          ? "Profile pictures must be 5 MB or smaller."
          : error.field === "video"
            ? "Status videos must be 50 MB or smaller."
            : "Each attachment must be 10 MB or smaller."
        : error.field === "picture"
          ? "Only one profile picture can be uploaded at a time."
          : error.field === "video"
            ? "Only one video can be uploaded per status."
            : "You can attach up to five files per message.";
      return res.status(400).json({ error: message });
    }
    res.status(500).json({ error: "The server could not complete that request." });
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Mellow chat is running at http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Could not start Mellow chat:", error);
  process.exitCode = 1;
});
