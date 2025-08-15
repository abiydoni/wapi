const express = require("express");
const router = express.Router();

module.exports = (whatsappManager) => {
  router.get("/", (req, res) => {
    console.log("🔍 Rendering index page");
    res.render("index", {
      user: { username: "admin", role: "admin", company: "WhatsApp API" },
    });
  });

  router.get("/login", (req, res) => {
    // Langsung redirect ke dashboard tanpa login
    res.redirect("/");
  });

  router.get("/qr", async (req, res) => {
    try {
      const { sessionId, numberId } = req.query;
      console.log("🔍 QR Route - sessionId:", sessionId, "numberId:", numberId);

      if (!sessionId && !numberId) {
        return res.status(400).send("Session ID or Number ID is required");
      }

      if (sessionId) {
        console.log("🔍 Looking for session:", sessionId);
        const clientData = whatsappManager.getSessionById(sessionId);
        console.log("🔍 Client data found:", !!clientData);

        if (!clientData) {
          console.log(
            "🔍 Session not found, checking if numberId exists:",
            numberId
          );
          // If session not found but numberId exists, try to find by numberId
          if (numberId && whatsappManager.numberToSessionMap.has(numberId)) {
            const existingSessionId =
              whatsappManager.numberToSessionMap.get(numberId);
            console.log(
              "🔍 Found existing session for numberId:",
              existingSessionId
            );
            return res.redirect(
              `/qr?sessionId=${existingSessionId}&numberId=${numberId}`
            );
          }
          return res.status(404).send("Session not found");
        }

        if (clientData.isConnected) {
          const baseUrl = "https://" + req.get("host");
          return res.render("connected", {
            baseUrl,
            qrData: null,
            sessionId,
            numberId: clientData.numberId,
            isConnected: true,
            user: { username: "admin", role: "admin", company: "WhatsApp API" },
          });
        }

        if (!clientData.qrData) {
          return res.send(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Loading QR</title>
                <style>
                  body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                  .loader {
                    border: 5px solid #f3f3f3;
                    border-top: 5px solid #25D366;
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                    margin: 20px auto;
                  }
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                </style>
              </head>
              <body>
                <h2>Preparing QR Code...</h2>
                <div class="loader"></div>
                <script>setTimeout(() => location.reload(), 2000)</script>
              </body>
            </html>
          `);
        }

        return res.render("qr", {
          qrData: clientData.qrData,
          sessionId,
          numberId: clientData.numberId,
          isConnected: false,
          user: { username: "admin", role: "admin", company: "WhatsApp API" },
        });
      }

      if (numberId) {
        console.log("🔍 Processing numberId:", numberId);
        if (whatsappManager.numberToSessionMap.has(numberId)) {
          const existingSessionId =
            whatsappManager.numberToSessionMap.get(numberId);
          const existingSession =
            whatsappManager.clients.get(existingSessionId);
          console.log("🔍 Found existing session:", existingSessionId);
          if (existingSession) {
            return res.redirect(
              `/qr?sessionId=${existingSessionId}&numberId=${numberId}`
            );
          }
        }
        console.log("🔍 Creating new session for numberId:", numberId);
        const newSessionId = whatsappManager.generateSessionId();
        await whatsappManager.initWhatsApp(
          newSessionId,
          numberId,
          false,
          "admin",
          "WhatsApp API"
        );
        return res.redirect(
          `/qr?sessionId=${newSessionId}&numberId=${numberId}`
        );
      }
    } catch (error) {
      whatsappManager.logger.error("QR endpoint error:", error);
      res.status(500).send("Internal server error");
    }
  });

  return router;
};
