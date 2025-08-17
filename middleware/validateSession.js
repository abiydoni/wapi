module.exports = (whatsappManager) => (req, res, next) => {
  console.log("🔍 validateSession middleware called");
  console.log("🔍 Headers:", req.headers);
  console.log("🔍 Query:", req.query);

  const sessionId = req.headers["x-session-id"] || req.query.sessionId;
  console.log("🔍 Extracted sessionId:", sessionId);

  if (!sessionId) {
    console.log("❌ No sessionId found");
    return res
      .status(400)
      .json({ status: "error", message: "Session ID is required" });
  }

  const session = whatsappManager.getSessionById(sessionId);
  console.log("🔍 Session found:", !!session);

  if (!session) {
    console.log("❌ Session not found");
    return res
      .status(404)
      .json({ status: "error", message: "Session not found" });
  }

  req.sessionId = sessionId;
  console.log("✅ SessionId set to req.sessionId:", req.sessionId);
  next();
};
