const Message = require("../models/Message");
const User = require("../models/User");

exports.getChatHistory = async (req, res) => {
  try {
    const { room } = req.params;

    const messages = await Message.find({ room })
      .sort({ createdAt: 1 })
      .limit(50); // Limit to last 50 messages

    res.json({ messages });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
