const express = require("express");
const http = require("http");
require("dotenv").config();
const socketIo = require("socket.io");
const cors = require("cors");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const messageRoutes = require("./routes/messageRoutes");
const Message = require("./models/Message");
const User = require("./models/User");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
console.log(JWT_SECRET);

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: "http://localhost:5173", // Only allow this origin
  methods: ["GET", "POST"], // Allowed HTTP methods
  credentials: true, // Include credentials (cookies, etc.)
};

app.use(cors(corsOptions)); // Apply CORS middleware for all routes
app.use(express.json());

// Connect to MongoDB
connectDB();

// Routes
app.use("/api/auth", authRoutes);
app.use("/api", messageRoutes);

// Online users tracking
const onlineUsers = new Set();

// Socket.IO Connection
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173", // Allow only this origin
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (error) {
    next(new Error("Authentication error: " + error.message));
  }
});

io.on("connection", (socket) => {
  // Add user to online users
  onlineUsers.add(socket.userId);

  // Update online status for all clients
  io.emit("update_online_status", Array.from(onlineUsers));

  // Join room
  socket.on("join_room", ({ room }) => {
    socket.join(room);
  });

  // Send message
  socket.on("send_message", async (data) => {
    try {
      // Create and save message to database
      const message = new Message({
        sender: data.sender,
        receiver: data.receiver,
        message: data.message,
        room: [data.sender, data.receiver].sort().join("_"),
      });
      await message.save();

      // Broadcast to room
      io.to([data.sender, data.receiver].sort().join("_")).emit(
        "receive_message",
        {
          sender: data.sender,
          message: data.message,
          receiver: data.receiver,
        }
      );
    } catch (error) {
      console.error("Message save error:", error);
    }
  });

  // Typing events
  socket.on("typing", ({ room, userId }) => {
    socket.to(room).emit("user_typing", { userId });
  });

  // Fetch message history
  socket.on("fetch_message_history", async (data, callback) => {
    try {
      // Create a room identifier (sorted to ensure consistency)
      const room = [data.userId, data.selectedUser].sort().join("_");

      // Fetch last 50 messages for this room, sorted by timestamp
      const messages = await Message.find({
        room: room,
      })
        .sort({ createdAt: 1 }) // Sort in ascending order (oldest first)
        .limit(50) // Limit to last 50 messages
        .lean(); // Convert to plain JavaScript objects

      // Callback with messages
      callback({
        success: true,
        messages: messages.map((msg) => ({
          id: msg._id,
          sender: msg.sender,
          receiver: msg.receiver,
          message: msg.message,
          timestamp: msg.createdAt,
        })),
      });
    } catch (error) {
      console.error("Message history fetch error:", error);
      callback({
        success: false,
        error: "Failed to fetch message history",
      });
    }
  });

  socket.on("stop_typing", ({ room, userId }) => {
    socket.to(room).emit("user_stopped_typing", { userId });
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    onlineUsers.delete(socket.userId);
    io.emit("update_online_status", Array.from(onlineUsers));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
