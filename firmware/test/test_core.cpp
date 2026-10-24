#include "coreink.hpp"
#include "render.hpp"
#include "cache.hpp"
#include "http_body.hpp"
#include "history.hpp"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

static unsigned checks = 0;
#define CHECK(condition) do { ++checks; if (!(condition)) { std::cerr << __LINE__ << ": " #condition "\n"; std::exit(1); } } while (0)
static std::string json(const std::string& message = "hello", const std::string& face = "stars", unsigned revision = 1) {
    return "{\"face\":\"" + face + "\",\"message\":\"" + message + "\",\"revision\":" + std::to_string(revision) + ",\"nextPollSeconds\":60}";
}
static bool parse(const std::string& text, ink::Snapshot& out, const char* etag = "\"display-v2-1\"") {
    return ink::parse_snapshot(text.data(), text.size(), etag, out);
}
struct Stream {
    std::string bytes;
    size_t offset = 0;
    size_t chunk = 99;
    int64_t now = 0;
    int64_t advance = 1;
    bool completed = true;
    bool fail = false;
    ink::BodyReader reader() {
        return {this,
            [](void* ctx, char* output, size_t capacity, uint32_t timeout) -> int {
                auto& s = *static_cast<Stream*>(ctx);
                CHECK(timeout > 0 && timeout <= 12000);
                s.now += s.advance;
                if (s.fail) return -1;
                size_t n = std::min({s.bytes.size() - s.offset, capacity, s.chunk});
                std::memcpy(output, s.bytes.data() + s.offset, n); s.offset += n;
                return static_cast<int>(n);
            },
            [](void* ctx) { return static_cast<Stream*>(ctx)->completed; },
            [](void* ctx) { return static_cast<Stream*>(ctx)->now; }};
    }
};
int main() {
    ink::History history{};ink::Snapshot entry{};
    CHECK(!ink::navigate(history,-1));
    for(unsigned i=1;i<=70;i++){entry.revision=i;std::snprintf(entry.content.message,sizeof(entry.content.message),"message %u",i);ink::remember(history,entry);}
    CHECK(history.count==64 && history.selected==63);
    CHECK(history.entries[0].revision==7 && history.entries[63].revision==70);
    ink::remember(history,entry);CHECK(history.count==64);
    CHECK(ink::navigate(history,-1));CHECK(history.selected==62);
    CHECK(ink::navigate(history,-100));CHECK(history.selected==0);
    CHECK(!ink::navigate(history,-1));CHECK(ink::navigate(history,100));CHECK(history.selected==63);

    char body[8192]; size_t body_length = 0;
    Stream stream{json()};
    // Header parsing may already mark the transport complete while the body
    // still waits in its internal buffer. It must still be read and parsed.
    CHECK(ink::read_body(stream.reader(), body, sizeof(body), body_length, 20000));
    CHECK(body_length == stream.bytes.size());
    ink::Snapshot buffered;
    CHECK(ink::parse_snapshot(body, body_length, nullptr, buffered));
    stream = Stream{std::string(8192, 'x')};
    CHECK(ink::read_body(stream.reader(), body, sizeof(body), body_length, 20000));
    CHECK(body_length == sizeof(body));
    stream = Stream{std::string(9000, 'x')};
    CHECK(!ink::read_body(stream.reader(), body, sizeof(body), body_length, 20000));
    CHECK(stream.offset <= sizeof(body) + 1024);
    stream = Stream{json()}; stream.completed = false;
    CHECK(!ink::read_body(stream.reader(), body, sizeof(body), body_length, 20000));
    stream = Stream{json()}; stream.fail = true;
    CHECK(!ink::read_body(stream.reader(), body, sizeof(body), body_length, 20000));
    stream = Stream{std::string(8000, 'x')}; stream.advance = 1000; stream.chunk = 1;
    CHECK(!ink::read_body(stream.reader(), body, sizeof(body), body_length, 20000));
    CHECK(stream.offset == 20);
    stream = Stream{json()}; stream.now = 20001;
    CHECK(!ink::read_body(stream.reader(), body, sizeof(body), body_length, 20000));
    CHECK(stream.offset == 0);
    ink::Snapshot first;
    CHECK(parse(json(), first));
    auto ack_json=json();ack_json.pop_back();ack_json+=",\"requiresAck\":true}";
    CHECK(parse(ack_json,first));CHECK(first.requires_ack);
    auto invalid_ack=json();invalid_ack.pop_back();invalid_ack+=",\"requiresAck\":\"yes\"}";
    CHECK(!parse(invalid_ack,first));
    CHECK(parse(json(),first));CHECK(!first.requires_ack);

    CHECK(!std::strcmp(first.content.face, "stars"));
    CHECK(first.revision == 1 && first.poll_seconds == 60);
    CHECK(!std::strcmp(first.etag, "\"display-v2-1\""));
    CHECK(parse(json("", "small-dots"), first));
    CHECK(first.content.message[0] == 0);
    CHECK(parse(json("line1\\nline2"), first));
    CHECK(std::strchr(first.content.message, '\n'));
    CHECK(parse(json("ČćŽžŠšĐđ"), first));
    CHECK(parse(json("\\uD83D\\uDE00"), first));
    std::string emoji;
    for (int i = 0; i < 120; ++i) emoji += "😀";
    CHECK(parse(json(emoji), first));
    CHECK(std::strlen(first.content.message) == 480);
    CHECK(!parse(json(emoji + "a"), first));
    CHECK(!parse(json("\\t"), first));
    CHECK(!parse(json("\\u0000secret"), first));
    CHECK(parse(json("\\\\u0000"), first)); // literal backslash text
    CHECK(!parse(json("\xED\xA0\x80"), first)); // UTF-8 surrogate
    CHECK(!parse(json("\xF4\x90\x80\x80"), first)); // > U+10FFFF
    CHECK(!parse(json("\xC0\xAF"), first));
    CHECK(!parse(json("\xE2"), first));
    CHECK(!parse(json("hello", "a/b"), first));
    CHECK(!parse(json("hello", std::string(65, 'a')), first));
    CHECK(!parse("{}", first));
    CHECK(!parse(json() + "garbage", first));
    CHECK(!parse("[" + json() + "]", first));
    CHECK(!parse("{\"face\":\"stars\",\"face\":\"angry\",\"message\":\"\",\"revision\":1,\"nextPollSeconds\":60}", first));
    CHECK(!parse("{\"face\":\"stars\",\"message\":\"\",\"revision\":1.5,\"nextPollSeconds\":60}", first));
    CHECK(!parse("{\"face\":\"stars\",\"message\":\"\",\"revision\":-1,\"nextPollSeconds\":60}", first));
    CHECK(!parse("{\"face\":\"stars\",\"message\":\"\",\"revision\":9007199254740992,\"nextPollSeconds\":60}", first));
    CHECK(!parse(json(), first, "bad\r\nInjected: yes"));
    CHECK(!parse(std::string(8193, ' '), first));
    CHECK(!parse(json() + std::string(1, '\0'), first));
    std::string nested = "{\"extra\":" + std::string(40, '[') + "0" + std::string(40, ']') + "}";
    CHECK(!parse(nested, first));
    CHECK(parse("{\"face\":\"stars\",\"message\":\"\",\"revision\":1,\"nextPollSeconds\":1,\"selection\":{\"reason\":\"selected\"}}", first));
    CHECK(first.poll_seconds == 15);
    CHECK(parse("{\"face\":\"stars\",\"message\":\"\",\"revision\":1,\"nextPollSeconds\":86400}", first));
    CHECK(first.poll_seconds == 3600);
    CHECK(parse(json(), first));

    ink::State state;
    CHECK(!ink::pending(state));
    ink::accept(state, first);
    CHECK(ink::pending(state));
    // A 304 must leave a staged frame pending until a physical refresh commits.
    state.failures = 0;
    CHECK(ink::pending(state));
    ink::displayed(state);
    CHECK(!ink::pending(state));
    ink::Snapshot revision_only;
    CHECK(parse(json("hello", "stars", 99), revision_only));
    ink::accept(state, revision_only);
    CHECK(!ink::pending(state));
    CHECK(parse(json("changed", "stars", 100), revision_only));
    ink::accept(state, revision_only);
    CHECK(ink::pending(state));
    CHECK(parse(json("latest", "sleepy", 101), revision_only));
    ink::accept(state, revision_only);
    CHECK(!std::strcmp(state.latest.content.face, "sleepy"));
    CHECK(!std::strcmp(state.shown.message, "hello"));
    ink::displayed(state);
    CHECK(!ink::pending(state));
    state.has_shown = false; // interrupted refresh / local status screen
    CHECK(ink::pending(state));
    uint8_t scope[32]{};
    auto record = ink::seal_cache(state, scope);
    ink::State restored;
    CHECK(ink::restore_cache(record, scope, restored));
    CHECK(ink::pending(restored)); // pending survives a restart followed by 304
    CHECK(!std::strcmp(restored.latest.etag, state.latest.etag));
    CHECK(ink::equal(restored.latest.content, state.latest.content));
    ink::displayed(restored);
    auto complete = ink::seal_cache(restored, scope);
    CHECK(ink::restore_cache(complete, scope, restored));
    CHECK(!ink::pending(restored));
    scope[0] = 1;
    CHECK(!ink::restore_cache(complete, scope, restored)); // another API/device/token
    scope[0] = 0;
    complete.state.latest.content.message[0] ^= 1;
    CHECK(!ink::restore_cache(complete, scope, restored)); // corrupt/torn write
    record.version = 1;
    CHECK(!ink::restore_cache(record, scope, restored));
    CHECK(ink::refresh_wait(1000, 1000) == 15000);
    CHECK(ink::refresh_wait(15999, 1000) == 1);
    CHECK(ink::refresh_wait(16000, 1000) == 0);
    CHECK(ink::refresh_wait(0, 1000) == 15000);
    CHECK(ink::refresh_wait(100, ink::refresh_reference(100, true, 60)) == 0);
    CHECK(ink::refresh_wait(100, ink::refresh_reference(100, true, 15)) == 0);
    CHECK(ink::refresh_wait(100, ink::refresh_reference(100, true, 14)) == 1000);
    CHECK(ink::refresh_wait(100, ink::refresh_reference(100, true, 1)) == 14000);
    CHECK(ink::refresh_wait(100, ink::refresh_reference(100, true, 0)) == 15000);
    CHECK(ink::refresh_wait(100, ink::refresh_reference(100, false, 60)) == 15000);
    CHECK(ink::retry_delay(1, 0) == 30);
    CHECK(ink::retry_delay(100, 0) == 1800);
    CHECK(ink::retry_delay(100, 450) == 2250);
    ink::Config config;
    std::string cfg = R"({"ssid":"room","password":"secret","baseUrl":"https://example.com","deviceId":"pebble","token":"reader-token"})";
    CHECK(ink::parse_config(cfg.data(), cfg.size(), config));
    CHECK(ink::valid_config(config));
    CHECK(ink::poll_delay(state, config, false) == 60);
    CHECK(ink::poll_delay(state, config, true) == 900);
    config.poll_seconds = 300;
    CHECK(ink::poll_delay(state, config, false) == 300);
    CHECK(ink::poll_delay(state, config, true) == 900);
    for (const auto url : {"http://example.com", "https://user@example.com", "https://example.com/path", "https://example.com?x", "https://example.com/", "https://"}) {
        std::strcpy(config.base_url, url); CHECK(!ink::valid_config(config));
    }
    CHECK(!ink::parse_config("{}", 2, config));
    auto typo = cfg.substr(0, cfg.size() - 1) + ",\"typo\":1}";
    CHECK(!ink::parse_config(typo.data(), typo.size(), config));
    CHECK(ink::crc32("123456789", 9) == 0xCBF43926);
    auto layout = ink::layout_message("a\nb");
    CHECK(layout.count == 2 && layout.glyphs[0].codepoint == 'a' && layout.glyphs[0].row == 0 &&
          layout.glyphs[1].codepoint == 'b' && layout.glyphs[1].row == 1);
    layout = ink::layout_message(std::string(120, 'x').c_str());
    CHECK(layout.truncated && layout.glyphs[layout.count - 1].codepoint == 0x2026);
    for (size_t i = 0; i < layout.count; ++i) {
        CHECK(layout.glyphs[i].row < ink::kRows);
        CHECK(layout.glyphs[i].x + ink::glyph_advance(layout.glyphs[i].codepoint) <= ink::kTextWidth);
    }
    layout = ink::layout_message("Hello, Nikola!");
    CHECK(!layout.truncated && layout.count == 14);
    for (size_t i = 0; i < layout.count; ++i) CHECK(layout.glyphs[i].row == 0);
    layout = ink::layout_message("Hello, Nikola! Goodbye");
    bool word_wrapped = false;
    for (size_t i = 0; i < layout.count; ++i) if (layout.glyphs[i].codepoint == 'G') {
        CHECK(layout.glyphs[i].row == 1);
        word_wrapped = true;
    }
    CHECK(word_wrapped && !layout.truncated);
    for (uint8_t row = 0; row < ink::kRows; ++row) {
        uint16_t left = ink::kTextWidth, right = 0;
        for (size_t i = 0; i < layout.count; ++i) if (layout.glyphs[i].row == row) {
            left = std::min(left, layout.glyphs[i].x);
            right = layout.glyphs[i].x + ink::glyph_advance(layout.glyphs[i].codepoint);
        }
        CHECK(std::abs(static_cast<int>(left) - static_cast<int>(ink::kTextWidth - right)) <= 1);
    }
    layout = ink::layout_message(std::string((ink::kTextWidth / ink::glyph_advance('i')) * ink::kRows, 'i').c_str());
    CHECK(!layout.truncated);
    CHECK(ink::known_face("stars"));
    // Reading mode must retain every non-whitespace codepoint, even when
    // normal word wrapping or explicit newlines would consume too many rows.
    std::string many_lines;
    for(int i=0;i<60;i++) many_lines+="x\n";
    std::string wide_words;
    for(int i=0;i<10;i++) wide_words+="abcdefghijk ";
    for(const auto& message : {std::string("what is meaning of life and everything"),
            std::string(120,'x'),many_lines,wide_words,std::string("Čć Žž Šš Đđ\n😀"),std::string(120,'\n')}) {
        const auto full=ink::layout_full_message(message.c_str());
        CHECK(!full.truncated);
        std::vector<uint32_t> expected,actual;
        const char* cursor=message.c_str();uint32_t cp;
        while(*cursor && ink::next_codepoint(cursor,cp)) if(cp!=' ' && cp!='\n') expected.push_back(cp);
        for(size_t i=0;i<full.count;i++) {
            const auto& g=full.glyphs[i];
            CHECK(g.row<ink::kFullMessageRows);
            CHECK(g.x+ink::glyph_advance(g.codepoint)<=ink::kTextWidth);
            if(g.codepoint!=' ') actual.push_back(g.codepoint);
        }
        CHECK(actual==expected);
    }
    ink::Content reading{};
    std::strcpy(reading.face,"hearts");
    ink::Framebuffer full_frame{},other_face{};
    ink::render_full_message_into(reading,full_frame);
    CHECK(std::all_of(full_frame.begin(),full_frame.end(),[](uint8_t value){return value==0;}));
    std::strcpy(reading.message,"what is meaning of life and everything");
    ink::render_full_message_into(reading,full_frame);
    CHECK(full_frame!=ink::render(reading));
    std::strcpy(reading.face,"stars");
    ink::render_full_message_into(reading,other_face);
    CHECK(full_frame==other_face);
    CHECK(!ink::known_face("future-face"));
    ink::Content a{}, b{};
    std::strcpy(a.face, "future-face"); std::strcpy(b.face, "small-dots");
    CHECK(ink::render(a) == ink::render(b));
    // Regression: the physical H had an uneven 1px/2px pair of vertical stems.
    // Check the actual 1-bit output, including horizontal centering of ink.
    ink::Content h{};
    std::strcpy(h.face, "stars"); std::strcpy(h.message, "H");
    auto h_frame = ink::render(h);
    int stem_rows = 0;
    for (int y = 144; y < 170; ++y) {
        int starts[3]{}, widths[3]{}, runs = 0;
        bool in_run = false;
        for (int x = 0; x < 200; ++x) {
            bool black = (h_frame[y * 25 + x / 8] & (0x80 >> (x % 8))) != 0;
            if (black && !in_run) { if (runs < 3) starts[runs] = x; ++runs; }
            if (black && runs <= 3) ++widths[runs - 1];
            in_run = black;
        }
        if (runs == 2) {
            CHECK(widths[0] == widths[1]);
            CHECK(std::abs(starts[0] - (200 - starts[1] - widths[1])) <= 1);
            ++stem_rows;
        }
    }
    CHECK(stem_rows >= 5);
    // Lowercase l must use the same 2px vertical stroke as H, not 1px.
    std::strcpy(h.message, "l");
    const auto l_frame = ink::render(h);
    for (int y = 148; y < 159; ++y) {
        int black = 0;
        for (int x = 0; x < 200; ++x)
            if (l_frame[y * 25 + x / 8] & (0x80 >> (x % 8))) ++black;
        CHECK(black == 2);
    }
    std::strcpy(a.face, "stars");
    CHECK(ink::render(a) != ink::render(b));
    b = a; std::strcpy(a.message, "Č"); std::strcpy(b.message, "?");
    CHECK(ink::render(a) != ink::render(b));
    std::strcpy(a.message, "😀");
    CHECK(ink::render(a) == ink::render(b));
    // Exercise arbitrary input under ASan/UBSan with reproducible pseudo-random bytes.
    uint32_t rng = 1234;
    for (unsigned i = 0; i < 10000; ++i) {
        std::string data(i % 512, ' ');
        for (auto& c : data) { rng = rng * 1664525 + 1013904223; c = static_cast<char>(rng >> 24); }
        parse(data, first);
    }
    std::cout << checks << " checks and 10000 parser fuzz cases passed\n";
}
