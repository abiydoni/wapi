module.exports = (whatsappManager) => (req, res, next) => {
  console.log("🔍 validateSession middleware called");
  console.log("🔍 Method:", req.method);
  console.log("🔍 URL:", req.url);
  console.log("🔍 Headers:", JSON.stringify(req.headers, null, 2));
  console.log("🔍 Query:", JSON.stringify(req.query, null, 2));
  console.log("🔍 Body:", JSON.stringify(req.body, null, 2));

  const sessionId = req.headers["x-session-id"] || req.query.sessionId;
  console.log("🔍 Extracted sessionId:", sessionId);

  if (!sessionId) {
    console.log("❌ No sessionId found");
    return res
      .status(400)
      .json({ status: "error", message: "Session ID is required" });
  }

  if (sessionId === "undefined") {
    console.log("❌ SessionId is 'undefined' string");
    return res
      .status(400)
      .json({ status: "error", message: "Invalid Session ID" });
  }

  const session = whatsappManager.getSessionById(sessionId);
  console.log("🔍 Session found:", !!session);
  console.log("🔍 Session data:", session ? "exists" : "not found");

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
