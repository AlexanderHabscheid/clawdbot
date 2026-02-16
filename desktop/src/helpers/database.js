const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app } = require("electron");
// Handle ES module interop - logger might be exported as { default: Logger }
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;

class DatabaseManager {
  constructor() {
    this.db = null;
    this.initDatabase();
  }

  initDatabase() {
    try {
      const dbFileName =
        process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db";

      const dbPath = path.join(app.getPath("userData"), dbFileName);

      this.db = new Database(dbPath);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transcriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Onboarding state table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      return true;
    } catch (error) {
      logger.error("Database initialization failed:", error.message);
      throw error;
    }
  }

  saveTranscription(text) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("INSERT INTO transcriptions (text) VALUES (?)");
      const result = stmt.run(text);

      const fetchStmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
      const transcription = fetchStmt.get(result.lastInsertRowid);

      return { id: result.lastInsertRowid, success: true, transcription };
    } catch (error) {
      logger.error("Error saving transcription:", error.message);
      throw error;
    }
  }

  getTranscriptions(limit = 50) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("SELECT * FROM transcriptions ORDER BY timestamp DESC LIMIT ?");
      const transcriptions = stmt.all(limit);
      return transcriptions;
    } catch (error) {
      logger.error("Error getting transcriptions:", error.message);
      throw error;
    }
  }

  clearTranscriptions() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("DELETE FROM transcriptions");
      const result = stmt.run();
      return { cleared: result.changes, success: true };
    } catch (error) {
      logger.error("Error clearing transcriptions:", error.message);
      throw error;
    }
  }

  deleteTranscription(id) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("DELETE FROM transcriptions WHERE id = ?");
      const result = stmt.run(id);
      logger.log(`Deleted transcription ${id}, affected rows: ${result.changes}`);
      return { success: result.changes > 0, id };
    } catch (error) {
      logger.error("Error deleting transcription:", error);
      throw error;
    }
  }

  // Onboarding state management
  getOnboardingStatus() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("SELECT value FROM app_settings WHERE key = ?");
      const result = stmt.get("onboarding_completed");
      // If no record exists, return false (show onboarding)
      // If record exists and is "true", return true (skip onboarding)
      // If record exists and is "false", return false (show onboarding)
      if (!result) {
        return false; // No record = show onboarding
      }
      return result.value === "true";
    } catch (error) {
      logger.error("Error getting onboarding status:", error.message);
      // On error, default to showing onboarding
      return false;
    }
  }

  setOnboardingCompleted(completed = true) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
      );
      stmt.run("onboarding_completed", completed ? "true" : "false");
      return { success: true };
    } catch (error) {
      logger.error("Error setting onboarding status:", error.message);
      throw error;
    }
  }

  getSetting(key) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("SELECT value FROM app_settings WHERE key = ?");
      const result = stmt.get(key);
      return result ? result.value : null;
    } catch (error) {
      logger.error(`Error getting setting ${key}:`, error.message);
      return null;
    }
  }

  setSetting(key, value) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
      );
      stmt.run(key, value);
      return { success: true };
    } catch (error) {
      logger.error(`Error setting ${key}:`, error.message);
      throw error;
    }
  }

  cleanup() {
    logger.log("Starting database cleanup...");
    try {
      const dbPath = path.join(
        app.getPath("userData"),
        process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db",
      );
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        logger.log("Database file deleted:", dbPath);
      }
    } catch (error) {
      logger.error("Error deleting database file:", error);
    }
  }
}

module.exports = DatabaseManager;
