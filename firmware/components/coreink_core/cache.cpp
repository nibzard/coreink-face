#include "cache.hpp"
#include <cstddef>
#include <cstring>
namespace ink {
constexpr uint32_t kMagic = 0x494E4B31;
CacheRecord seal_cache(const State& state, const uint8_t scope[32]) {
    CacheRecord record{};
    record.magic = kMagic; record.version = 9; record.state = state;
    std::memcpy(record.scope, scope, 32);
    record.crc = crc32(&record, offsetof(CacheRecord, crc));
    return record;
}
bool restore_cache(const CacheRecord& record, const uint8_t scope[32], State& state) {
    if (record.magic != kMagic || record.version != 9 || std::memcmp(record.scope, scope, 32) ||
        record.crc != crc32(&record, offsetof(CacheRecord, crc))) return false;
    state = record.state;
    return true;
}
}
