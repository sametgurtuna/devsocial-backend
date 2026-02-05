import { Pool } from "pg";
import { User, DailyActivity, FriendActivity, FriendRequest } from "./types";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

/**
 * PostgreSQL Database
 * Neon PostgreSQL ile kalıcı veri depolama
 */
class PostgresDatabase {
  private pool: Pool;
  private initialized = false;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }

    this.pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.pool.on("error", (err) => {
      console.error("[DB] Unexpected error on idle client", err);
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.createTables();
      this.initialized = true;
      console.log("[DB] PostgreSQL database initialized");
    } catch (error) {
      console.error("[DB] Failed to initialize database:", error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(36) PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          api_key VARCHAR(36) UNIQUE NOT NULL,
          email VARCHAR(255),
          avatar_url VARCHAR(500),
          created_at BIGINT NOT NULL,
          settings JSONB DEFAULT '{"shareActivity":true,"shareProjectName":true,"shareLanguage":true,"autoPost":false,"postThreshold":2}'
        );

        CREATE TABLE IF NOT EXISTS friendships (
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          friend_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          created_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, friend_id)
        );

        CREATE TABLE IF NOT EXISTS friend_requests (
          id VARCHAR(36) PRIMARY KEY,
          from_user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          to_user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(20) DEFAULT 'pending',
          created_at BIGINT NOT NULL,
          responded_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS daily_activities (
          id VARCHAR(72) PRIMARY KEY,
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          date VARCHAR(10) NOT NULL,
          total_seconds INT DEFAULT 0,
          projects JSONB DEFAULT '{}',
          languages JSONB DEFAULT '{}',
          last_update BIGINT NOT NULL,
          UNIQUE(user_id, date)
        );

        CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_daily_activities_user_date ON daily_activities(user_id, date);
        CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user ON friend_requests(to_user_id, status);
      `);
      console.log("[DB] Tables created successfully");
    } finally {
      client.release();
    }
  }

  // ==================== USER OPERATIONS ====================

  async getUserByApiKey(apiKey: string): Promise<User | null> {
    const result = await this.pool.query(
      "SELECT * FROM users WHERE api_key = $1",
      [apiKey],
    );
    if (result.rows.length === 0) return null;
    return this.rowToUser(result.rows[0]);
  }

  async getUserById(id: string): Promise<User | null> {
    const result = await this.pool.query("SELECT * FROM users WHERE id = $1", [
      id,
    ]);
    if (result.rows.length === 0) return null;
    return this.rowToUser(result.rows[0]);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const result = await this.pool.query(
      "SELECT * FROM users WHERE LOWER(username) = LOWER($1)",
      [username],
    );
    if (result.rows.length === 0) return null;
    return this.rowToUser(result.rows[0]);
  }

  private async rowToUser(row: any): Promise<User> {
    // Get friends list
    const friendsResult = await this.pool.query(
      "SELECT friend_id FROM friendships WHERE user_id = $1",
      [row.id],
    );
    const friends = friendsResult.rows.map((r: any) => r.friend_id);

    return {
      id: row.id,
      username: row.username,
      password: row.password,
      apiKey: row.api_key,
      email: row.email,
      avatarUrl: row.avatar_url,
      friends,
      createdAt: parseInt(row.created_at),
      settings: row.settings || {
        shareActivity: true,
        shareProjectName: true,
        shareLanguage: true,
        autoPost: false,
        postThreshold: 2,
      },
    };
  }

  async createUser(
    username: string,
    password: string,
    email?: string,
  ): Promise<User> {
    const existingUser = await this.getUserByUsername(username);
    if (existingUser) {
      throw new Error("Username already taken");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const apiKey = uuidv4();
    const createdAt = Date.now();

    await this.pool.query(
      `INSERT INTO users (id, username, password, api_key, email, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, username, hashedPassword, apiKey, email || null, createdAt],
    );

    console.log(`[DB] New user created: ${username}`);

    return {
      id,
      username,
      password: hashedPassword,
      apiKey,
      email,
      friends: [],
      createdAt,
      settings: {
        shareActivity: true,
        shareProjectName: true,
        shareLanguage: true,
        autoPost: false,
        postThreshold: 2,
      },
    };
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }

  async updateUserSettings(
    userId: string,
    settings: Partial<User["settings"]>,
  ): Promise<void> {
    const user = await this.getUserById(userId);
    if (!user) throw new Error("User not found");

    const newSettings = { ...user.settings, ...settings };
    await this.pool.query("UPDATE users SET settings = $1 WHERE id = $2", [
      JSON.stringify(newSettings),
      userId,
    ]);
  }

  async searchUsers(query: string, excludeUserId: string): Promise<User[]> {
    const result = await this.pool.query(
      `SELECT * FROM users 
       WHERE LOWER(username) LIKE LOWER($1) AND id != $2 
       LIMIT 10`,
      [`%${query}%`, excludeUserId],
    );

    const users: User[] = [];
    for (const row of result.rows) {
      users.push(await this.rowToUser(row));
    }
    return users;
  }

  // ==================== FRIEND REQUESTS ====================

  async sendFriendRequest(
    fromUserId: string,
    toUsername: string,
  ): Promise<FriendRequest> {
    const toUser = await this.getUserByUsername(toUsername);
    if (!toUser) {
      throw new Error("User not found");
    }

    if (fromUserId === toUser.id) {
      throw new Error("Cannot send friend request to yourself");
    }

    // Check if already friends
    const friendshipCheck = await this.pool.query(
      "SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2",
      [fromUserId, toUser.id],
    );
    if (friendshipCheck.rows.length > 0) {
      throw new Error("Already friends");
    }

    // Check for existing pending request
    const existingRequest = await this.pool.query(
      `SELECT * FROM friend_requests 
       WHERE ((from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1))
       AND status = 'pending'`,
      [fromUserId, toUser.id],
    );
    if (existingRequest.rows.length > 0) {
      throw new Error("Friend request already exists");
    }

    const request: FriendRequest = {
      id: uuidv4(),
      fromUserId,
      toUserId: toUser.id,
      status: "pending",
      createdAt: Date.now(),
    };

    await this.pool.query(
      `INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        request.id,
        request.fromUserId,
        request.toUserId,
        request.status,
        request.createdAt,
      ],
    );

    console.log(
      `[DB] Friend request sent: ${fromUserId} -> ${toUser.username}`,
    );
    return request;
  }

  async getIncomingFriendRequests(
    userId: string,
  ): Promise<(FriendRequest & { fromUsername: string })[]> {
    const result = await this.pool.query(
      `SELECT fr.*, u.username as from_username
       FROM friend_requests fr
       JOIN users u ON fr.from_user_id = u.id
       WHERE fr.to_user_id = $1 AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
      [userId],
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      status: row.status,
      createdAt: parseInt(row.created_at),
      respondedAt: row.responded_at ? parseInt(row.responded_at) : undefined,
      fromUsername: row.from_username,
    }));
  }

  async acceptFriendRequest(requestId: string, userId: string): Promise<void> {
    const result = await this.pool.query(
      "SELECT * FROM friend_requests WHERE id = $1",
      [requestId],
    );

    if (result.rows.length === 0) {
      throw new Error("Friend request not found");
    }

    const request = result.rows[0];

    if (request.to_user_id !== userId) {
      throw new Error("Not authorized to accept this request");
    }

    if (request.status !== "pending") {
      throw new Error("Request already responded");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Update request status
      await client.query(
        "UPDATE friend_requests SET status = 'accepted', responded_at = $1 WHERE id = $2",
        [Date.now(), requestId],
      );

      // Create bidirectional friendship
      const now = Date.now();
      await client.query(
        `INSERT INTO friendships (user_id, friend_id, created_at) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [request.from_user_id, request.to_user_id, now],
      );
      await client.query(
        `INSERT INTO friendships (user_id, friend_id, created_at) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [request.to_user_id, request.from_user_id, now],
      );

      await client.query("COMMIT");
      console.log(`[DB] Friend request accepted: ${requestId}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectFriendRequest(requestId: string, userId: string): Promise<void> {
    const result = await this.pool.query(
      "SELECT * FROM friend_requests WHERE id = $1",
      [requestId],
    );

    if (result.rows.length === 0) {
      throw new Error("Friend request not found");
    }

    const request = result.rows[0];

    if (request.to_user_id !== userId) {
      throw new Error("Not authorized to reject this request");
    }

    await this.pool.query(
      "UPDATE friend_requests SET status = 'rejected', responded_at = $1 WHERE id = $2",
      [Date.now(), requestId],
    );
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
      [userId, friendId],
    );
    console.log(`[DB] Friendship removed: ${userId} <-> ${friendId}`);
  }

  // ==================== ACTIVITY OPERATIONS ====================

  private getDateKey(timestamp?: number): string {
    const date = timestamp ? new Date(timestamp) : new Date();
    return date.toISOString().split("T")[0];
  }

  async updateActivity(
    userId: string,
    totalSeconds: number,
    projects: Map<string, number>,
    languages: Map<string, number>,
  ): Promise<void> {
    const date = this.getDateKey();
    const id = `${userId}-${date}`;
    const now = Date.now();

    const projectsObj = Object.fromEntries(projects);
    const languagesObj = Object.fromEntries(languages);

    // Get existing activity
    const existing = await this.pool.query(
      "SELECT * FROM daily_activities WHERE id = $1",
      [id],
    );

    if (existing.rows.length === 0) {
      // Create new
      await this.pool.query(
        `INSERT INTO daily_activities (id, user_id, date, total_seconds, projects, languages, last_update)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          userId,
          date,
          totalSeconds,
          JSON.stringify(projectsObj),
          JSON.stringify(languagesObj),
          now,
        ],
      );
    } else {
      // Update existing - merge data
      const existingRow = existing.rows[0];
      const existingProjects = existingRow.projects || {};
      const existingLanguages = existingRow.languages || {};

      // Merge projects
      for (const [proj, secs] of projects) {
        existingProjects[proj] = (existingProjects[proj] || 0) + secs;
      }

      // Merge languages
      for (const [lang, secs] of languages) {
        existingLanguages[lang] = (existingLanguages[lang] || 0) + secs;
      }

      const newTotal = existingRow.total_seconds + totalSeconds;

      await this.pool.query(
        `UPDATE daily_activities 
         SET total_seconds = $1, projects = $2, languages = $3, last_update = $4
         WHERE id = $5`,
        [
          newTotal,
          JSON.stringify(existingProjects),
          JSON.stringify(existingLanguages),
          now,
          id,
        ],
      );
    }
  }

  async getTodayActivity(userId: string): Promise<DailyActivity | null> {
    const date = this.getDateKey();
    const result = await this.pool.query(
      "SELECT * FROM daily_activities WHERE user_id = $1 AND date = $2",
      [userId, date],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      userId: row.user_id,
      date: row.date,
      totalSeconds: row.total_seconds,
      projects: new Map(Object.entries(row.projects || {})),
      languages: new Map(Object.entries(row.languages || {})),
      lastUpdate: parseInt(row.last_update),
    };
  }

  async getWeekActivity(userId: string): Promise<number> {
    const now = Date.now();
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      dates.push(this.getDateKey(now - i * 24 * 60 * 60 * 1000));
    }

    const result = await this.pool.query(
      `SELECT COALESCE(SUM(total_seconds), 0) as total
       FROM daily_activities
       WHERE user_id = $1 AND date = ANY($2)`,
      [userId, dates],
    );

    return parseInt(result.rows[0].total) || 0;
  }

  // ==================== FRIENDS ACTIVITY ====================

  async getFriendsActivity(userId: string): Promise<FriendActivity[]> {
    // Get user's friends
    const friendsResult = await this.pool.query(
      "SELECT friend_id FROM friendships WHERE user_id = $1",
      [userId],
    );

    if (friendsResult.rows.length === 0) {
      return [];
    }

    const friendIds = friendsResult.rows.map((r: any) => r.friend_id);
    const now = Date.now();
    const today = this.getDateKey();
    const idleThreshold = 2 * 60 * 1000; // 2 minutes - shows as online
    const offlineThreshold = 5 * 60 * 1000; // 5 minutes - shows as idle, then offline

    const activities: FriendActivity[] = [];

    for (const friendId of friendIds) {
      const friendResult = await this.pool.query(
        "SELECT * FROM users WHERE id = $1",
        [friendId],
      );

      if (friendResult.rows.length === 0) continue;

      const friend = friendResult.rows[0];
      // Default settings if null/undefined
      const defaultSettings = {
        shareActivity: true,
        shareProjectName: true,
        shareLanguage: true,
      };
      const settings = { ...defaultSettings, ...(friend.settings || {}) };

      if (settings.shareActivity === false) {
        activities.push({
          username: friend.username,
          avatarUrl: friend.avatar_url,
          activeSeconds: 0,
          lastActive: 0,
          status: "offline",
        });
        continue;
      }

      // Get today's activity
      const activityResult = await this.pool.query(
        "SELECT * FROM daily_activities WHERE user_id = $1 AND date = $2",
        [friendId, today],
      );

      const todayActivity = activityResult.rows[0];
      const lastUpdate = todayActivity
        ? parseInt(todayActivity.last_update)
        : 0;
      const timeSinceActive = now - lastUpdate;

      let status: "online" | "idle" | "offline" = "offline";
      if (todayActivity && timeSinceActive < idleThreshold) {
        status = "online";
      } else if (todayActivity && timeSinceActive < offlineThreshold) {
        status = "idle";
      }

      let currentProject: string | undefined;
      let currentLanguage: string | undefined;

      if (settings.shareProjectName && todayActivity?.projects) {
        const projects = todayActivity.projects;
        let maxSeconds = 0;
        for (const [proj, secs] of Object.entries(projects)) {
          if ((secs as number) > maxSeconds) {
            maxSeconds = secs as number;
            currentProject = proj;
          }
        }
      }

      if (settings.shareLanguage && todayActivity?.languages) {
        const languages = todayActivity.languages;
        let maxSeconds = 0;
        for (const [lang, secs] of Object.entries(languages)) {
          if ((secs as number) > maxSeconds) {
            maxSeconds = secs as number;
            currentLanguage = lang;
          }
        }
      }

      activities.push({
        username: friend.username,
        avatarUrl: friend.avatar_url,
        currentProject,
        currentLanguage,
        activeSeconds: todayActivity?.total_seconds || 0,
        lastActive: lastUpdate,
        status,
      });
    }

    // Sort by status (online first) then by active seconds
    return activities.sort((a, b) => {
      const statusOrder = { online: 0, idle: 1, offline: 2 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return b.activeSeconds - a.activeSeconds;
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Export singleton
export const db = new PostgresDatabase();
