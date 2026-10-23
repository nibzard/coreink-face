#include "http_body.hpp"
#include <algorithm>
#include <cstring>
namespace ink {
bool read_body(const BodyReader& r, char* output, size_t capacity, size_t& length, int64_t deadline) {
    length = 0;
    char chunk[1024];
    while (true) {
        int64_t left = deadline - r.now_ms(r.context);
        if (left <= 0) return false;
        int count = r.read(r.context, chunk, sizeof(chunk), static_cast<uint32_t>(std::min<int64_t>(left, 12000)));
        if (count < 0 || static_cast<size_t>(count) > sizeof(chunk) || length + count > capacity) return false;
        if (r.now_ms(r.context) >= deadline) return false;
        if (!count) return r.complete(r.context);
        std::memcpy(output + length, chunk, count);
        length += count;
    }
}
}
