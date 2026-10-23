#pragma once
#include <cstddef>
#include <cstdint>

namespace ink {
constexpr size_t kMessageBytes = 481;
constexpr size_t kBodyBytes = 8192;
constexpr uint32_t kMinRefreshMs = 15000;
constexpr uint32_t kMinPollSeconds = 15;
constexpr uint32_t kMaxPollSeconds = 3600;
struct Content {
    char face[65]{};
    char message[kMessageBytes]{};
};
struct Snapshot {
    Content content{};
    uint64_t revision = 0;
    uint32_t poll_seconds = 60;
    char etag[128]{};
};
struct State {
    Snapshot latest{};
    Content shown{};
    bool has_latest = false;
    bool has_shown = false;
    uint32_t failures = 0;
};
struct Config {
    char ssid[33]{};
    char password[65]{};
    char base_url[257]{};
    char device_id[65]{};
    char token[257]{};
    uint32_t poll_seconds = 0; // zero follows the server
    bool stay_awake = false;  // USB development / diagnostics
};
bool valid_id(const char* value);
bool valid_config(const Config& config);
bool parse_snapshot(const char* body, size_t length, const char* etag, Snapshot& output);
bool parse_config(const char* body, size_t length, Config& output);
bool equal(const Content& a, const Content& b);
bool pending(const State& state);
void accept(State& state, const Snapshot& snapshot);
void displayed(State& state);
uint32_t poll_delay(const State& state, const Config& config, bool low_battery);
uint32_t retry_delay(uint32_t failures, uint32_t random_value);
int64_t refresh_reference(int64_t now_ms, bool timer_wake, uint32_t slept_seconds);
uint32_t refresh_wait(int64_t now_ms, int64_t last_ms);
uint32_t crc32(const void* data, size_t length);
// Strict UTF-8 decoding, rejecting overlong encodings, surrogates and > U+10FFFF.
bool next_codepoint(const char*& cursor, uint32_t& codepoint);
bool valid_message(const char* message);
constexpr size_t kRows = 2;
constexpr uint16_t kTextWidth = 184;
struct PositionedGlyph { uint32_t codepoint; uint16_t x; uint8_t row; };
struct TextLayout { PositionedGlyph glyphs[121]{}; size_t count = 0; bool truncated = false; };
uint16_t glyph_advance(uint32_t codepoint);
TextLayout layout_message(const char* message);
} // namespace ink
