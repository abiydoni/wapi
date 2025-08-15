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
    whatsapp.onConnected(async (session) => {
      this.logger.info(`Session '${session}' connected`);
      const clientData = this.clients.get(session);
      if (clientData) {
        clientData.isConnected = true;
        clientData.qrData = null;
        clientData.connectedAt = new Date();
        await this.updateSessionStatus(session, true);

        // Update numberToSessionMap
        if (clientData.numberId) {
          this.numberToSessionMap.set(clientData.numberId, session);
        }

        this.logger.info(`✅ Session ${session} fully connected and saved`);
      } else {
        // If no client data found, try to recover from database
        this.logger.warn(
          `No client data found for connected session ${session}, attempting recovery`
        );
        try {
          const sessionData = await this.db.getSession(session);
          if (sessionData) {
            const recoveredClientData = {
              sessionId: session,
              qrData: null,
              isConnected: true,
              numberId: sessionData.numberId,
              isRecovery: false,
              reconnectAttempts: 0,
              maxReconnectAttempts: 5,
              createdAt: sessionData.createdAt || new Date(),
              lastActivity: new Date(),
              connectedAt: new Date(),
              owner: sessionData.owner || null,
              ownerCompany: sessionData.ownerCompany || null,
            };

            this.clients.set(session, recoveredClientData);
            if (sessionData.numberId) {
              this.numberToSessionMap.set(sessionData.numberId, session);
            }

            await this.updateSessionStatus(session, true);
            this.logger.info(`✅ Session ${session} recovered and connected`);
          }
        } catch (error) {
          this.logger.error(`Failed to recover session ${session}:`, error);
        }
      }
    });

    // Add QR code update handler
    whatsapp.onQRUpdated(async (session, qr) => {
      this.logger.info(`QR Code updated for session ${session}`);
      const clientData = this.clients.get(session);
      if (clientData) {
        try {
          clientData.qrData = await qrcode.toDataURL(qr);
          this.logger.info(`QR Code generated for session ${session}`);
        } catch (error) {
          this.logger.error(
            `Failed to generate QR code for session ${session}:`,
            error
          );
        }
      }
    });

    whatsapp.onConnecting(async (session) => {
      this.logger.info(`Session '${session}' connecting`);
      const clientData = this.clients.get(session);
      if (clientData) {
        clientData.isConnected = false;
        await this.updateSessionStatus(session, false);
      }
    });

    whatsapp.onDisconnected(async (session) => {
      this.logger.info(`Session '${session}' disconnected`);
      const clientData = this.clients.get(session);
      if (clientData) {
        clientData.isConnected = false;
        await this.updateSessionStatus(session, false);

        // Remove from numberToSessionMap
        if (clientData.numberId) {
          this.numberToSessionMap.delete(clientData.numberId);
        }
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

      // Always save session to database, regardless of recovery status
      if (numberId) {
        try {
          await this.db.saveSession(sessionId, {
            numberId,
            isConnected: false,
            createdAt: new Date(),
            lastActivity: null,
            metadata: { isRecovery: isRecovery },
            connectedAt: null,
            owner: owner || null,
            ownerCompany: ownerCompany || null,
          });
          this.logger.info(
            `✅ Session ${sessionId} saved to database successfully`
          );
        } catch (error) {
          this.logger.error(
            `❌ Failed to save session ${sessionId} to database:`,
            error
          );
        }
      } else {
        this.logger.warn(
          `⚠️ No numberId provided for session ${sessionId}, skipping database save`
        );
      }

      // Start session with wa-multi-session
      const self = this; // Store reference to this
      let qrResolved = false;

      const qr = await new Promise(async (resolve) => {
        await whatsapp.startSession(sessionId, {
          onConnected() {
            self.logger.info(`Session ${sessionId} connected in initWhatsApp`);
            if (!qrResolved) {
              qrResolved = true;
              resolve(null);
            }
          },
          onQRUpdated(qr) {
            self.logger.info(`QR Code updated for session ${sessionId}`);
            if (!qrResolved) {
              qrResolved = true;
              resolve(qr);
            }
          },
        });

        // Timeout after 30 seconds if no QR or connection
        setTimeout(() => {
          if (!qrResolved) {
            qrResolved = true;
            self.logger.warn(
              `Session ${sessionId} timeout - no QR or connection`
            );
            resolve(null);
          }
        }, 30000);
      });

      if (qr) {
        clientData.qrData = await qrcode.toDataURL(qr);
        this.logger.info(`QR Code generated for ${numberId || sessionId}`);
      } else {
        // Check if session is actually connected
        const sessionExists = whatsapp.getSession(sessionId);
        if (sessionExists) {
          this.logger.info(`Session ${sessionId} is connected`);
          clientData.isConnected = true;
          clientData.connectedAt = new Date();

          // Update numberToSessionMap
          if (numberId) {
            this.numberToSessionMap.set(numberId, sessionId);
          }

          // Save session to database
          await this.db.saveSession(sessionId, {
            numberId,
            isConnected: true,
            createdAt: new Date(),
            lastActivity: new Date(),
            metadata: { isRecovery: isRecovery },
            connectedAt: new Date(),
            owner: owner || null,
            ownerCompany: ownerCompany || null,
          });
        } else {
          this.logger.warn(
            `Session ${sessionId} not connected and no QR generated`
          );
        }
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
    if (!clientData) {
      this.logger.warn(
        `⚠️ No client data found for session ${sessionId} in updateSessionStatus`
      );
      return;
    }

    clientData.isConnected = isConnected;
    if (isConnected && !clientData.connectedAt) {
      clientData.connectedAt = new Date();
    }

    try {
      await this.db.saveSession(sessionId, {
        numberId: clientData.numberId,
        isConnected,
        createdAt: clientData.createdAt,
        lastActivity: new Date(),
        metadata: { isRecovery: clientData.isRecovery },
        connectedAt: clientData.connectedAt,
        owner: clientData.owner,
        ownerCompany: clientData.ownerCompany,
      });
      this.logger.info(
        `✅ Session ${sessionId} status updated in database: connected=${isConnected}`
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to update session ${sessionId} status in database:`,
        error
      );
    }
  }

  async recoverSessions() {
    try {
      const sessions = await this.db.getAllSessions();
      this.logger.info(`Found ${sessions.length} sessions to recover`);

      if (sessions.length === 0) {
        this.logger.info(
          "No sessions found in database, checking wa-multi-session storage..."
        );
        // Check if there are any sessions in wa-multi-session storage that aren't in database
        const whatsapp = require("wa-multi-session");
        const allSessions = whatsapp.getAllSessions
          ? whatsapp.getAllSessions()
          : [];
        this.logger.info(
          `Found ${allSessions.length} sessions in wa-multi-session storage`
        );
      }

      for (const session of sessions) {
        try {
          this.logger.info(
            `Attempting to recover session: ${session.sessionId} (${session.numberId})`
          );

          // Check if session already exists in memory
          if (this.clients.has(session.sessionId)) {
            this.logger.info(
              `Session ${session.sessionId} already in memory, skipping`
            );
            continue;
          }

          // Check if session exists in wa-multi-session storage
          const whatsapp = require("wa-multi-session");
          const existingSession = whatsapp.getSession(session.sessionId);

          if (existingSession) {
            this.logger.info(
              `Session ${session.sessionId} exists in wa-multi-session, creating client data`
            );

            // Create client data for existing session
            const clientData = {
              sessionId: session.sessionId,
              qrData: null,
              isConnected: true, // Assume connected if session exists
              numberId: session.numberId,
              isRecovery: true,
              reconnectAttempts: 0,
              maxReconnectAttempts: 5,
              createdAt: session.createdAt || new Date(),
              lastActivity: new Date(),
              connectedAt: session.connectedAt || new Date(),
              owner: session.owner || null,
              ownerCompany: session.ownerCompany || null,
            };

            this.clients.set(session.sessionId, clientData);

            // Update numberToSessionMap
            if (session.numberId) {
              this.numberToSessionMap.set(session.numberId, session.sessionId);
            }

            // Update session in database to mark as connected
            await this.db.saveSession(session.sessionId, {
              numberId: session.numberId,
              isConnected: true,
              createdAt: session.createdAt || new Date(),
              lastActivity: new Date(),
              metadata: { isRecovery: true },
              connectedAt: session.connectedAt || new Date(),
              owner: session.owner || null,
              ownerCompany: session.ownerCompany || null,
            });

            this.logger.info(
              `✅ Session ${session.sessionId} recovered from wa-multi-session storage`
            );
          } else {
            // Try to initialize new session
            await this.initWhatsApp(
              session.sessionId,
              session.numberId,
              true,
              session.owner || null,
              session.ownerCompany || null
            );

            // Update numberToSessionMap
            if (session.numberId) {
              this.numberToSessionMap.set(session.numberId, session.sessionId);
            }

            this.logger.info(
              `✅ Session ${session.sessionId} initialized successfully`
            );
          }
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

    // Check if session is actually connected in wa-multi-session
    const whatsapp = require("wa-multi-session");
    const sessionExists = whatsapp.getSession(sessionId);

    // Determine actual connection status
    let isConnected = false;
    if (sessionExists) {
      // If session exists in wa-multi-session, it's likely connected
      isConnected = true;
      // Update client data if it was marked as disconnected
      if (!clientData.isConnected) {
        clientData.isConnected = true;
        clientData.connectedAt = clientData.connectedAt || new Date();
        this.logger.info(`Session ${sessionId} status updated to connected`);
      }
    } else {
      // If session doesn't exist in wa-multi-session, it's disconnected
      isConnected = false;
      if (clientData.isConnected) {
        clientData.isConnected = false;
        this.logger.info(`Session ${sessionId} status updated to disconnected`);
      }
    }

    const status = {
      isConnected: isConnected,
      qrReady: !!clientData.qrData,
      numberId: clientData.numberId,
      lastActivity: clientData.lastActivity,
      reconnectAttempts: clientData.reconnectAttempts,
      maxReconnectAttempts: clientData.maxReconnectAttempts,
      connectedAt: clientData.connectedAt || null,
      sessionExists: !!sessionExists,
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
