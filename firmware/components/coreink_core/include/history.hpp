#pragma once
#include "coreink.hpp"
namespace ink {
constexpr size_t kHistoryCapacity = 64;
struct HistoryEntry { Content content{}; uint64_t revision = 0; };
struct History {
    HistoryEntry entries[kHistoryCapacity]{};
    uint32_t count = 0;
    uint32_t selected = 0;
};
void remember(History& history, const Snapshot& snapshot);
bool navigate(History& history, int direction);
}
