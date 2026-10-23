#pragma once
#include "coreink.hpp"
namespace ink {
struct CacheRecord {
    uint32_t magic;
    uint32_t version;
    uint8_t scope[32];
    State state;
    uint32_t crc;
};
CacheRecord seal_cache(const State& state, const uint8_t scope[32]);
bool restore_cache(const CacheRecord& record, const uint8_t scope[32], State& state);
}
