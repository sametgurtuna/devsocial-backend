import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { db } from "./database";
import { SyncRequest, SyncResponse } from "./types";
import {
  generateSocialPost,
  generateWeeklySummary,
  generateMilestonePost,
} from "./postGenerator";

// .env dosyasını yükle
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET || "devsocial-secret-key-change-in-production";

// Production environment check
const isProduction = process.env.NODE_ENV === "production";

// CORS configuration
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
  : ["*"];

const corsOptions: cors.CorsOptions = {
  origin: isProduction ? corsOrigins : true, // Development'ta tüm origin'lere izin ver
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
  credentials: true,
  maxAge: 86400, // 24 saat preflight cache
};

// Rate limiting configuration
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"); // Default: 1 dakika
const rateLimitMaxRequests = parseInt(
  process.env.RATE_LIMIT_MAX_REQUESTS || "100",
); // Default: 100 istek

const apiLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMaxRequests,
  message: {
    success: false,
    message: "Çok fazla istek gönderdiniz. Lütfen biraz bekleyin.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  // API key başına rate limit
  keyGenerator: (req) => {
    const apiKey = req.headers["x-api-key"] as string;
    return apiKey || "anonymous";
  },
  skip: (req) => {
    // Health check endpoint'i rate limit'ten muaf
    return req.path === "/api/health";
  },
});

// Auth endpoint'leri için daha sıkı rate limit
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 10, // 15 dakikada max 10 login/register denemesi
  message: {
    success: false,
    message: "Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: isProduction ? undefined : false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// Apply rate limiting to all API routes
app.use("/api/", apiLimiter);

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// API Key doğrulama middleware
function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const apiKey = req.headers["x-api-key"] as string;

  if (!apiKey) {
    res.status(401).json({ success: false, message: "API key gerekli" });
    return;
  }

  const user = db.getUserByApiKey(apiKey);
  if (!user) {
    res.status(401).json({ success: false, message: "Geçersiz API key" });
    return;
  }

  // Request'e kullanıcı bilgisini ekle
  (req as any).user = user;
  next();
}

// ==================== API ROUTES ====================

/**
 * Health check
 */
app.get("/api/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: Date.now(),
    version: "1.0.0",
  });
});

/**
 * Aktivite senkronizasyonu
 * VS Code extension'dan gelen verileri işler
 */
app.post(
  "/api/activity/sync",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { summary, heartbeats }: SyncRequest = req.body;

      console.log(
        `[SYNC] User: ${user.username}, Heartbeats: ${heartbeats?.length || 0}`,
      );

      // Güvenlik: Sadece metadata kabul et, kod içeriği yok
      if (!summary || typeof summary.totalActiveSeconds !== "number") {
        res.status(400).json({
          success: false,
          message: "Geçersiz veri formatı",
        });
        return;
      }

      // Aktiviteyi güncelle
      const projectsMap = new Map<string, number>();
      const languagesMap = new Map<string, number>();

      summary.projects?.forEach((p) => {
        projectsMap.set(p.projectName, p.activeSeconds);
      });

      summary.languages?.forEach((l) => {
        languagesMap.set(l.language, l.activeSeconds);
      });

      db.updateActivity(
        user.id,
        summary.totalActiveSeconds,
        projectsMap,
        languagesMap,
      );

      // Güncel verileri al
      const todayActivity = db.getTodayActivity(user.id);
      const weekTotal = db.getWeekActivity(user.id);
      const friendsActivity = db.getFriendsActivity(user.id);

      // Yanıt
      const response: SyncResponse = {
        success: true,
        message: "Senkronizasyon başarılı",
        data: {
          todayTotal: todayActivity?.totalSeconds || 0,
          weekTotal: weekTotal,
          friendsActivity: friendsActivity,
        },
      };

      res.json(response);
    } catch (error) {
      console.error("[SYNC ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

/**
 * Arkadaş aktivitelerini getir
 */
app.get(
  "/api/activity/friends",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const friendsActivity = db.getFriendsActivity(user.id);

      res.json({
        success: true,
        friends: friendsActivity,
      });
    } catch (error) {
      console.error("[FRIENDS ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

/**
 * Kullanıcı istatistiklerini getir
 */
app.get(
  "/api/activity/stats",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const todayActivity = db.getTodayActivity(user.id);
      const weekTotal = db.getWeekActivity(user.id);

      res.json({
        success: true,
        stats: {
          today: {
            totalSeconds: todayActivity?.totalSeconds || 0,
            projects: todayActivity
              ? Object.fromEntries(todayActivity.projects)
              : {},
            languages: todayActivity
              ? Object.fromEntries(todayActivity.languages)
              : {},
          },
          week: {
            totalSeconds: weekTotal,
          },
        },
      });
    } catch (error) {
      console.error("[STATS ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

/**
 * Sosyal medya postu oluştur (preview)
 */
app.get(
  "/api/post/preview",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const platform = (req.query.platform as string) || "twitter";
      const todayActivity = db.getTodayActivity(user.id);

      if (!todayActivity || todayActivity.totalSeconds < 60) {
        res.json({
          success: false,
          message: "Yeterli aktivite verisi yok (minimum 1 dakika gerekli)",
        });
        return;
      }

      const post = generateSocialPost(user.username, todayActivity, {
        includeProject: user.settings.shareProjectName,
        includeLanguages: user.settings.shareLanguage,
        platform: platform as any,
      });

      res.json({
        success: true,
        post: post,
        platform: platform,
        characterCount: post.length,
      });
    } catch (error) {
      console.error("[POST PREVIEW ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

/**
 * Haftalık özet postu
 */
app.get(
  "/api/post/weekly",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const weekTotal = db.getWeekActivity(user.id);
      const todayActivity = db.getTodayActivity(user.id);

      if (weekTotal < 60) {
        res.json({
          success: false,
          message: "Yeterli haftalık aktivite verisi yok",
        });
        return;
      }

      // Basitleştirilmiş versiyon (gerçek uygulamada haftalık agregasyon yapılır)
      const topProjects: { name: string; seconds: number }[] = [];
      const topLanguages: { name: string; seconds: number }[] = [];

      if (todayActivity) {
        todayActivity.projects.forEach((seconds, name) => {
          topProjects.push({ name, seconds });
        });
        todayActivity.languages.forEach((seconds, name) => {
          topLanguages.push({ name, seconds });
        });
      }

      topProjects.sort((a, b) => b.seconds - a.seconds);
      topLanguages.sort((a, b) => b.seconds - a.seconds);

      const post = generateWeeklySummary(
        user.username,
        weekTotal,
        topProjects,
        topLanguages,
      );

      res.json({
        success: true,
        post: post,
        weekTotal: weekTotal,
      });
    } catch (error) {
      console.error("[WEEKLY POST ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

/**
 * Kullanıcı bilgilerini getir
 */
app.get("/api/user/me", authenticateApiKey, (req: Request, res: Response) => {
  const user = (req as any).user;

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      settings: user.settings,
      friendCount: user.friends.length,
    },
  });
});

/**
 * Kullanıcı ayarlarını güncelle
 */
app.patch(
  "/api/user/settings",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { settings } = req.body;

      if (settings) {
        // Güvenli güncelleme
        if (typeof settings.shareActivity === "boolean") {
          user.settings.shareActivity = settings.shareActivity;
        }
        if (typeof settings.shareProjectName === "boolean") {
          user.settings.shareProjectName = settings.shareProjectName;
        }
        if (typeof settings.shareLanguage === "boolean") {
          user.settings.shareLanguage = settings.shareLanguage;
        }
        if (typeof settings.autoPost === "boolean") {
          user.settings.autoPost = settings.autoPost;
        }
        if (typeof settings.postThreshold === "number") {
          user.settings.postThreshold = Math.max(
            1,
            Math.min(24, settings.postThreshold),
          );
        }
      }

      res.json({
        success: true,
        message: "Ayarlar güncellendi",
        settings: user.settings,
      });
    } catch (error) {
      console.error("[SETTINGS ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

// ==================== ARKADAŞLIK API'LERİ ====================

/**
 * Kullanıcı ara (arkadaş eklemek için)
 */
app.get(
  "/api/users/search",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const query = req.query.q as string;

      if (!query || query.length < 2) {
        res.json({
          success: true,
          users: [],
        });
        return;
      }

      const results = db.searchUsers(query, user.id);

      res.json({
        success: true,
        users: results.map((u) => ({
          id: u.id,
          username: u.username,
          avatarUrl: u.avatarUrl,
        })),
      });
    } catch (error) {
      console.error("[SEARCH ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

/**
 * Arkadaşlık isteği gönder
 */
app.post(
  "/api/friends/request",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { userId, username } = req.body;

      let targetUser;
      if (userId) {
        targetUser = db.getUserById(userId);
      } else if (username) {
        targetUser = db.getUserByUsername(username);
      }

      if (!targetUser) {
        res.status(404).json({
          success: false,
          message: "Kullanıcı bulunamadı",
        });
        return;
      }

      if (targetUser.id === user.id) {
        res.status(400).json({
          success: false,
          message: "Kendinize arkadaşlık isteği gönderemezsiniz",
        });
        return;
      }

      const request = db.sendFriendRequest(user.id, targetUser.id);

      res.json({
        success: true,
        message: `${targetUser.username} kullanıcısına arkadaşlık isteği gönderildi`,
        request: {
          id: request.id,
          toUsername: targetUser.username,
          status: request.status,
          createdAt: request.createdAt,
        },
      });
    } catch (error: any) {
      console.error("[FRIEND REQUEST ERROR]", error);
      res.status(400).json({
        success: false,
        message: error.message || "İstek gönderilemedi",
      });
    }
  },
);

/**
 * Gelen arkadaşlık isteklerini getir
 */
app.get(
  "/api/friends/requests/incoming",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const requests = db.getIncomingFriendRequests(user.id);

      res.json({
        success: true,
        requests: requests.map((r) => {
          const fromUser = db.getUserById(r.fromUserId);
          return {
            id: r.id,
            fromUserId: r.fromUserId,
            fromUsername: fromUser?.username || "Bilinmeyen",
            fromAvatarUrl: fromUser?.avatarUrl,
            createdAt: r.createdAt,
          };
        }),
      });
    } catch (error) {
      console.error("[INCOMING REQUESTS ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

/**
 * Giden arkadaşlık isteklerini getir
 */
app.get(
  "/api/friends/requests/outgoing",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const requests = db.getOutgoingFriendRequests(user.id);

      res.json({
        success: true,
        requests: requests.map((r) => {
          const toUser = db.getUserById(r.toUserId);
          return {
            id: r.id,
            toUserId: r.toUserId,
            toUsername: toUser?.username || "Bilinmeyen",
            toAvatarUrl: toUser?.avatarUrl,
            createdAt: r.createdAt,
          };
        }),
      });
    } catch (error) {
      console.error("[OUTGOING REQUESTS ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

/**
 * Arkadaşlık isteğini kabul et
 */
app.post(
  "/api/friends/requests/:requestId/accept",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { requestId } = req.params;

      db.acceptFriendRequest(requestId, user.id);

      res.json({
        success: true,
        message: "Arkadaşlık isteği kabul edildi",
      });
    } catch (error: any) {
      console.error("[ACCEPT REQUEST ERROR]", error);
      res.status(400).json({
        success: false,
        message: error.message || "İstek kabul edilemedi",
      });
    }
  },
);

/**
 * Arkadaşlık isteğini reddet
 */
app.post(
  "/api/friends/requests/:requestId/reject",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { requestId } = req.params;

      db.rejectFriendRequest(requestId, user.id);

      res.json({
        success: true,
        message: "Arkadaşlık isteği reddedildi",
      });
    } catch (error: any) {
      console.error("[REJECT REQUEST ERROR]", error);
      res.status(400).json({
        success: false,
        message: error.message || "İstek reddedilemedi",
      });
    }
  },
);

/**
 * Arkadaş listesini getir
 */
app.get("/api/friends", authenticateApiKey, (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const friends = db.getFriendsList(user.id);

    res.json({
      success: true,
      friends: friends,
    });
  } catch (error) {
    console.error("[FRIENDS LIST ERROR]", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
    });
  }
});

/**
 * Arkadaşı çıkar
 */
app.delete(
  "/api/friends/:friendId",
  authenticateApiKey,
  (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { friendId } = req.params;

      db.removeFriend(user.id, friendId);

      res.json({
        success: true,
        message: "Arkadaş listeden çıkarıldı",
      });
    } catch (error: any) {
      console.error("[REMOVE FRIEND ERROR]", error);
      res.status(400).json({
        success: false,
        message: error.message || "Arkadaş çıkarılamadı",
      });
    }
  },
);

// ==================== KULLANICI KAYIT & GİRİŞ ====================

/**
 * Yeni kullanıcı oluştur (kayıt)
 */
app.post(
  "/api/auth/register",
  authLimiter,
  async (req: Request, res: Response) => {
    try {
      const { username, password, email } = req.body;

      if (!username || username.length < 3) {
        res.status(400).json({
          success: false,
          message: "Kullanıcı adı en az 3 karakter olmalı",
        });
        return;
      }

      if (!password || password.length < 6) {
        res.status(400).json({
          success: false,
          message: "Şifre en az 6 karakter olmalı",
        });
        return;
      }

      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        res.status(400).json({
          success: false,
          message: "Kullanıcı adı sadece harf, rakam ve alt çizgi içerebilir",
        });
        return;
      }

      const user = await db.createUser(username, password, email);

      // JWT token oluştur
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: "30d" },
      );

      res.json({
        success: true,
        message: "Kayıt başarılı!",
        user: {
          id: user.id,
          username: user.username,
          apiKey: user.apiKey,
          email: user.email,
        },
        token,
      });
    } catch (error: any) {
      console.error("[REGISTER ERROR]", error);
      res.status(400).json({
        success: false,
        message: error.message || "Kayıt başarısız",
      });
    }
  },
);

/**
 * Kullanıcı girişi (login)
 */
app.post(
  "/api/auth/login",
  authLimiter,
  async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        res.status(400).json({
          success: false,
          message: "Kullanıcı adı ve şifre gerekli",
        });
        return;
      }

      const user = await db.verifyPassword(username, password);

      if (!user) {
        res.status(401).json({
          success: false,
          message: "Kullanıcı adı veya şifre hatalı",
        });
        return;
      }

      // JWT token oluştur
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: "30d" },
      );

      res.json({
        success: true,
        message: "Giriş başarılı!",
        user: {
          id: user.id,
          username: user.username,
          apiKey: user.apiKey,
          email: user.email,
        },
        token,
      });
    } catch (error: any) {
      console.error("[LOGIN ERROR]", error);
      res.status(500).json({
        success: false,
        message: "Sunucu hatası",
      });
    }
  },
);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: "Endpoint bulunamadı",
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[ERROR]", err);
  res.status(500).json({
    success: false,
    message: "Sunucu hatası",
  });
});

// Server'ı başlat
app.listen(PORT, () => {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║            DevSocial Backend API                   ║");
  console.log("╠════════════════════════════════════════════════════╣");
  console.log(`║  🚀 Server running on port ${PORT}                      ║`);
  console.log(`║  📍 http://localhost:${PORT}/api                       ║`);
  console.log(
    `║  🌍 Mode: ${isProduction ? "PRODUCTION" : "DEVELOPMENT"}                        ║`,
  );
  console.log("║                                                    ║");
  if (!isProduction) {
    console.log("║  ⚠️  Development mode - CORS açık                   ║");
    console.log("║  Demo API Key: dev-api-key-12345                   ║");
  } else {
    console.log("║  ✅ Production mode - CORS kısıtlı                  ║");
    console.log(
      `║  Allowed origins: ${corsOrigins.join(", ").substring(0, 25)}...  ║`,
    );
  }
  console.log("╚════════════════════════════════════════════════════╝");
});

export default app;
