import { Server } from "socket.io";

/** @type {import('socket.io').Server | null} */
let io = null;

const clientOrigins = [
  process.env.CLIENT_URL || "http://localhost:8080",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5173",
].filter(Boolean);

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        // Allow non-browser / same-origin and known client URLs
        if (!origin || clientOrigins.includes(origin)) return cb(null, true);
        return cb(null, true); // FYP: allow all localhost variants
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected ${socket.id}`);

    socket.on("live:join", (payload = {}) => {
      const sessionId = payload.sessionId ? String(payload.sessionId) : "";
      if (sessionId) {
        socket.join(`live:${sessionId}`);
        if (payload.role === "host") {
          socket.join(`live:${sessionId}:host`);
          console.log(`[socket] ${socket.id} joined host room live:${sessionId}:host`);
        }
      }

      if (payload.instructorId) {
        socket.join(`instructor:${payload.instructorId}`);
      }

      if (payload.courseId) {
        socket.join(`course:${String(payload.courseId)}`);
      }

      if (payload.requestId) {
        socket.join(`live:request:${String(payload.requestId)}`);
      }
    });

    socket.on("live:leave", (payload = {}) => {
      const sessionId = payload.sessionId ? String(payload.sessionId) : "";
      if (sessionId) {
        socket.leave(`live:${sessionId}`);
        socket.leave(`live:${sessionId}:host`);
      }
      if (payload.requestId) {
        socket.leave(`live:request:${String(payload.requestId)}`);
      }
    });

    socket.on("disconnect", () => {
      console.log(`[socket] disconnected ${socket.id}`);
    });
  });

  console.log("Socket.IO: ready");
  return io;
}

export function getIO() {
  return io;
}

function mapJoinRequest(r) {
  return {
    id: String(r._id),
    name: r.name,
    email: r.email || "",
    audience: r.audience,
    status: r.status,
    userId: r.user?._id || r.user || null,
    guestId: r.guestId || "",
    requestedAt: r.requestedAt,
    respondedAt: r.respondedAt || null,
  };
}

/** Notify instructor instantly when someone requests to join */
export function emitJoinRequestCreated(sessionId, request, instructorId) {
  if (!io) {
    console.warn("[socket] emitJoinRequestCreated: io not ready");
    return;
  }
  const data = {
    ...mapJoinRequest(request),
    sessionId: String(sessionId),
  };
  const sid = String(sessionId);
  io.to(`live:${sid}:host`).emit("live:join-request", data);
  io.to(`live:${sid}`).emit("live:join-request", data);
  if (instructorId) {
    io.to(`instructor:${String(instructorId)}`).emit("live:join-request", data);
  }
  // Fallback: broadcast to everyone (FYP reliability)
  io.emit("live:join-request", data);
  console.log(`[socket] emitted live:join-request for session ${sid}`, data.name);
}

/** Notify waiting student when instructor accepts/rejects */
export function emitJoinRequestUpdated(sessionId, request, instructorId) {
  if (!io) {
    console.warn("[socket] emitJoinRequestUpdated: io not ready");
    return;
  }
  const data = {
    ...mapJoinRequest(request),
    sessionId: String(sessionId),
  };
  const sid = String(sessionId);
  io.to(`live:${sid}:host`).emit("live:join-request-updated", data);
  io.to(`live:${sid}`).emit("live:join-request-updated", data);
  io.to(`live:request:${data.id}`).emit("live:join-request-updated", data);
  if (instructorId) {
    io.to(`instructor:${String(instructorId)}`).emit("live:join-request-updated", data);
  }
  io.emit("live:join-request-updated", data);
  console.log(`[socket] emitted live:join-request-updated`, data.id, data.status);
}

/** Notify enrolled students that a live class started / was scheduled */
export function emitLiveStarted(courseId, sessionPayload) {
  if (!io) return;
  const data = { ...sessionPayload, courseId: String(courseId) };
  io.to(`course:${String(courseId)}`).emit("live:started", data);
  io.emit("live:started", data);
  console.log(`[socket] emitted live:started for course ${courseId}`);
}
