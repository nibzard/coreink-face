#pragma once
#include <cstddef>
#include <cstdint>
namespace ink {
struct BodyReader {
    void* context;
    int (*read)(void*, char*, size_t, uint32_t timeout_ms);
    bool (*complete)(void*);
    int64_t (*now_ms)(void*);
};
// Always drain buffered bytes even when the transport parser already considers
// the message complete (e.g. headers and the whole body arrived together).
bool read_body(const BodyReader& reader, char* output, size_t capacity,
               size_t& length, int64_t deadline_ms);
}
