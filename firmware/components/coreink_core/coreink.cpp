#include "coreink.hpp"
#include "cJSON.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace ink {
static bool copy(char* dst, size_t cap, const char* src) {
    if (!src || std::strlen(src) >= cap) return false;
    std::memcpy(dst, src, std::strlen(src) + 1);
    return true;
}
bool valid_id(const char* s) {
    size_t n = std::strlen(s);
    if (!n || n > 64) return false;
    for (; *s; ++s) if (!((*s >= 'a' && *s <= 'z') || (*s >= 'A' && *s <= 'Z') ||
        (*s >= '0' && *s <= '9') || *s == '_' || *s == '-')) return false;
    return true;
}
static bool printable_ascii(const char* s) {
    for (; *s; ++s) if (*s < 33 || *s > 126) return false;
    return true;
}
bool valid_config(const Config& c) {
    if (!c.ssid[0] || !valid_id(c.device_id) || !c.token[0] || !printable_ascii(c.token)) return false;
    if (c.poll_seconds && (c.poll_seconds < kMinPollSeconds || c.poll_seconds > kMaxPollSeconds)) return false;
    const char* host = c.base_url + 8;
    if (std::strncmp(c.base_url, "https://", 8) || !*host || !printable_ascii(c.base_url)) return false;
    // A base origin (optional port), with no userinfo, path, query or fragment.
    if (std::strpbrk(host, "/?#@\\")) return false;
    return true;
}
bool next_codepoint(const char*& p, uint32_t& cp) {
    auto s = reinterpret_cast<const unsigned char*>(p);
    unsigned b = *s++;
    if (!b) return false;
    if (b < 128) { cp = b; p = reinterpret_cast<const char*>(s); return true; }
    unsigned count; uint32_t minimum;
    if (b >= 0xC2 && b <= 0xDF) { count = 1; cp = b & 31; minimum = 0x80; }
    else if (b >= 0xE0 && b <= 0xEF) { count = 2; cp = b & 15; minimum = 0x800; }
    else if (b >= 0xF0 && b <= 0xF4) { count = 3; cp = b & 7; minimum = 0x10000; }
    else return false;
    while (count--) {
        if ((*s & 0xC0) != 0x80) return false;
        cp = (cp << 6) | (*s++ & 63);
    }
    if (cp < minimum || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return false;
    p = reinterpret_cast<const char*>(s);
    return true;
}
bool valid_message(const char* p) {
    unsigned count = 0;
    while (*p) {
        uint32_t cp;
        if (!next_codepoint(p, cp) || ++count > 120 || (cp < 32 && cp != 10) || cp == 127) return false;
    }
    return true;
}
static cJSON* parse(const char* body, size_t length) {
    if (!body || !length || length > kBodyBytes || std::memchr(body, '\0', length)) return nullptr;
    // Bound cJSON recursion on the ESP32 task stack before entering the parser.
    unsigned depth = 0;
    bool quoted = false;
    for (size_t i = 0; i < length; ++i) {
        char c = body[i];
        if (quoted && c == '\\') { ++i; continue; }
        if (c == '"') quoted = !quoted;
        if (!quoted && (c == '{' || c == '[') && ++depth > 16) return nullptr;
        if (!quoted && (c == '}' || c == ']')) { if (!depth) return nullptr; --depth; }
    }
    if (quoted || depth) return nullptr;
    // cJSON strings cannot represent embedded U+0000. Reject its escape rather
    // than accepting a silently truncated credential or display message.
    for (size_t i = 0; i + 5 < length; ++i) {
        if (body[i] == '\\') {
            if (std::memcmp(body + i, "\\u0000", 6) == 0) return nullptr;
            ++i; // escaped backslash is literal text
        }
    }
    const char* end = nullptr;
    cJSON* root = cJSON_ParseWithLengthOpts(body, length, &end, false);
    if (!root) return nullptr;
    while (end < body + length && (*end == ' ' || *end == '\n' || *end == '\r' || *end == '\t')) ++end;
    if (end != body + length || !cJSON_IsObject(root)) { cJSON_Delete(root); return nullptr; }
    // Reject duplicate top-level keys, including escaped spellings.
    for (auto a = root->child; a; a = a->next) for (auto b = a->next; b; b = b->next)
        if (!std::strcmp(a->string, b->string)) { cJSON_Delete(root); return nullptr; }
    return root;
}
static bool string(cJSON* root, const char* key, char* out, size_t cap) {
    const auto item = cJSON_GetObjectItemCaseSensitive(root, key);
    return cJSON_IsString(item) && copy(out, cap, item->valuestring);
}
static bool number(cJSON* root, const char* key, double min, double max, double& out) {
    const auto item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsNumber(item) || !std::isfinite(item->valuedouble) || item->valuedouble < min ||
        item->valuedouble > max || std::floor(item->valuedouble) != item->valuedouble) return false;
    out = item->valuedouble; return true;
}
bool parse_snapshot(const char* body, size_t length, const char* etag, Snapshot& out) {
    cJSON* root = parse(body, length);
    if (!root) return false;
    Snapshot next{}; double revision = 0, poll = 0;
    bool ok = string(root, "face", next.content.face, sizeof(next.content.face)) && valid_id(next.content.face) &&
        string(root, "message", next.content.message, sizeof(next.content.message)) && valid_message(next.content.message) &&
        number(root, "revision", 0, 9007199254740991.0, revision) &&
        number(root, "nextPollSeconds", 1, 86400, poll);
    const auto ack=cJSON_GetObjectItemCaseSensitive(root,"requiresAck");
    if(ack && !cJSON_IsBool(ack)) ok=false;
    next.requires_ack=cJSON_IsTrue(ack);
    next.revision = static_cast<uint64_t>(revision);
    next.poll_seconds = std::clamp(static_cast<uint32_t>(poll), kMinPollSeconds, kMaxPollSeconds);
    // ETags are opaque, but must fit one safe HTTP header value. An absent ETag
    // simply disables conditional requests; content comparison still works.
    if (etag && *etag) {
        ok = ok && copy(next.etag, sizeof(next.etag), etag);
        for (const char* p = etag; *p; ++p) if (*p < 32 || *p == 127) ok = false;
    }
    cJSON_Delete(root);
    if (ok) out = next;
    return ok;
}
bool parse_config(const char* body, size_t length, Config& out) {
    cJSON* root = parse(body, length);
    if (!root) return false;
    Config next{};
    bool ok = string(root, "ssid", next.ssid, sizeof(next.ssid)) &&
        string(root, "password", next.password, sizeof(next.password)) &&
        string(root, "baseUrl", next.base_url, sizeof(next.base_url)) &&
        string(root, "deviceId", next.device_id, sizeof(next.device_id)) &&
        string(root, "token", next.token, sizeof(next.token));
    auto poll = cJSON_GetObjectItemCaseSensitive(root, "pollSeconds");
    if (poll) { double n = 0; ok = ok && number(root, "pollSeconds", 0, kMaxPollSeconds, n); next.poll_seconds = static_cast<uint32_t>(n); }
    auto awake = cJSON_GetObjectItemCaseSensitive(root, "stayAwake");
    if (awake) { ok = ok && cJSON_IsBool(awake); next.stay_awake = cJSON_IsTrue(awake); }
    for (auto p = root->child; p; p = p->next) {
        if (std::strcmp(p->string, "ssid") && std::strcmp(p->string, "password") && std::strcmp(p->string, "baseUrl") &&
            std::strcmp(p->string, "deviceId") && std::strcmp(p->string, "token") && std::strcmp(p->string, "pollSeconds") &&
            std::strcmp(p->string, "stayAwake")) ok = false;
    }
    cJSON_Delete(root);
    if (ok && valid_config(next)) { out = next; return true; }
    return false;
}
bool equal(const Content& a, const Content& b) { return !std::strcmp(a.face, b.face) && !std::strcmp(a.message, b.message); }
bool pending(const State& s) { return s.has_latest && (!s.has_shown || !equal(s.latest.content, s.shown)); }
void accept(State& s, const Snapshot& snapshot) { s.latest = snapshot; s.has_latest = true; s.failures = 0; }
void displayed(State& s) { if (s.has_latest) { s.shown = s.latest.content; s.has_shown = true; } }
uint32_t poll_delay(const State& s, const Config& c, bool low_battery) {
    uint32_t n = c.poll_seconds ? c.poll_seconds : s.has_latest ? s.latest.poll_seconds : 60;
    return std::clamp(low_battery ? std::max<uint32_t>(n, 900) : n, kMinPollSeconds, kMaxPollSeconds);
}
uint32_t retry_delay(uint32_t failures, uint32_t random_value) {
    uint32_t base = std::min<uint32_t>(1800, 30U << std::min<uint32_t>(failures ? failures - 1 : 0, 6));
    return base + random_value % (base / 4 + 1);
}
int64_t refresh_reference(int64_t now, bool timer_wake, uint32_t slept_seconds) {
    // A completed hardware timer sleep is elapsed time since any prior redraw.
    // Reset and button wakes cannot prove that the timer duration elapsed.
    const uint32_t elapsed = timer_wake ? std::min<uint32_t>(slept_seconds, kMinRefreshMs / 1000) * 1000 : 0;
    return now - elapsed;
}
uint32_t refresh_wait(int64_t now, int64_t last) {
    if (now < last) return kMinRefreshMs;
    const auto elapsed = now - last;
    return elapsed >= kMinRefreshMs ? 0 : kMinRefreshMs - static_cast<uint32_t>(elapsed);
}
uint32_t crc32(const void* data, size_t length) {
    uint32_t crc = ~0U;
    auto p = static_cast<const uint8_t*>(data);
    while (length--) { crc ^= *p++; for (unsigned i = 0; i < 8; ++i) crc = (crc >> 1) ^ (0xEDB88320U & (0U - (crc & 1))); }
    return ~crc;
}
static TextLayout layout_text(const char* p, uint8_t rows, bool word_wrap = true, bool paragraphs = true) {
    TextLayout out{};
    uint32_t codepoints[120]{};
    size_t size = 0;
    while (*p && size < 120) {
        uint32_t cp;
        if (!next_codepoint(p, cp)) break;
        codepoints[size++] = !paragraphs && cp == '\n' ? ' ' : cp;
    }
    bool overflow = *p != 0;
    uint8_t row = 0;
    uint16_t x = 0;
    size_t i = 0;
    for (; i < size; ++i) {
        uint32_t cp = codepoints[i];
        if (cp == '\n') {
            if (++row == rows) { ++i; break; }
            x = 0;
            continue;
        }
        if (cp == ' ' && x == 0) continue;
        // Move a word as a unit when it fits a fresh line. Very long words
        // (URLs/identifiers) still break by glyph rather than running off-screen.
        if (word_wrap && cp != ' ' && (i == 0 || codepoints[i - 1] == ' ' || codepoints[i - 1] == '\n')) {
            uint16_t word_width = 0;
            for (size_t j = i; j < size && codepoints[j] != ' ' && codepoints[j] != '\n'; ++j)
                word_width += glyph_advance(codepoints[j]);
            if (x && word_width <= kTextWidth && x + word_width > kTextWidth) { ++row; x = 0; }
        }
        const auto advance = glyph_advance(cp);
        if (x + advance > kTextWidth) { ++row; x = 0; }
        if (row >= rows) break;
        if (cp == ' ' && x == 0) continue;
        out.glyphs[out.count++] = {cp, x, row};
        x += advance;
    }
    out.truncated = i < size || overflow;
    if (out.truncated) {
        const auto width = glyph_advance(0x2026);
        while (out.count) {
            const auto& g = out.glyphs[out.count - 1];
            if (g.row == rows - 1 && (g.codepoint == ' ' || g.x + glyph_advance(g.codepoint) + width > kTextWidth)) --out.count;
            else break;
        }
        x = 0;
        if (out.count && out.glyphs[out.count - 1].row == rows - 1) {
            const auto& g = out.glyphs[out.count - 1];
            x = g.x + glyph_advance(g.codepoint);
        }
        out.glyphs[out.count++] = {0x2026, x, static_cast<uint8_t>(rows - 1)};
    }
    // Trailing spaces at a wrap/newline are invisible and must not skew centering.
    size_t kept = 0;
    for (size_t g = 0; g < out.count; ++g) {
        if (out.glyphs[g].codepoint == ' ') {
            size_t next = g + 1;
            while (next < out.count && out.glyphs[next].row == out.glyphs[g].row && out.glyphs[next].codepoint == ' ') ++next;
            if (next == out.count || out.glyphs[next].row != out.glyphs[g].row) continue;
        }
        out.glyphs[kept++] = out.glyphs[g];
    }
    out.count = kept;
    // Center each wrapped line independently using its measured pixel width.
    for (uint8_t line = 0; line < rows; ++line) {
        uint16_t width = 0;
        for (size_t g = 0; g < out.count; ++g) if (out.glyphs[g].row == line)
            width = out.glyphs[g].x + glyph_advance(out.glyphs[g].codepoint);
        const uint16_t offset = (kTextWidth - width) / 2;
        for (size_t g = 0; g < out.count; ++g) if (out.glyphs[g].row == line) out.glyphs[g].x += offset;
    }
    return out;
}
TextLayout layout_message(const char* message) { return layout_text(message, kRows); }
TextLayout layout_full_message(const char* message) {
    auto layout = layout_text(message, kFullMessageRows);
    // Dense word wrapping or many explicit line breaks can waste rows. Fall
    // back to character wrapping and inline line breaks so all 120 codepoints
    // fit at the original font size, without dropping any non-space text.
    if (layout.truncated) layout = layout_text(message, kFullMessageRows, false, false);
    return layout;
}

} // namespace ink
