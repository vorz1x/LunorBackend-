#include <algorithm>
#include <vector>
#include <string>
#include <unordered_set>
#include <ctime>
#include <cmath>
#include <climits>
#include "Report.h"
#include "User.h"
#include "HWIDBan.h"

const std::unordered_set<std::string> LUNOR_CUSTOM_WHITELIST = {
    "lunor_custom_cosmatics.pak",
    "lunor_custom_cosmatics.sig"
};

const std::unordered_set<std::string> BLOCKED_SOURCES = {
    "src_cheat",
    "modded_client",
    "unauthorized_debug",
    "1hack",
    "esp",
    "esp_hack",
    "aimbot",
    "wallhack",
    "speedhack",
    "teleporthack",
    "itemdupe",
    "memorytamper",
    "packetforge",
    "injector",
    "dllhack",
    "overlaycheat",
    "silentaim",
    "spinbot",
    "flyhack",
    "noclip",
    "godmode",
    "radarhack",
    "triggerbot",
    "autoclicker",
    "macro",
    "recoilscript",
    "antirecoil",
    "bypass",
    "cheatengine",
    "trainer",
    "hvh",
    "luaexecutor",
    "pythoninject",
    "externaloverlay",
    "minimap",
    "statchanger",
    "fovchanger",
    "inventoryhack",
    "skinchanger",
    "glowesp",
    "chams",
    "backtrack",
    "hitboxexpander",
    "superjump",
    "superrun",
    "teleport",
    "moneyhack",
    "scorehack",
    "xpboost",
    "damagehack",
    "drophack",
    "crashserver",
    "forcekick",
    "spoof",
    "hook",
    "hooklib",
    "hookmod",
    "hookdll",
    "hookinject",
    "overlaymod",
    "overlaydll",
    "overlayinject",
    "modmenu",
    "menuhack",
    "modtool",
    "modkit",
    "modscript"
};

const double MAX_ALLOWED_SPEED = 100.0;
const double MAX_ALLOWED_TELEPORT_DIST = 50.0;
const int MIN_FIRE_INTERVAL_MS = 100;
const int HWID_BAN_RETENTION_DAYS = 365;

struct PlayerState {
    std::string userId;
    double speed;
    struct {
        double x;
        double y;
    } position;
    std::string src;
    std::string hwid;

    bool hasESP;
    bool hasWallhack;
    bool hasInjector;
    bool hasOverlay;
    bool abnormalInput;
    bool memoryTamper;
    bool hasSpeedhack;
    bool hasTeleport;
    bool hasAimbot;
    bool hasPacketForge;
    bool hasItemDupe;

    double movementEntropy;
    double aimSmoothness;
    double serverTickDelta;
    int suspiciousEventCount;
    double hitMissRatio;

    std::string ipAddress;
    std::string sessionId;
    long long lastActionTimestamp;
};

struct AimPayload {
    double angle;
    long long timestamp;
    double hitRate;
    int shots;
    bool isPerfectSnap;
};

struct FirePayload {
    std::vector<long long> fireTimestamps;
    bool isRapidFire;
};

struct Payload {
    AimPayload aim;
    FirePayload fire;
    bool isESPActive;
    bool isWallhackActive;
    bool isTeleportActive;
    bool isItemDupeAttempt;
    bool isPacketForgeAttempt;
    bool isMemoryTamperAttempt;
};

struct ValidationResult {
    bool valid;
    std::string reason;
};

void logSuspicious(const std::string& userId, const std::string& reason, const std::string& details) {
    Report report(userId, reason, details, std::time(nullptr));
    report.save();
}

void banHWID(const std::string& hwid, const std::string& reason, const std::string& userId) {
    HWIDBan::ban(hwid, reason, userId, std::time(nullptr), std::time(nullptr) + HWID_BAN_RETENTION_DAYS * 86400);
}

bool isHWIDBanned(const std::string& hwid) {
    return HWIDBan::isBanned(hwid, std::time(nullptr));
}

void blockUser(const std::string& userId, const std::string& reason, const std::string& hwid) {
    User::ban(userId, reason, std::time(nullptr));
    if (!hwid.empty()) {
        banHWID(hwid, reason, userId);
    }
}

void logAndBlock(const PlayerState& playerState, const std::string& reason, const std::string& details) {
    logSuspicious(playerState.userId, reason, details);
    blockUser(playerState.userId, reason, playerState.hwid);
}

bool isLunorCustomAllowed(const std::string& src) {
    std::string lowerSrc = src;
    std::transform(lowerSrc.begin(), lowerSrc.end(), lowerSrc.begin(), ::tolower);
    for (const auto& allowed : LUNOR_CUSTOM_WHITELIST) {
        if (lowerSrc.find(allowed) != std::string::npos) return true;
    }
    return false;
}

bool isBlockedSource(const std::string& src) {
    if (isLunorCustomAllowed(src)) return false;
    std::string lowerSrc = src;
    std::transform(lowerSrc.begin(), lowerSrc.end(), lowerSrc.begin(), ::tolower);
    for (const auto& blocked : BLOCKED_SOURCES) {
        if (lowerSrc.find(blocked) != std::string::npos) return true;
    }
    return false;
}

bool detectESPWallhack(const PlayerState& playerState, const Payload& payload) {
    return playerState.hasESP || playerState.hasWallhack || playerState.hasInjector || playerState.hasOverlay ||
           payload.isESPActive || payload.isWallhackActive;
}

bool detectAimbot(const PlayerState& playerState, const PlayerState& previousState, const Payload& payload) {
    double angleDelta = std::abs(payload.aim.angle - previousState.position.x);
    long long timeDelta = payload.aim.timestamp - previousState.position.y;
    if (payload.aim.isPerfectSnap) return true;
    if (playerState.hasAimbot) return true;
    if (angleDelta > 45.0 && timeDelta < 50) return true;
    if (payload.aim.hitRate > 0.99 && payload.aim.shots > 20) return true;
    return false;
}

bool detectRapidFire(const PlayerState& playerState, const Payload& payload) {
    if (payload.fire.isRapidFire) return true;
    if (playerState.abnormalInput) return true;
    if (payload.fire.fireTimestamps.size() < 2) return false;
    long long minInterval = LLONG_MAX;
    for (size_t i = 1; i < payload.fire.fireTimestamps.size(); ++i) {
        long long interval = payload.fire.fireTimestamps[i] - payload.fire.fireTimestamps[i - 1];
        if (interval < minInterval) minInterval = interval;
    }
    return minInterval < MIN_FIRE_INTERVAL_MS;
}

bool detectTeleport(const PlayerState& playerState, const Payload& payload) {
    return playerState.hasTeleport || payload.isTeleportActive;
}

bool detectItemDupe(const PlayerState& playerState, const Payload& payload) {
    return playerState.hasItemDupe || payload.isItemDupeAttempt;
}

bool detectPacketForge(const PlayerState& playerState, const Payload& payload) {
    return playerState.hasPacketForge || payload.isPacketForgeAttempt;
}

bool detectMemoryTamper(const PlayerState& playerState, const Payload& payload) {
    return playerState.memoryTamper || payload.isMemoryTamperAttempt;
}

// --- Begin raw, non-AI anti-cheat logic expansion ---

struct CheatDetectionLog {
    std::string userId;
    std::string cheatType;
    std::string details;
    long long timestamp;
    double severity;
};

std::vector<CheatDetectionLog> cheatLogs;

void addCheatLog(const std::string& userId, const std::string& cheatType, const std::string& details, double severity) {
    CheatDetectionLog log;
    log.userId = userId;
    log.cheatType = cheatType;
    log.details = details;
    log.timestamp = std::time(nullptr);
    log.severity = severity;
    cheatLogs.push_back(log);
    logSuspicious(userId, cheatType, details);
}

void escalateBan(const PlayerState& playerState, const std::string& cheatType, double severity) {
    if (severity >= 1.0) {
        blockUser(playerState.userId, cheatType, playerState.hwid);
    }
}

bool checkMovementEntropy(const PlayerState& playerState) {
    return playerState.movementEntropy < 0.2;
}

bool checkAimSmoothness(const PlayerState& playerState) {
    return playerState.aimSmoothness < 0.15;
}

bool checkHitMissRatio(const PlayerState& playerState) {
    return playerState.hitMissRatio > 0.95 && playerState.suspiciousEventCount > 10;
}

bool checkServerTickDelta(const PlayerState& playerState) {
    return playerState.serverTickDelta > 0.5;
}

bool excessiveSuspiciousEvents(const PlayerState& playerState) {
    return playerState.suspiciousEventCount > 50;
}

bool abnormalIP(const std::string& ipAddress) {
    return ipAddress.find("192.168") == std::string::npos && ipAddress.find("10.0.") == std::string::npos;
}

bool abnormalSession(const std::string& sessionId) {
    return sessionId.length() < 8;
}

bool detectOverlayAbuse(const PlayerState& playerState) {
    return playerState.hasOverlay;
}

bool detectExternalTool(const PlayerState& playerState) {
    std::string src = playerState.src;
    std::transform(src.begin(), src.end(), src.begin(), ::tolower);
    return src.find("modtool") != std::string::npos || src.find("trainer") != std::string::npos;
}

bool detectScoreHack(const PlayerState& playerState) {
    return playerState.src.find("scorehack") != std::string::npos;
}

bool detectMoneyHack(const PlayerState& playerState) {
    return playerState.src.find("moneyhack") != std::string::npos;
}

bool detectSuperjump(const PlayerState& playerState) {
    return playerState.src.find("superjump") != std::string::npos;
}

bool detectSuperrun(const PlayerState& playerState) {
    return playerState.src.find("superrun") != std::string::npos;
}

bool detectModMenu(const PlayerState& playerState) {
    return playerState.src.find("modmenu") != std::string::npos;
}

bool detectOverlayMod(const PlayerState& playerState) {
    return playerState.src.find("overlaymod") != std::string::npos;
}

bool detectOverlayDLL(const PlayerState& playerState) {
    return playerState.src.find("overlaydll") != std::string::npos;
}

bool detectHookDLL(const PlayerState& playerState) {
    return playerState.src.find("hookdll") != std::string::npos;
}

bool detectForceKick(const PlayerState& playerState) {
    return playerState.src.find("forcekick") != std::string::npos;
}

bool detectCrashServer(const PlayerState& playerState) {
    return playerState.src.find("crashserver") != std::string::npos;
}

bool detectSpoof(const PlayerState& playerState) {
    return playerState.src.find("spoof") != std::string::npos;
}

bool detectFovChanger(const PlayerState& playerState) {
    return playerState.src.find("fovchanger") != std::string::npos;
}

bool detectSkinChanger(const PlayerState& playerState) {
    return playerState.src.find("skinchanger") != std::string::npos;
}

bool detectInventoryHack(const PlayerState& playerState) {
    return playerState.src.find("inventoryhack") != std::string::npos;
}

bool detectGlowESP(const PlayerState& playerState) {
    return playerState.src.find("glowesp") != std::string::npos;
}

bool detectChams(const PlayerState& playerState) {
    return playerState.src.find("chams") != std::string::npos;
}

bool detectBacktrack(const PlayerState& playerState) {
    return playerState.src.find("backtrack") != std::string::npos;
}

bool detectHitboxExpander(const PlayerState& playerState) {
    return playerState.src.find("hitboxexpander") != std::string::npos;
}

bool detectTeleportHack(const PlayerState& playerState) {
    return playerState.src.find("teleporthack") != std::string::npos;
}

bool detectNoclip(const PlayerState& playerState) {
    return playerState.src.find("noclip") != std::string::npos;
}

bool detectGodmode(const PlayerState& playerState) {
    return playerState.src.find("godmode") != std::string::npos;
}

bool detectRadarHack(const PlayerState& playerState) {
    return playerState.src.find("radarhack") != std::string::npos;
}

bool detectTriggerBot(const PlayerState& playerState) {
    return playerState.src.find("triggerbot") != std::string::npos;
}

bool detectAutoClicker(const PlayerState& playerState) {
    return playerState.src.find("autoclicker") != std::string::npos;
}

bool detectMacro(const PlayerState& playerState) {
    return playerState.src.find("macro") != std::string::npos;
}

bool detectRecoilScript(const PlayerState& playerState) {
    return playerState.src.find("recoilscript") != std::string::npos;
}

bool detectAntiRecoil(const PlayerState& playerState) {
    return playerState.src.find("antirecoil") != std::string::npos;
}

bool detectBypass(const PlayerState& playerState) {
    return playerState.src.find("bypass") != std::string::npos;
}

bool detectCheatEngine(const PlayerState& playerState) {
    return playerState.src.find("cheatengine") != std::string::npos;
}

bool detectLuaExecutor(const PlayerState& playerState) {
    return playerState.src.find("luaexecutor") != std::string::npos;
}

bool detectPythonInject(const PlayerState& playerState) {
    return playerState.src.find("pythoninject") != std::string::npos;
}

bool detectExternalOverlay(const PlayerState& playerState) {
    return playerState.src.find("externaloverlay") != std::string::npos;
}

bool detectMinimap(const PlayerState& playerState) {
    return playerState.src.find("minimap") != std::string::npos;
}

bool detectStatChanger(const PlayerState& playerState) {
    return playerState.src.find("statchanger") != std::string::npos;
}

bool detectDamageHack(const PlayerState& playerState) {
    return playerState.src.find("damagehack") != std::string::npos;
}

bool detectDropHack(const PlayerState& playerState) {
    return playerState.src.find("drophack") != std::string::npos;
}

bool detectXPBoost(const PlayerState& playerState) {
    return playerState.src.find("xpboost") != std::string::npos;
}

bool detectDLLHack(const PlayerState& playerState) {
    return playerState.src.find("dllhack") != std::string::npos;
}

bool detectOverlayCheat(const PlayerState& playerState) {
    return playerState.src.find("overlaycheat") != std::string::npos;
}

bool detectSilentAim(const PlayerState& playerState) {
    return playerState.src.find("silentaim") != std::string::npos;
}

bool detectSpinBot(const PlayerState& playerState) {
    return playerState.src.find("spinbot") != std::string::npos;
}

bool detectFlyHack(const PlayerState& playerState) {
    return playerState.src.find("flyhack") != std::string::npos;
}

// --- End of raw detection functions ---

ValidationResult validatePlayerAction(
    const PlayerState& playerState,
    const PlayerState& previousState,
    const std::string& actionType,
    const Payload& payload
) {
    if (playerState.speed > MAX_ALLOWED_SPEED || playerState.hasSpeedhack) {
        addCheatLog(playerState.userId, "Speed Hack", "speed: " + std::to_string(playerState.speed), 1.0);
        escalateBan(playerState, "Speed Hack", 1.0);
        return {false, "Speed hack detected. Action blocked."};
    }

    double dist = std::sqrt(
        std::pow(playerState.position.x - previousState.position.x, 2) +
        std::pow(playerState.position.y - previousState.position.y, 2)
    );
    if (dist > MAX_ALLOWED_TELEPORT_DIST || detectTeleport(playerState, payload)) {
        addCheatLog(playerState.userId, "Teleport/Position Tampering", "distance: " + std::to_string(dist), 1.0);
        escalateBan(playerState, "Teleport/Position Tampering", 1.0);
        return {false, "Teleport/position tampering detected."};
    }

    if (isBlockedSource(playerState.src)) {
        addCheatLog(playerState.userId, "Blocked Client Source", "src: " + playerState.src, 1.0);
        escalateBan(playerState, "Blocked Client Source", 1.0);
        return {false, "Blocked client source: " + playerState.src};
    }

    if (detectESPWallhack(playerState, payload)) {
        addCheatLog(playerState.userId, "ESP/Wallhack/Injector/Overlay", "ESP/Wallhack/Injector/Overlay signals detected.", 1.0);
        escalateBan(playerState, "ESP/Wallhack/Injector/Overlay", 1.0);
        return {false, "ESP/Wallhack/Injector/Overlay detected."};
    }

    if (detectAimbot(playerState, previousState, payload)) {
        addCheatLog(playerState.userId, "Aimbot Detected", "aimData", 1.0);
        escalateBan(playerState, "Aimbot Detected", 1.0);
        return {false, "Aimbot-like behavior detected."};
    }

    if (detectRapidFire(playerState, payload)) {
        addCheatLog(playerState.userId, "Rapid Fire", "fireData", 1.0);
        escalateBan(playerState, "Rapid Fire", 1.0);
        return {false, "Rapid fire detected."};
    }

    if (detectItemDupe(playerState, payload)) {
        addCheatLog(playerState.userId, "Item Duplication Cheat", "item dupe detected", 1.0);
        escalateBan(playerState, "Item Duplication Cheat", 1.0);
        return {false, "Item duplication cheat detected."};
    }

    if (detectPacketForge(playerState, payload)) {
        addCheatLog(playerState.userId, "Packet Forging", "packet forging detected", 1.0);
        escalateBan(playerState, "Packet Forging", 1.0);
        return {false, "Packet forging detected."};
    }

    if (detectMemoryTamper(playerState, payload)) {
        addCheatLog(playerState.userId, "Memory Tampering", "memory tampering detected", 1.0);
        escalateBan(playerState, "Memory Tampering", 1.0);
        return {false, "Memory tampering detected."};
    }

    if (isHWIDBanned(playerState.hwid)) {
        addCheatLog(playerState.userId, "HWID Ban", "hwid: " + playerState.hwid, 1.0);
        escalateBan(playerState, "HWID Ban", 1.0);
        return {false, "Device banned."};
    }

    // Additional raw checks for expanded anti-cheat coverage
    if (checkMovementEntropy(playerState)) {
        addCheatLog(playerState.userId, "Low Movement Entropy", "entropy: " + std::to_string(playerState.movementEntropy), 0.7);
    }
    if (checkAimSmoothness(playerState)) {
        addCheatLog(playerState.userId, "Low Aim Smoothness", "smoothness: " + std::to_string(playerState.aimSmoothness), 0.7);
    }
    if (checkHitMissRatio(playerState)) {
        addCheatLog(playerState.userId, "Suspicious Hit/Miss Ratio", "ratio: " + std::to_string(playerState.hitMissRatio), 0.6);
    }
    if (checkServerTickDelta(playerState)) {
        addCheatLog(playerState.userId, "Server Tick Delta", "tickDelta: " + std::to_string(playerState.serverTickDelta), 0.5);
    }
    if (excessiveSuspiciousEvents(playerState)) {
        addCheatLog(playerState.userId, "Excessive Suspicious Events", "count: " + std::to_string(playerState.suspiciousEventCount), 0.8);
    }
    if (abnormalIP(playerState.ipAddress)) {
        addCheatLog(playerState.userId, "Abnormal IP Address", "ip: " + playerState.ipAddress, 0.5);
    }
    if (abnormalSession(playerState.sessionId)) {
        addCheatLog(playerState.userId, "Abnormal Session ID", "session: " + playerState.sessionId, 0.5);
    }
    if (detectOverlayAbuse(playerState)) {
        addCheatLog(playerState.userId, "Overlay Abuse", "overlay detected", 1.0);
        escalateBan(playerState, "Overlay Abuse", 1.0);
        return {false, "Overlay abuse detected."};
    }
    if (detectExternalTool(playerState)) {
        addCheatLog(playerState.userId, "External Tool", "modtool/trainer detected", 1.0);
        escalateBan(playerState, "External Tool", 1.0);
        return {false, "External tool detected."};
    }
    if (detectScoreHack(playerState)) {
        addCheatLog(playerState.userId, "Score Hack", "scorehack detected", 1.0);
        escalateBan(playerState, "Score Hack", 1.0);
        return {false, "Score hack detected."};
    }
    if (detectMoneyHack(playerState)) {
        addCheatLog(playerState.userId, "Money Hack", "moneyhack detected", 1.0);
        escalateBan(playerState, "Money Hack", 1.0);
        return {false, "Money hack detected."};
    }
    if (detectSuperjump(playerState)) {
        addCheatLog(playerState.userId, "Superjump", "superjump detected", 1.0);
        escalateBan(playerState, "Superjump", 1.0);
        return {false, "Superjump detected."};
    }
    if (detectSuperrun(playerState)) {
        addCheatLog(playerState.userId, "Superrun", "superrun detected", 1.0);
        escalateBan(playerState, "Superrun", 1.0);
        return {false, "Superrun detected."};
    }
    if (detectModMenu(playerState)) {
        addCheatLog(playerState.userId, "Mod Menu", "modmenu detected", 1.0);
        escalateBan(playerState, "Mod Menu", 1.0);
        return {false, "Mod Menu detected."};
    }
    if (detectOverlayMod(playerState)) {
        addCheatLog(playerState.userId, "Overlay Mod", "overlaymod detected", 1.0);
        escalateBan(playerState, "Overlay Mod", 1.0);
        return {false, "Overlay Mod detected."};
    }
    if (detectOverlayDLL(playerState)) {
        addCheatLog(playerState.userId, "Overlay DLL", "overlaydll detected", 1.0);
        escalateBan(playerState, "Overlay DLL", 1.0);
        return {false, "Overlay DLL detected."};
    }
    if (detectHookDLL(playerState)) {
        addCheatLog(playerState.userId, "Hook DLL", "hookdll detected", 1.0);
        escalateBan(playerState, "Hook DLL", 1.0);
        return {false, "Hook DLL detected."};
    }
    if (detectForceKick(playerState)) {
        addCheatLog(playerState.userId, "Force Kick", "forcekick detected", 1.0);
        escalateBan(playerState, "Force Kick", 1.0);
        return {false, "Force Kick detected."};
    }
    if (detectCrashServer(playerState)) {
        addCheatLog(playerState.userId, "Crash Server", "crashserver detected", 1.0);
        escalateBan(playerState, "Crash Server", 1.0);
        return {false, "Crash Server detected."};
    }
    if (detectSpoof(playerState)) {
        addCheatLog(playerState.userId, "Spoof", "spoof detected", 1.0);
        escalateBan(playerState, "Spoof", 1.0);
        return {false, "Spoof detected."};
    }
    if (detectFovChanger(playerState)) {
        addCheatLog(playerState.userId, "FOV Changer", "fovchanger detected", 1.0);
        escalateBan(playerState, "FOV Changer", 1.0);
        return {false, "FOV Changer detected."};
    }
    if (detectSkinChanger(playerState)) {
        addCheatLog(playerState.userId, "Skin Changer", "skinchanger detected", 1.0);
        escalateBan(playerState, "Skin Changer", 1.0);
        return {false, "Skin Changer detected."};
    }
    if (detectInventoryHack(playerState)) {
        addCheatLog(playerState.userId, "Inventory Hack", "inventoryhack detected", 1.0);
        escalateBan(playerState, "Inventory Hack", 1.0);
        return {false, "Inventory Hack detected."};
    }
    if (detectGlowESP(playerState)) {
        addCheatLog(playerState.userId, "Glow ESP", "glowesp detected", 1.0);
        escalateBan(playerState, "Glow ESP", 1.0);
        return {false, "Glow ESP detected."};
    }
    if (detectChams(playerState)) {
        addCheatLog(playerState.userId, "Chams", "chams detected", 1.0);
        escalateBan(playerState, "Chams", 1.0);
        return {false, "Chams detected."};
    }
    if (detectBacktrack(playerState)) {
        addCheatLog(playerState.userId, "Backtrack", "backtrack detected", 1.0);
        escalateBan(playerState, "Backtrack", 1.0);
        return {false, "Backtrack detected."};
    }
    if (detectHitboxExpander(playerState)) {
        addCheatLog(playerState.userId, "Hitbox Expander", "hitboxexpander detected", 1.0);
        escalateBan(playerState, "Hitbox Expander", 1.0);
        return {false, "Hitbox Expander detected."};
    }
    if (detectTeleportHack(playerState)) {
        addCheatLog(playerState.userId, "Teleport Hack", "teleporthack detected", 1.0);
        escalateBan(playerState, "Teleport Hack", 1.0);
        return {false, "Teleport Hack detected."};
    }
    if (detectNoclip(playerState)) {
        addCheatLog(playerState.userId, "Noclip", "noclip detected", 1.0);
        escalateBan(playerState, "Noclip", 1.0);
        return {false, "Noclip detected."};
    }
    if (detectGodmode(playerState)) {
        addCheatLog(playerState.userId, "Godmode", "godmode detected", 1.0);
        escalateBan(playerState, "Godmode", 1.0);
        return {false, "Godmode detected."};
    }
    if (detectRadarHack(playerState)) {
        addCheatLog(playerState.userId, "Radar Hack", "radarhack detected", 1.0);
        escalateBan(playerState, "Radar Hack", 1.0);
        return {false, "Radar Hack detected."};
    }
    if (detectTriggerBot(playerState)) {
        addCheatLog(playerState.userId, "Trigger Bot", "triggerbot detected", 1.0);
        escalateBan(playerState, "Trigger Bot", 1.0);
        return {false, "Trigger Bot detected."};
    }
    if (detectAutoClicker(playerState)) {
        addCheatLog(playerState.userId, "Auto Clicker", "autoclicker detected", 1.0);
        escalateBan(playerState, "Auto Clicker", 1.0);
        return {false, "Auto Clicker detected."};
    }
    if (detectMacro(playerState)) {
        addCheatLog(playerState.userId, "Macro", "macro detected", 1.0);
        escalateBan(playerState, "Macro", 1.0);
        return {false, "Macro detected."};
    }
    if (detectRecoilScript(playerState)) {
        addCheatLog(playerState.userId, "Recoil Script", "recoilscript detected", 1.0);
        escalateBan(playerState, "Recoil Script", 1.0);
        return {false, "Recoil Script detected."};
    }
    if (detectAntiRecoil(playerState)) {
        addCheatLog(playerState.userId, "Anti Recoil", "antirecoil detected", 1.0);
        escalateBan(playerState, "Anti Recoil", 1.0);
        return {false, "Anti Recoil detected."};
    }
    if (detectBypass(playerState)) {
        addCheatLog(playerState.userId, "Bypass", "bypass detected", 1.0);
        escalateBan(playerState, "Bypass", 1.0);
        return {false, "Bypass detected."};
    }
    if (detectCheatEngine(playerState)) {
        addCheatLog(playerState.userId, "Cheat Engine", "cheatengine detected", 1.0);
        escalateBan(playerState, "Cheat Engine", 1.0);
        return {false, "Cheat Engine detected."};
    }
    if (detectLuaExecutor(playerState)) {
        addCheatLog(playerState.userId, "Lua Executor", "luaexecutor detected", 1.0);
        escalateBan(playerState, "Lua Executor", 1.0);
        return {false, "Lua Executor detected."};
    }
    if (detectPythonInject(playerState)) {
        addCheatLog(playerState.userId, "Python Inject", "pythoninject detected", 1.0);
        escalateBan(playerState, "Python Inject", 1.0);
        return {false, "Python Inject detected."};
    }
    if (detectExternalOverlay(playerState)) {
        addCheatLog(playerState.userId, "External Overlay", "externaloverlay detected", 1.0);
        escalateBan(playerState, "External Overlay", 1.0);
        return {false, "External Overlay detected."};
    }
    if (detectMinimap(playerState)) {
        addCheatLog(playerState.userId, "Minimap", "minimap detected", 1.0);
        escalateBan(playerState, "Minimap", 1.0);
        return {false, "Minimap detected."};
    }
    if (detectStatChanger(playerState)) {
        addCheatLog(playerState.userId, "Stat Changer", "statchanger detected", 1.0);
        escalateBan(playerState, "Stat Changer", 1.0);
        return {false, "Stat Changer detected."};
    }
    if (detectDamageHack(playerState)) {
        addCheatLog(playerState.userId, "Damage Hack", "damagehack detected", 1.0);
        escalateBan(playerState, "Damage Hack", 1.0);
        return {false, "Damage Hack detected."};
    }
    if (detectDropHack(playerState)) {
        addCheatLog(playerState.userId, "Drop Hack", "drophack detected", 1.0);
        escalateBan(playerState, "Drop Hack", 1.0);
        return {false, "Drop Hack detected."};
    }
    if (detectXPBoost(playerState)) {
        addCheatLog(playerState.userId, "XP Boost", "xpboost detected", 1.0);
        escalateBan(playerState, "XP Boost", 1.0);
        return {false, "XP Boost detected."};
    }
    if (detectDLLHack(playerState)) {
        addCheatLog(playerState.userId, "DLL Hack", "dllhack detected", 1.0);
        escalateBan(playerState, "DLL Hack", 1.0);
        return {false, "DLL Hack detected."};
    }
    if (detectOverlayCheat(playerState)) {
        addCheatLog(playerState.userId, "Overlay Cheat", "overlaycheat detected", 1.0);
        escalateBan(playerState, "Overlay Cheat", 1.0);
        return {false, "Overlay Cheat detected."};
    }
    if (detectSilentAim(playerState)) {
        addCheatLog(playerState.userId, "Silent Aim", "silentaim detected", 1.0);
        escalateBan(playerState, "Silent Aim", 1.0);
        return {false, "Silent Aim detected."};
    }
    if (detectSpinBot(playerState)) {
        addCheatLog(playerState.userId, "Spin Bot", "spinbot detected", 1.0);
        escalateBan(playerState, "Spin Bot", 1.0);
        return {false, "Spin Bot detected."};
    }
    if (detectFlyHack(playerState)) {
        addCheatLog(playerState.userId, "Fly Hack", "flyhack detected", 1.0);
        escalateBan(playerState, "Fly Hack", 1.0);
        return {false, "Fly Hack detected."};
    }

    return {true, ""};
}