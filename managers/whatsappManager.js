const pino = require("pino");
const path = require("path");
const fs = require("fs-extra");
const crypto = require("crypto");
const axios = require("axios");
const whatsapp = require("wa-multi-session");
const qrcode = require("qrcode");
const DatabaseManager = require("./DatabaseManager");
const botConfig = require("../config/botConfig");

class WhatsAppManager {
  constructor() {
    this.clients = new Map();
    this.authBaseDir = path.join(__dirname, "../auth");
    this.db = new DatabaseManager();
    this.logger = pino({
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    });
    this.numberToSessionMap = new Map();

    // Setup wa-multi-session event handlers
    this.setupWhatsAppEvents();
  }

  // ----------------------
  // WhatsApp Event Setup
  // ----------------------
  setupWhatsAppEvents() {
    whatsapp.onConnected((session) => {
      this.logger.info(`Session '${session}' connected`);
      const clientData = this.clients.get(session);
      if (clientData) {
        clientData.isConnected = true;
        clientData.qrData = null;
        clientData.connectedAt = new Date();
        this.updateSessionStatus(session, true);
      }
    });

    whatsapp.onConnecting((session) => {
      this.logger.info(`Session '${session}' connecting`);
      const clientData = this.clients.get(session);
      if (clientData) {
        clientData.isConnected = false;
        this.updateSessionStatus(session, false);
      }
    });

    whatsapp.onDisconnected((session) => {
      this.logger.info(`Session '${session}' disconnected`);
      const clientData = this.clients.get(session);
      if (clientData) {
        clientData.isConnected = false;
        this.updateSessionStatus(session, false);
      }
    });

    whatsapp.onMessageReceived((data) => {
      this.handleIncomingMessage(data);
    });

    // Load existing sessions
    whatsapp.loadSessionsFromStorage();
  }

  // ----------------------
  // Utility Methods
  // ----------------------
  generateSessionId() {
    return crypto.randomBytes(16).toString("hex");
  }

  formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) throw new Error("Phone number is required");

    let cleaned = phoneNumber.replace(/\D/g, "");

    if (cleaned.startsWith("0")) {
      return "62" + cleaned.substring(1);
    } else if (cleaned.startsWith("62")) {
      return cleaned;
    } else if (cleaned.startsWith("+62")) {
      return cleaned.substring(1);
    } else if (cleaned.length >= 9) {
      return "62" + cleaned;
    }

    throw new Error("Invalid phone number format");
  }

  // ----------------------
  // WhatsApp Initialization
  // ----------------------
  async initWhatsApp(
    sessionId,
    numberId,
    isRecovery = false,
    owner = null,
    ownerCompany = null
  ) {
    console.log("DEBUG initWhatsApp owner param:", owner);
    try {
      const authDir = path.join(this.authBaseDir, sessionId);

      if (isRecovery) {
        try {
          // Try to find numberId from database
          const sessionData = await this.db.getSession(sessionId);
          if (sessionData) {
            numberId = sessionData.numberId;
            ownerCompany = sessionData.ownerCompany;
          }

          // If not found in database, try to read from metadata file
          if (!numberId) {
            const metaFile = path.join(authDir, "metadata.json");
            try {
              const metaData = JSON.parse(await fs.readFile(metaFile, "utf-8"));
              numberId = metaData.numberId;
              ownerCompany = metaData.ownerCompany;
            } catch (e) {
              this.logger.warn(`No metadata found for session ${sessionId}`);
            }
          }
        } catch (error) {
          this.logger.warn(
            `Failed to recover numberId for ${sessionId}:`,
            error
          );
        }
      } else {
        await fs.mkdir(authDir, { recursive: true });
      }

      const clientData = {
        sessionId,
        qrData: null,
        isConnected: false,
        numberId,
        isRecovery,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        createdAt: new Date(),
        lastActivity: null,
        connectedAt: null,
        owner: owner || null,
        ownerCompany: ownerCompany || null,
      };
      console.log("DEBUG clientData.owner:", clientData.owner);

      if (isRecovery) {
        const sessionData = await this.db.getSession(sessionId);
        if (sessionData && sessionData.connectedAt) {
          clientData.connectedAt = sessionData.connectedAt;
        }
      }

      this.clients.set(sessionId, clientData);

      if (numberId && !isRecovery) {
        await this.db.saveSession(sessionId, {
          numberId,
          isConnected: false,
          createdAt: new Date(),
          lastActivity: null,
          metadata: { isRecovery: false },
          connectedAt: null,
          owner: owner || null,
          ownerCompany: ownerCompany || null,
        });
      }

      // Start session with wa-multi-session
      const qr = await new Promise(async (resolve) => {
        await whatsapp.startSession(sessionId, {
          onConnected() {
            resolve(null);
          },
          onQRUpdated(qr) {
            resolve(qr);
          },
        });
      });

      if (qr) {
        clientData.qrData = await qrcode.toDataURL(qr);
        this.logger.info(`QR Code generated for ${numberId || sessionId}`);
      }

      return clientData;
    } catch (error) {
      this.logger.error(`Initialization error: ${error.message}`);
      if (isRecovery) {
        this.scheduleReconnect(sessionId, numberId, true);
      }
      throw error;
    }
  }

  // ----------------------
  // Message Handling
  // ----------------------
  async handleIncomingMessage(data) {
    const { sessionId, from, message } = data;
    const clientData = this.clients.get(sessionId);

    if (!clientData) return;

    clientData.lastActivity = new Date();

    // Bot Auto-Reply Logic
    if (!botConfig.bot.enabled) {
      this.logger.info(`🔍 Bot Debug: Bot is disabled in config`);
      return;
    }

    const text = message?.text || message?.conversation || "";

    this.logger.info(`🔍 Bot Debug: Processing message from ${from}`);

    // Skip group messages if configured
    if (botConfig.bot.skipGroupMessages && from.endsWith("@g.us")) {
      this.logger.info(`🔍 Bot Debug: Skipping group message from ${from}`);
      return;
    }

    this.logger.info(`🔍 Bot Debug: Message text: "${text}"`);

    if (
      !text ||
      text.length < botConfig.message.minLength ||
      text.length > botConfig.message.maxLength
    ) {
      this.logger.info(`🔍 Bot Debug: Skipping - invalid text length or empty`);
      return;
    }

    if (botConfig.message.logIncoming) {
      this.logger.info(
        `${botConfig.bot.logPrefix} Pesan dari ${from}: ${text}`
      );
    }

    const lowerText = text.toLowerCase().trim();
    this.logger.info(`🔍 Bot Debug: Processing keyword: "${lowerText}"`);

    // Logika Menu Dinamis ===================================================
    try {
      this.logger.info(
        `🔍 Bot Debug: Making API call to ${botConfig.bot.apiUrl}`
      );

      const response = await axios.get(
        `${botConfig.bot.apiUrl}?key=${encodeURIComponent(lowerText)}`,
        {
          headers: { "User-Agent": botConfig.bot.userAgent },
          timeout: botConfig.bot.timeout,
        }
      );

      this.logger.info(
        `🔍 Bot Debug: API response received: ${response.data.substring(
          0,
          100
        )}...`
      );

      const reply = response.data.trim();

      if (reply && reply !== "") {
        this.logger.info(`🔍 Bot Debug: Sending reply to ${from}`);
        await whatsapp.sendTextMessage({
          sessionId: sessionId,
          to: from,
          text: reply,
          isGroup: from.endsWith("@g.us"),
        });
        this.logger.info(
          `${botConfig.bot.logPrefix} Auto-reply sent to ${from}`
        );
      } else {
        this.logger.info(`🔍 Bot Debug: Empty reply from API, not sending`);
      }
    } catch (error) {
      this.logger.error(
        `${botConfig.bot.logPrefix} Gagal akses menu.php:`,
        error.message
      );
      try {
        this.logger.info(`🔍 Bot Debug: Sending error message to ${from}`);
        await whatsapp.sendTextMessage({
          sessionId: sessionId,
          to: from,
          text: botConfig.bot.errorMessage,
          isGroup: from.endsWith("@g.us"),
        });
      } catch (sendError) {
        this.logger.error(
          `${botConfig.bot.logPrefix} Gagal kirim error message:`,
          sendError.message
        );
      }
    }
    // ========================================================================
  }

  // ----------------------
  // Session Management
  // ----------------------
  async updateSessionStatus(sessionId, isConnected) {
    const clientData = this.clients.get(sessionId);
    if (!clientData) return;

    clientData.isConnected = isConnected;
    if (isConnected && !clientData.connectedAt) {
      clientData.connectedAt = new Date();
    }

    await this.db.saveSession(sessionId, {
      numberId: clientData.numberId,
      isConnected,
      createdAt: clientData.createdAt,
      lastActivity: new Date(),
      metadata: { isRecovery: clientData.isRecovery },
      connectedAt: clientData.connectedAt,
      owner: clientData.owner,
    });
  }

  async recoverSessions() {
    try {
      const sessions = await this.db.getAllSessions();

      for (const session of sessions) {
        try {
          this.logger.info(
            `Attempting to recover session: ${session.sessionId}`
          );
          await this.initWhatsApp(
            session.sessionId,
            session.numberId,
            true,
            session.owner || null
          );
        } catch (error) {
          this.logger.error(
            `Error recovering session ${session.sessionId}:`,
            error
          );
        }
      }
    } catch (error) {
      this.logger.error(`Session recovery error: ${error.message}`);
    }
  }

  async deleteAuthFiles(sessionId) {
    const authDir = path.join(this.authBaseDir, sessionId);
    try {
      if (!(await fs.pathExists(authDir))) {
        this.logger.warn(
          `Auth directory does not exist for session ${sessionId}`
        );
        return true;
      }

      await fs.remove(authDir);
      this.logger.info(`Auth directory deleted for session ${sessionId}`);
      return true;
    } catch (err) {
      this.logger.error(
        `Error deleting auth directory for session ${sessionId}:`,
        err
      );
      return false;
    }
  }

  async logout(sessionId) {
    const clientData = this.clients.get(sessionId);
    if (!clientData) return false;

    try {
      await whatsapp.deleteSession(sessionId);

      const now = new Date();
      await this.db.saveSession(sessionId, {
        numberId: clientData.numberId,
        isConnected: false,
        createdAt: clientData.createdAt,
        lastActivity: now,
        metadata: {
          isDisconnected: true,
          lastDisconnect: now.toISOString(),
        },
        connectedAt: now,
        owner: clientData.owner,
      });

      this.clients.set(sessionId, {
        ...clientData,
        isConnected: false,
        qrData: null,
        lastActivity: now,
        connectedAt: now,
      });

      return true;
    } catch (error) {
      this.logger.error(`Logout error for ${sessionId}:`, error);
      return false;
    }
  }

  // ----------------------
  // Session Accessors
  // ----------------------
  getSessionByNumber(numberId) {
    const sessionId = this.numberToSessionMap.get(numberId);
    return sessionId ? this.clients.get(sessionId) : null;
  }

  getSessionById(sessionId) {
    return this.clients.get(sessionId);
  }

  getSessionStatus(sessionId) {
    const clientData = this.clients.get(sessionId);
    if (!clientData) {
      this.logger.warn(`No client data found for session ${sessionId}`);
      return null;
    }

    const status = {
      isConnected: clientData.isConnected,
      qrReady: !!clientData.qrData,
      numberId: clientData.numberId,
      lastActivity: clientData.lastActivity,
      reconnectAttempts: clientData.reconnectAttempts,
      maxReconnectAttempts: clientData.maxReconnectAttempts,
      connectedAt: clientData.connectedAt || null,
    };

    this.logger.debug(`Session status for ${sessionId}:`, status);
    return status;
  }

  async deleteSession(sessionId) {
    await this.db.deleteSession(sessionId);
    await this.deleteAuthFiles(sessionId);
    this.clients.delete(sessionId);
    this.logger.info(
      `Session ${sessionId} deleted from db, auth files, and memory.`
    );
  }

  // ----------------------
  // Message Sending Methods
  // ----------------------
  async sendMessage(sessionId, to, text, isGroup = false) {
    const clientData = this.clients.get(sessionId);
    if (!clientData) {
      throw new Error("Session not found");
    }

    if (!clientData.isConnected) {
      throw new Error("WhatsApp not connected");
    }

    const response = await whatsapp.sendTextMessage({
      sessionId: sessionId,
      to: to,
      text: text,
      isGroup: isGroup,
    });

    return response;
  }

  async sendGroupMessage(sessionId, groupId, message) {
    const jid = groupId.endsWith("@g.us") ? groupId : `${groupId}@g.us`;
    return await this.sendMessage(sessionId, jid, message, true);
  }
}

module.exports = WhatsAppManager;
