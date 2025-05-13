const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

class DatabaseManager {
    constructor() {
        // Pastikan folder data ada
        const dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        const dbPath = path.join(dataDir, 'sessions.db');
        this.db = new Database(dbPath);
        this.initDatabase();
    }
    
    initDatabase() {
        // Create sessions table
        this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            number_id TEXT,
            is_connected INTEGER,
            created_at TEXT,
            last_activity TEXT,
            auth_data TEXT,
            metadata TEXT,
            connected_at TEXT,
            owner TEXT,
            owner_company TEXT
        );
    
        CREATE INDEX IF NOT EXISTS idx_number_id ON sessions(number_id);
        CREATE INDEX IF NOT EXISTS idx_is_connected ON sessions(is_connected);
        
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            company TEXT,
            role TEXT DEFAULT 'user'
        );
        `);
        // Create default admin if not exists
        const userCount = this.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        if (userCount === 0) {
            const passwordHash = bcrypt.hashSync('admin', 12);
            this.db.prepare('INSERT INTO users (username, password_hash, role, company) VALUES (?, ?, ?, ?)')
                .run('admin', passwordHash, 'admin', 'WhatsApp API');
        }
    }
    
    async saveSession(sessionId, data) {
        const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO sessions 
        (session_id, number_id, is_connected, created_at, last_activity, auth_data, metadata, connected_at, owner, owner_company)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
    
        stmt.run(
        sessionId,
        data.numberId,
        data.isConnected ? 1 : 0,
        data.createdAt.toISOString(),
        data.lastActivity ? data.lastActivity.toISOString() : null,
        JSON.stringify(data.authData || {}),
        JSON.stringify(data.metadata || {}),
        data.connectedAt ? data.connectedAt.toISOString() : null,
        data.owner || null,
        data.ownerCompany || null
        );
    }
    
    async getSessionByNumber(numberId) {
        const stmt = this.db.prepare(`
        SELECT * FROM sessions
        WHERE number_id = ?
        `);
        
        const row = stmt.get(numberId);
        if (!row) return null;
    
        return {
        sessionId: row.session_id,
        numberId: row.number_id,
        isConnected: row.is_connected === 1,
        createdAt: new Date(row.created_at),
        lastActivity: row.last_activity ? new Date(row.last_activity) : null,
        authData: JSON.parse(row.auth_data),
        metadata: JSON.parse(row.metadata),
        connectedAt: row.connected_at ? new Date(row.connected_at) : null
        };
    }
    
    async getSession(sessionId) {
        const stmt = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?');
        const row = stmt.get(sessionId);
        
        if (!row) return null;
    
        return {
        sessionId: row.session_id,
        numberId: row.number_id,
        isConnected: row.is_connected === 1,
        createdAt: new Date(row.created_at),
        lastActivity: row.last_activity ? new Date(row.last_activity) : null,
        authData: JSON.parse(row.auth_data),
        metadata: JSON.parse(row.metadata),
        connectedAt: row.connected_at ? new Date(row.connected_at) : null,
        owner: row.owner || null,
        ownerCompany: row.owner_company || null
        };
    }
    
    async getAllSessions() {
        const stmt = this.db.prepare('SELECT * FROM sessions');
        const rows = stmt.all();
        
        return rows.map(row => ({
        sessionId: row.session_id,
        numberId: row.number_id,
        isConnected: row.is_connected === 1,
        createdAt: new Date(row.created_at),
        lastActivity: row.last_activity ? new Date(row.last_activity) : null,
        authData: JSON.parse(row.auth_data),
        metadata: JSON.parse(row.metadata),
        connectedAt: row.connected_at ? new Date(row.connected_at) : null,
        owner: row.owner || null,
        ownerCompany: row.owner_company || null
        }));
    }
    
    async deleteSession(sessionId) {
        const stmt = this.db.prepare('DELETE FROM sessions WHERE session_id = ?');
        stmt.run(sessionId);
    }

    async createUser(username, passwordHash, role = 'user', company = null) {
        const stmt = this.db.prepare('INSERT INTO users (username, password_hash, role, company) VALUES (?, ?, ?, ?)');
        stmt.run(username, passwordHash, role, company);
    }

    async getUserByUsername(username) {
        const stmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
        const row = stmt.get(username);
        return row ? { 
            id: row.id, 
            username: row.username, 
            passwordHash: row.password_hash, 
            role: row.role,
            company: row.company 
        } : null;
    }

    async getAllUsers() {
        const stmt = this.db.prepare('SELECT * FROM users');
        return stmt.all().map(row => ({ 
            id: row.id, 
            username: row.username, 
            passwordHash: row.password_hash, 
            role: row.role,
            company: row.company 
        }));
    }

    async updateUserPassword(username, newPasswordHash) {
        const stmt = this.db.prepare('UPDATE users SET password_hash = ? WHERE username = ?');
        stmt.run(newPasswordHash, username);
    }

    async deleteUser(username) {
        const stmt = this.db.prepare('DELETE FROM users WHERE username = ?');
        stmt.run(username);
    }
}

module.exports = DatabaseManager;