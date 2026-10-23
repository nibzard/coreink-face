#include "history.hpp"
#include <algorithm>
namespace ink {
void remember(History& h, const Snapshot& s) {
    if (h.count && h.entries[h.count-1].revision == s.revision) return;
    if (h.count == kHistoryCapacity) {
        std::move(h.entries+1,h.entries+kHistoryCapacity,h.entries);
        --h.count;
    }
    h.entries[h.count++] = {s.content,s.revision};
    h.selected=h.count-1;
}
bool navigate(History& h, int direction) {
    if (!h.count) return false;
    const auto next=static_cast<uint32_t>(std::clamp<int>(static_cast<int>(h.selected)+direction,0,static_cast<int>(h.count)-1));
    if(next==h.selected) return false;
    h.selected=next;return true;
}
}
