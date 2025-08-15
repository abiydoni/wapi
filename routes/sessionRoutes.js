const express = require("express");
const router = express.Router();

module.exports = (whatsappManager, validateSession) => {
  router.get("/status", validateSession, (req, res) => {
    const { sessionId } = req;
    const clientData = whatsappManager.getSessionById(sessionId);

    if (!clientData) {
      return res
        .status(404)
        .json({ status: "error", message: "Session not found" });
    }

    // Set headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

    // Send initial status
    const status = whatsappManager.getSessionStatus(sessionId);
    res.write(`data: ${JSON.stringify(status)}\n\n`);

    // Store client for updates
    const clientId = Date.now();
    if (!clientData.clients) clientData.clients = [];
    clientData.clients.push({ id: clientId, res });

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": heartbeat\n\n");
      }
    }, 30000);

    // Send status updates when connection changes
    const sendStatusUpdate = (newStatus) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(newStatus)}\n\n`);
      }
    };

    // Remove client on disconnect
    req.on("close", () => {
      clearInterval(heartbeatInterval);
      if (clientData.clients) {
        clientData.clients = clientData.clients.filter(
          (c) => c.id !== clientId
        );
      }
    });
  });

  router.get("/sessions", async (req, res) => {
    try {
      let sessions = Array.from(whatsappManager.clients.entries()).map(
        ([sessionId, data]) => ({
          sessionId,
          numberId: data.numberId,
          isConnected: data.isConnected,
          isRecovery: data.isRecovery,
          reconnectAttempts: data.reconnectAttempts,
          createdAt: data.createdAt,
          lastActivity: data.lastActivity,
          connectedAt: data.connectedAt || null,
          owner: data.owner || null,
          ownerCompany: data.ownerCompany || null,
        })
      );
      res.json({
        status: "success",
        count: sessions.length,
        sessions,
      });
    } catch (error) {
      whatsappManager.logger.error("Failed to get sessions:", error);
      res.status(500).json({
        status: "error",
        message: error.message,
      });
    }
  });

  router.post(
    "/sessions",
    (req, res, next) => {
      next();
    },
    async (req, res) => {
      try {
        console.log("🔍 POST /sessions called");
        console.log("🔍 Request body:", req.body);

        const { numberId } = req.body;
        if (!numberId) {
          return res.status(400).json({
            status: "error",
            message: "Number ID is required",
          });
        }
        if (!/^\d+$/.test(numberId)) {
          return res.status(400).json({
            status: "error",
            message: "Number ID must be numeric.",
          });
        }

        console.log("🔍 NumberId validated:", numberId);

        if (whatsappManager.numberToSessionMap.has(numberId)) {
          const existingSessionId =
            whatsappManager.numberToSessionMap.get(numberId);
          const existingSession =
            whatsappManager.clients.get(existingSessionId);

          if (existingSession) {
            console.log("🔍 Existing session found, redirecting");
            return res.redirect(
              `/qr?sessionId=${existingSessionId}&numberId=${numberId}`
            );
          } else {
            whatsappManager.numberToSessionMap.delete(numberId);
          }
        }

        console.log("🔍 Generating new session");
        const sessionId = whatsappManager.generateSessionId();
        console.log("🔍 SessionId generated:", sessionId);

        console.log("🔍 Calling initWhatsApp");
        await whatsappManager.initWhatsApp(
          sessionId,
          numberId,
          false,
          "admin",
          "WhatsApp API"
        );
        console.log("🔍 initWhatsApp completed");

        console.log("🔍 Redirecting to QR page");
        return res.redirect(`/qr?sessionId=${sessionId}&numberId=${numberId}`);
      } catch (error) {
        console.log("❌ Create session error:", error);
        console.log("❌ Error stack:", error.stack);
        whatsappManager.logger.error("Create session error:", error);
        res.status(500).json({
          status: "error",
          message: error.message,
        });
      }
    }
  );

  router.delete("/sessions/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    try {
      // Ambil data session sebelum dihapus
      const session = whatsappManager.clients.get(sessionId);
      const numberId = session ? session.numberId : null;

      await whatsappManager.deleteSession(sessionId);

      res.json({
        status: "success",
        message: numberId ? `${numberId} deleted!` : `Session deleted`,
      });
    } catch (error) {
      whatsappManager.logger.error("Delete session error:", error);
      res.status(500).json({
        status: "error",
        message: error.message,
      });
    }
  });

  return router;
};
