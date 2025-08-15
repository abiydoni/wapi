const express = require("express");
const router = express.Router();

module.exports = (whatsappManager, validateSession) => {
  router.get("/groups", validateSession, async (req, res) => {
    try {
      const { sessionId } = req;
      const clientData = whatsappManager.getSessionById(sessionId);
      if (!clientData.isConnected)
        return res.status(503).json({ message: "WhatsApp belum terhubung" });

      // Untuk sementara, return empty array karena wa-multi-session belum support getGroups
      // TODO: Implement getGroups functionality when wa-multi-session supports it
      const groupList = [];

      res.json({ status: "success", groups: groupList });
    } catch (error) {
      whatsappManager.logger.error("Fetch group error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  router.get("/groups-view", (req, res) => {
    res.sendFile(require("path").join(__dirname, "../public/groups.html"));
  });

  return router;
};
